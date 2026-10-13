// Test end-to-end: chạy app Electron thật (xvfb trên Linux), Claude API được giả lập bằng server SSE cục bộ.
// Đi qua từng chức năng chính và chụp màn hình để soát giao diện.
//   SHOTS=<thư mục> node tests/e2e/smoke.mjs
import { _electron as electron } from 'playwright-core'
import http from 'node:http'
import { mkdtempSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

const SHOTS = process.env.SHOTS || mkdtempSync(join(tmpdir(), 'laila-shots-'))
mkdirSync(SHOTS, { recursive: true })
const results = []
const check = (name, ok, extra = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`)
  if (!ok) process.exitCode = 1
}

// ---------- Claude giả lập ----------
const BROKEN_CODE = 'function render(ctx, t, api) { undefinedThing.draw() }'
const GOOD_CODE = `function render(ctx, t, api) {
  for (let i = 0; i < 30; i++) {
    ctx.fillStyle = 'rgba(255,255,255,' + (0.1 + 0.3 * api.random(i)) + ')'
    const x = api.random(i + 1) * api.width, y = (api.random(i + 2) * api.height - t * 40) % api.height
    ctx.beginPath(); ctx.arc(x, y < 0 ? y + api.height : y, 3 + 4 * api.random(i + 3), 0, Math.PI * 2); ctx.fill()
  }
}`
const sceneJson = (title, withCode, broken) => ({
  title,
  duration: 2,
  notes: broken ? 'v1' : 'ok',
  scene: {
    background: '#0F0F12',
    layers: [
      {
        id: 'headline', name: 'Headline', type: 'text', in: 0, out: 2,
        transform: { x: 320, y: 160, scale: 100, rotation: 0, opacity: 100, blur: 0 },
        text: { content: 'Hello Laila\nMotion', font: 'font1', size: 44, weight: 700, color: '#FFFFFF', align: 'center', lineHeight: 1.1, tracking: 0, maxWidth: 0,
          animIn: { preset: 'mask', unit: 'line', duration: 0.5, stagger: 0.1, delay: 0, ease: 'easeOutExpo', order: 'forward', distance: 0.6 }, animOut: null }
      },
      {
        id: 'bar', name: 'Accent bar', type: 'shape', in: 0.2, out: 2,
        transform: { x: 320, y: 230, opacity: 100, scale: { v: 100, keys: [{ t: 0.2, v: 0, ease: 'easeOutBack' }, { t: 0.7, v: 100, ease: 'easyEase' }] } },
        shape: { kind: 'rect', width: 220, height: 8, radius: 4, fill: '#FF5A1F', stroke: null, strokeWidth: 0, trimEnd: 100 }
      },
      ...(withCode ? [{ id: 'fx', name: 'Particles', type: 'code', in: 0, out: 2, code: { source: broken ? BROKEN_CODE : GOOD_CODE } }] : [])
    ]
  }
})

const requests = []
let generateCalls = 0
function sse(res, text) {
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
    requests.push({ headers: req.headers, body: j })
    const prompt = JSON.stringify(j.messages)
    if (j.system?.[0]?.text?.startsWith('You are a creative director')) {
      return sse(res, JSON.stringify({ scenes: [
        { title: 'Intro', prompt: 'Logo reveal', duration: 2, elementNames: ['headline', 'primary', 'background', 'font1'] },
        { title: 'Outro', prompt: 'CTA', duration: 2, elementNames: ['headline'] }
      ] }))
    }
    generateCalls++
    const isFix = prompt.includes('failed in the renderer')
    const isRevise = prompt.includes('Revise the scene')
    const intro = prompt.includes('Logo reveal')
    let out = sceneJson(intro ? 'Intro' : 'Outro', intro, intro && !isFix && !isRevise)
    if (isRevise) out.scene.background = '#FFFFFF'
    // trả lời kèm lời dẫn + fence để thử bộ đọc JSON
    sse(res, 'Here you go:\n```json\n' + JSON.stringify(out) + '\n```')
  })
})
await new Promise((r) => server.listen(0, r))
const port = server.address().port

// ---------- chạy app ----------
const userData = mkdtempSync(join(tmpdir(), 'laila-'))
writeFileSync(join(userData, 'settings.json'), JSON.stringify({ apiKeyPlain: 'sk-test' }))
const music = join(userData, 'music.mp3')
const extVideo = join(userData, 'ext.mp4')
execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=f=330', '-t', '8', music])
execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30', '-f', 'lavfi', '-i', 'sine=f=440', '-t', '3', '-shortest', '-pix_fmt', 'yuv420p', extVideo])

const app = await electron.launch({
  args: ['out/main/index.js', `--user-data-dir=${userData}`, '--no-sandbox'],
  env: { ...process.env, ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}` }
})
const win = await app.firstWindow()
await win.setViewportSize({ width: 1480, height: 920 })
const errors = []
win.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
win.on('pageerror', (e) => errors.push(String(e)))
await win.waitForFunction(() => window.__laila)
const S = (fn, arg) => win.evaluate(fn, arg)
const shot = (name) => win.screenshot({ path: join(SHOTS, name + '.png') })

await S(() => {
  const s = window.__laila.store.getState()
  s.setSettings({ width: 640, height: 360, fps: 24 })
  s.addElement('font', 'Helvetica')
})

// 1. Storyboard qua UI
await win.fill('.storyboard textarea', 'Video test giới thiệu Laila')
await win.click('text=Chia thành scene')
await win.waitForFunction(() => window.__laila.store.getState().project.scenes.length === 2, null, { timeout: 15000 })
check('Storyboard: Claude chia 2 scene', true)

// 2. Generate tất cả (scene Intro có layer code lỗi -> tự sửa)
await win.click('text=/Generate tất cả/')
await win.waitForFunction(() => window.__laila.store.getState().project.scenes.every((s) => s.status === 'ready' || s.status === 'error'), null, { timeout: 60000 })
let scenes = await S(() => window.__laila.store.getState().project.scenes)
check('Generate: cả 2 scene ready', scenes.every((s) => s.status === 'ready'), scenes.map((s) => s.status + (s.error ? ':' + s.error : '')).join(', '))
check('Tự sửa lỗi layer code (3 lần gọi Claude)', generateCalls === 3, 'calls=' + generateCalls)
check('Scene lưu dạng layer (motion)', scenes.every((s) => s.motion && s.motion.layers.length >= 2))
let media = await S(() => window.__laila.store.getState().project.media)
for (const m of media) {
  const info = execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames,width,height', '-of', 'csv=p=0', m.path]).toString().trim()
  check(`Render ${m.name}`, info === '640,360,48', info)
}
await win.waitForTimeout(500)
await shot('01-studio')

// 3. Motion Editor
await win.locator('.scene-card').first().locator('text=Chỉnh sửa').click()
await win.waitForSelector('.motion-editor')
await win.waitForTimeout(600)
await shot('02-editor')
const ed = () => S(() => { const e = window.__laila.editor.getState(); return { sel: e.selected, scene: e.scene, time: e.time, past: e.past.length } })
let st = await ed()
check('Editor mở với đủ layer', st.scene.layers.length === 3, st.scene.layers.map((l) => l.name).join(','))

// chọn layer Headline bằng cách bấm vào khung hình rồi kéo
await S(() => window.__laila.editor.getState().setTime(1.5))
await win.waitForTimeout(300)
const stage = await win.locator('.viewer-overlay').boundingBox()
const px = (x, y) => [stage.x + (x / 640) * stage.width, stage.y + (y / 360) * stage.height]
let [cx, cy] = px(320, 160)
await win.mouse.click(cx, cy)
st = await ed()
check('Bấm vào khung hình chọn đúng layer', st.sel === 'headline', String(st.sel))
await win.mouse.move(cx, cy)
await win.mouse.down()
await win.mouse.move(cx + 40, cy + 20, { steps: 5 })
await win.mouse.up()
st = await ed()
const hl = st.scene.layers.find((l) => l.id === 'headline')
check('Kéo layer đổi vị trí X/Y', Math.abs(hl.transform.x.v - 320) > 20 && Math.abs(hl.transform.y.v - 160) > 8, `x=${hl.transform.x.v.toFixed(1)} y=${hl.transform.y.v.toFixed(1)}`)

// undo
await win.keyboard.press('Control+z')
st = await ed()
check('Undo (⌘Z) trả vị trí cũ', st.scene.layers.find((l) => l.id === 'headline').transform.x.v === 320)

// stopwatch + keyframe qua Properties panel
await win.locator('.inspector .prop-row').filter({ hasText: 'Độ mờ' }).locator('.sw').click()
st = await ed()
check('Stopwatch tạo keyframe', (st.scene.layers.find((l) => l.id === 'headline').transform.opacity.keys || []).length === 1)

// preset "Pop"
await win.locator('.left-panels button', { hasText: 'Pop (bật nảy)' }).click()
st = await ed()
const sc = st.scene.layers.find((l) => l.id === 'headline').transform.scale
check('Preset Pop tạo keyframe scale', (sc.keys || []).length >= 2 && sc.keys[0].v === 0)

// mở thuộc tính trên timeline, chọn keyframe, đổi ease bằng F9 / preset
await win.locator('.lt-layer').first().locator('.twirl').click()
await win.locator('.lt-layer').first().locator('.lt-row.prop .kf').first().click()
st = await S(() => window.__laila.editor.getState().keys.length)
check('Chọn keyframe trên timeline', st >= 1)
await win.waitForSelector('.ease-editor')
await win.locator('.ease-chip', { hasText: 'Out Expo (mượt mạnh)' }).click()
const k0 = await S(() => { const e = window.__laila.editor.getState(); const r = e.keys[0]; const l = e.scene.layers.find((x) => x.id === r.layerId); const p = r.path.split('.'); const pr = p[0] === 'transform' ? l.transform[p[1]] : l[p[0]][p[1]]; return pr.keys.find((k) => Math.abs(k.t - r.t) < 1e-3).ease })
check('Đổi ease keyframe trong graph editor', k0 === 'easeOutExpo', String(k0))
await shot('03-editor-keys')

// text animator
await win.locator('.insp-section', { hasText: 'Text Animator · Ra' }).locator('select.small-select').selectOption('fade')
st = await ed()
check('Thêm Text Animator Ra', st.scene.layers.find((l) => l.id === 'headline').text.animOut?.preset === 'fade')

// công cụ Text: bấm vào khung hình tạo chữ mới
await win.keyboard.press('Escape')
await win.keyboard.press('t')
;[cx, cy] = px(120, 300)
await win.mouse.click(cx, cy)
st = await ed()
check('Công cụ Text tạo layer chữ mới', st.scene.layers.length === 4 && st.scene.layers[0].type === 'text')
await win.waitForTimeout(150)
await win.keyboard.type('Xin chào')
st = await ed()
check('Gõ nội dung chữ ngay sau khi tạo', st.scene.layers[0].text.content === 'Xin chào', st.scene.layers[0].text.content)

// vẽ hình chữ nhật bằng kéo chuột
await win.locator('.viewer').click({ position: { x: 5, y: 5 } }).catch(() => {})
await S(() => window.__laila.editor.getState().setTool('rect'))
;[cx, cy] = px(40, 40)
await win.mouse.move(cx, cy)
await win.mouse.down()
const [ex, ey] = px(140, 100)
await win.mouse.move(ex, ey, { steps: 5 })
await win.mouse.up()
st = await ed()
const rect = st.scene.layers[0]
check('Vẽ hình chữ nhật bằng kéo chuột', rect.type === 'shape' && Math.abs(rect.shape.width.v - 100) < 6 && Math.abs(rect.shape.height.v - 60) < 6, rect.type === 'shape' ? `${rect.shape.width.v.toFixed(0)}x${rect.shape.height.v.toFixed(0)}` : rect.type)

// align giữa
await win.locator('.left-panels button[title="Giữa ngang"]').click()
st = await ed()
check('Align giữa ngang', Math.abs(st.scene.layers[0].transform.x.v - 320) < 1, String(st.scene.layers[0].transform.x.v))

// nhờ Claude sửa ngay trong editor (undo được)
await win.fill('.ask-claude input', 'đổi nền trắng')
await win.click('.ask-claude button')
await win.waitForFunction(() => window.__laila.editor.getState().scene.background === '#FFFFFF', null, { timeout: 15000 })
check('Nhờ Claude sửa trong editor', true)
await win.keyboard.press('Control+z')
st = await ed()
check('Undo thay đổi của Claude', st.scene.background === '#0F0F12', String(st.scene.background))
await shot('04-editor-final')

// Xong & Render -> v2
await win.click('text=Xong & Render')
await win.waitForFunction(() => window.__laila.store.getState().project.scenes[0].version === 2 && window.__laila.store.getState().project.scenes[0].status === 'ready', null, { timeout: 60000 })
scenes = await S(() => window.__laila.store.getState().project.scenes)
check('Xong & Render ra bản v2', scenes[0].version === 2 && !scenes[0].dirty)

// 4. Timeline kiểu CapCut
await win.click('text=/Đưa lên timeline/')
let tl = await S(() => window.__laila.store.getState().project.timeline)
check('Đưa scene lên timeline', tl.length === 2)
// nhập video ngoài + nhạc qua store (hộp thoại file không tự động hoá được)
await S(async ([v, m]) => {
  const s = window.__laila.store.getState()
  s.addMedia([
    { id: 'ext', kind: 'video', name: 'ext.mp4', path: v, duration: 3, hasAudio: true },
    { id: 'mus', kind: 'audio', name: 'music.mp3', path: m, duration: 8, hasAudio: true }
  ])
  s.appendToTimeline('ext')
  s.appendToTimeline('mus')
}, [extVideo, music])
tl = await S(() => window.__laila.store.getState().project)
check('Thêm video ngoài + nhạc nền', tl.timeline.length === 3 && tl.music?.mediaId === 'mus')

// chọn clip 1, tốc độ 2x
await win.locator('.video-track .clip').nth(0).click()
await win.locator('.clip-prop select').selectOption('2')
tl = await S(() => window.__laila.store.getState().project.timeline)
check('Đổi tốc độ clip 2×', tl[0].speed === 2)

// chuyển cảnh giữa clip 1 và 2
await win.locator('.trans-btn').first().click()
await win.locator('.trans-grid button', { hasText: 'Mờ dần' }).click()
await win.locator('.trans-pop button', { hasText: 'Xong' }).click()
tl = await S(() => window.__laila.store.getState().project.timeline)
check('Thêm chuyển cảnh', tl[0].transition === 'fade')

// tách clip bằng phím S, Q/W
await S(() => window.__laila.store.getState().setPlayhead(2.2))
await win.locator('.timeline .ruler').click({ position: { x: 2, y: 2 } })
await S(() => window.__laila.store.getState().setPlayhead(2.2))
await win.keyboard.press('s')
tl = await S(() => window.__laila.store.getState().project.timeline)
check('Tách clip (S)', tl.length === 4, String(tl.length))
await S(() => window.__laila.store.getState().setPlayhead(3.4))
await win.keyboard.press('w')
const tlW = await S(() => window.__laila.store.getState().project.timeline)
check('Cắt phải (W)', JSON.stringify(tlW) !== JSON.stringify(tl))
await win.keyboard.press('Control+z')
const tlU = await S(() => window.__laila.store.getState().project.timeline)
check('Undo timeline', JSON.stringify(tlU) === JSON.stringify(tl))

// phát thử 1 giây
await win.keyboard.press('Space')
await win.waitForTimeout(1200)
await win.keyboard.press('Space')
const ph = await S(() => window.__laila.store.getState().playhead)
check('Phát timeline (Space)', ph > 3.5, ph.toFixed(2))
await S(() => window.__laila.store.getState().setPlayhead(1.1))
await win.waitForTimeout(600)
await shot('05-timeline')

// seek trên giao thức media:// (Range)
const seekOk = await S(async () => {
  const m = window.__laila.store.getState().project.media[0]
  const v = document.createElement('video')
  v.src = 'media://local/' + encodeURIComponent(m.path)
  await new Promise((r, j) => { v.onloadedmetadata = r; v.onerror = () => j(new Error('video load error')) })
  v.currentTime = 1
  await new Promise((r) => (v.onseeked = r))
  return Math.abs(v.currentTime - 1) < 0.1
})
check('Tua video qua media:// (Range)', seekOk)

// 5. Xuất video
const out = join(userData, 'final.mp4')
const totalT = await S(async (outPath) => {
  const p = window.__laila.store.getState().project
  const byId = new Map(p.media.map((m) => [m.id, m]))
  await window.laila.exporter.run({
    outPath, settings: p.settings, quality: 'draft',
    clips: p.timeline.map((c) => { const m = byId.get(c.mediaId); return { path: m.path, in: c.in, out: c.out, hasAudio: m.hasAudio, volume: c.volume, speed: c.speed ?? 1, transition: c.transition ?? 'none', transitionDuration: c.transitionDuration ?? 0.5, fadeIn: 0, fadeOut: 0 } }),
    music: { path: byId.get(p.music.mediaId).path, in: 0, volume: 0.5 }
  })
  return document.querySelector('.timeline .tc')?.textContent
}, out)
const dur = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out]).toString())
const tlTotal = await S(() => {
  const t = window.__laila.store.getState().project.timeline
  // tính lại như timeline.ts
  const len = (c) => (c.out - c.in) / Math.min(4, Math.max(0.25, c.speed ?? 1))
  let sum = 0
  t.forEach((c, i) => { sum += len(c); const n = t[i + 1]; if (n && c.transition && c.transition !== 'none') sum -= Math.min(c.transitionDuration ?? 0.5, len(c) * 0.45, len(n) * 0.45) })
  return sum
})
check('Xuất video đúng thời lượng timeline', Math.abs(dur - tlTotal) < 0.1, `file=${dur.toFixed(2)}s timeline=${tlTotal.toFixed(2)}s (${totalT})`)
const streams = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', out]).toString().trim().split('\n')
check('File xuất có hình + tiếng', streams.includes('video') && streams.includes('audio'))

// 6. Giao diện tối
await S(() => document.documentElement.setAttribute('data-theme', 'dark'))
await win.waitForTimeout(300)
await shot('06-dark')
await win.locator('.scene-card').nth(1).locator('text=Chỉnh sửa').click()
await win.waitForSelector('.motion-editor')
await S(() => window.__laila.editor.getState().setTime(1))
await win.waitForTimeout(600)
await shot('07-editor-dark')

const gen = requests.find((r) => !r.body.output_config?.format)
check('Request Claude: model + fallback + effort', gen.body.model === 'claude-opus-5-5' && gen.body.fallbacks === 'default' && String(gen.headers['anthropic-beta']).includes('server-side-fallback-2026-07-01'), `${gen.body.model} ${gen.body.fallbacks} ${gen.body.output_config?.effort}`)

const realErrors = errors.filter((e) => !/Autofill|devtools|Electron Security Warning/i.test(e))
check('Không có lỗi JS trong renderer', realErrors.length === 0, realErrors.slice(0, 3).join(' | '))

await app.close()
server.close()
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} PASS — ảnh chụp: ${SHOTS}`)
