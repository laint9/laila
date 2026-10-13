// Smoke test end-to-end: chạy app Electron thật (xvfb trên Linux), Claude API được giả lập
// bằng server SSE cục bộ. Kiểm tra: storyboard -> generate (có 1 vòng auto-fix) -> render mp4
// -> timeline -> cắt -> xuất video tổng.
import { _electron as electron } from 'playwright-core'
import http from 'node:http'
import { mkdtempSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

const BROKEN = `function render(ctx, t, api) { undefinedThing.draw() }`
const GOOD = `
function setup(api) { return { n: 12 } }
function render(ctx, t, api) {
  const { width: W, height: H } = api
  ctx.fillStyle = api.el.background || '#111'
  ctx.fillRect(0, 0, W, H)
  const k = api.ease.outCubic(api.seg(t, 0, 0.8))
  for (let i = 0; i < api.state.n; i++) {
    ctx.fillStyle = api.el.primary || '#f50'
    const r = H * 0.03
    ctx.beginPath()
    ctx.arc(W * (0.1 + 0.8 * api.random(i)), H * (0.2 + 0.6 * api.random(i + 50)) * k, r, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.fillStyle = '#fff'
  ctx.font = api.font('font1', H * 0.08, 700)
  ctx.textAlign = 'center'
  ctx.globalAlpha = k
  ctx.fillText(api.el.headline || 'Hello', W / 2, H / 2)
}`

const requests = []
let generateCalls = 0
function sse(res, obj) {
  const text = JSON.stringify(obj)
  const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`)
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  ev('message_start', { message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } } })
  ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } })
  ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text } })
  ev('content_block_stop', { index: 0 })
  ev('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 50 } })
  ev('message_stop', {})
  res.end()
}
const server = http.createServer((req, res) => {
  let body = ''
  req.on('data', (d) => (body += d))
  req.on('end', () => {
    const j = JSON.parse(body || '{}')
    requests.push({ url: req.url, headers: req.headers, body: j })
    const prompt = JSON.stringify(j.messages)
    if (j.system?.[0]?.text?.startsWith('You are a creative director')) {
      return sse(res, { scenes: [
        { title: 'Intro', prompt: 'Logo reveal', duration: 1.5, elementNames: ['headline', 'primary', 'background'] },
        { title: 'Outro', prompt: 'CTA', duration: 1, elementNames: ['headline'] }
      ] })
    }
    generateCalls++
    // lần đầu của scene Intro trả code lỗi để kiểm tra vòng auto-fix
    const isFix = prompt.includes('It failed in the renderer')
    const broken = prompt.includes('Logo reveal') && !isFix
    sse(res, { title: 'x', duration: prompt.includes('CTA') ? 1 : 1.5, code: broken ? BROKEN : GOOD, notes: isFix ? 'fixed' : 'ok' })
  })
})
await new Promise((r) => server.listen(0, r))
const port = server.address().port

const userData = mkdtempSync(join(tmpdir(), 'laila-'))
writeFileSync(join(userData, 'settings.json'), JSON.stringify({ apiKeyPlain: 'sk-test' }))
const app = await electron.launch({
  args: ['out/main/index.js', `--user-data-dir=${userData}`, '--no-sandbox'],
  env: { ...process.env, ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}` }
})
const win = await app.firstWindow()
win.on('console', (m) => m.type() === 'error' && console.log('[renderer]', m.text()))
await win.waitForFunction(() => window.__laila)
const fail = (msg) => { console.error('FAIL:', msg); process.exitCode = 1 }

// nhỏ cho nhanh
await win.evaluate(() => {
  const s = window.__laila.store.getState()
  s.setSettings({ width: 640, height: 360, fps: 24 })
  s.addElement('font', 'Helvetica')
})
const n = await win.evaluate(() => window.__laila.pipeline.planStoryboard('test brief', 2, 3))
if (n !== 2) fail('storyboard scenes ' + n)

await win.evaluate(() => window.__laila.pipeline.generateAll())
const scenes = await win.evaluate(() => window.__laila.store.getState().project.scenes)
for (const s of scenes) {
  if (s.status !== 'ready') fail(`scene ${s.title} status=${s.status} err=${s.error}`)
}
if (generateCalls !== 3) fail('expected 3 generate calls (2 + 1 autofix), got ' + generateCalls)

const media = await win.evaluate(() => window.__laila.store.getState().project.media)
for (const m of media) {
  if (!existsSync(m.path)) fail('missing render ' + m.path)
  const frames = execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames,width,height', '-of', 'csv=p=0', m.path]).toString().trim()
  console.log('render', m.name, m.duration.toFixed(2) + 's', frames)
}

// timeline: đưa lên, cắt clip đầu ở 0.5s, xuất
const tl = await win.evaluate(() => {
  const { pipeline, store } = window.__laila
  pipeline.sendReadyScenesToTimeline()
  store.getState().setPlayhead(0.5)
  store.getState().splitAtPlayhead()
  return store.getState().project.timeline.map((c) => [c.in, c.out])
})
console.log('timeline', JSON.stringify(tl))
if (tl.length !== 3) fail('split failed')

// thử tua video qua giao thức media:// (Range)
const seekOk = await win.evaluate(async () => {
  const m = window.__laila.store.getState().project.media[0]
  const v = document.createElement('video')
  v.src = 'media://local/' + encodeURIComponent(m.path)
  await new Promise((r, j) => { v.onloadedmetadata = r; v.onerror = () => j(new Error('video load error')) })
  v.currentTime = 1
  await new Promise((r) => (v.onseeked = r))
  return Math.abs(v.currentTime - 1) < 0.1
})
if (!seekOk) fail('seek over media:// failed')

const out = join(userData, 'final.mp4')
await win.evaluate(async (outPath) => {
  const p = window.__laila.store.getState().project
  const byId = new Map(p.media.map((m) => [m.id, m]))
  await window.laila.exporter.run({
    outPath, settings: p.settings, quality: 'draft',
    clips: p.timeline.map((c) => { const m = byId.get(c.mediaId); return { path: m.path, in: c.in, out: c.out, hasAudio: m.hasAudio, volume: c.volume } })
  })
}, out)
const dur = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out]).toString())
console.log('export duration', dur)
if (Math.abs(dur - 2.5) > 0.15) fail('export duration ' + dur)

// kiểm tra request gửi lên API
const gen = requests.find((r) => r.body.output_config?.format)
console.log('request', gen.url, gen.headers['anthropic-beta'], gen.body.model, gen.body.fallbacks, gen.body.output_config.effort)
if (!String(gen.headers['anthropic-beta']).includes('server-side-fallback-2026-07-01')) fail('missing beta header')

await win.screenshot({ path: process.env.SHOT || join(userData, 'shot.png') })
await app.close()
server.close()
console.log(process.exitCode ? 'SMOKE FAILED' : 'SMOKE OK', userData)
