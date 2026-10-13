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
let soundCalls = 0
let referenceCalls = 0
let referenceImages = 0
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
    if (j.system?.[0]?.text?.startsWith('You are a sound designer')) {
      soundCalls++
      return sse(res, JSON.stringify({ type: 'sfx', name: 'Vút sáng', notes: 'test', spec: { kind: 'swish', duration: 0.4, pitch: 1.3, intensity: 0.8, brightness: 0.9, reverb: 0.1 } }))
    }
    if (j.system?.[1]?.text?.startsWith('REFERENCE MODE')) {
      referenceCalls++
      referenceImages = j.messages[0].content.filter((b) => b.type === 'image').length
      const sc = sceneJson('Theo reference', false, false)
      return sse(res, JSON.stringify({ ...sc, analysis: { summary: 'Chữ trượt lên theo từng dòng, thanh màu kéo dài.', feasibility: 'high', feasibilityReason: 'Toàn bộ là chữ và hình 2D.', techniques: [{ name: 'Mask reveal', detail: 'Từng dòng trồi lên', replicable: 'yes' }, { name: 'Camera 3D', detail: 'Xoay nhẹ', replicable: 'no' }], timing: 'Nhanh 0.5s', palette: ['#112233', '#FFCC00'], tips: ['Tăng stagger'] } }))
    }
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

// thư mục font người dùng riêng cho lần test (để thử tự nhận font mới cài)
const fakeHome = mkdtempSync(join(tmpdir(), 'cc-home-'))
mkdirSync(join(fakeHome, '.local/share/fonts'), { recursive: true })
const newFont = join(userData, 'CCTestSans.ttf')
let fontReady = false
try {
  execFileSync('python3', ['-c', `
from fontTools.ttLib import TTFont
f = TTFont('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')
for r in f['name'].names:
    if r.nameID in (1, 4, 16): r.string = 'CC Test Sans'
    if r.nameID == 6: r.string = 'CCTestSans'
f.save('${newFont}')`])
  fontReady = true
} catch {
  console.log('(bỏ qua test font mới: không có fontTools)')
}
const app = await electron.launch({
  args: ['out/main/index.js', `--user-data-dir=${userData}`, '--no-sandbox'],
  env: { ...process.env, HOME: fakeHome, ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}` }
})
// hộp thoại chọn/lưu file: trả về file định sẵn để đi qua đúng luồng UI
const stubDialog = (open, save) =>
  app.evaluate(({ dialog }, [o, sv]) => {
    dialog.showOpenDialog = async () => ({ canceled: !o, filePaths: o ? o : [] })
    dialog.showSaveDialog = async () => ({ canceled: !sv, filePath: sv || undefined })
  }, [open, save])
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

// nhập video + nhạc qua đúng nút Media (hộp thoại được giả lập)
await win.locator('.sidebar .segmented button', { hasText: 'Media' }).click()
await stubDialog([extVideo], null)
await win.locator('button', { hasText: 'Nhập video' }).click()
await win.waitForFunction(() => window.__laila.store.getState().project.media.some((m) => m.name === 'ext.mp4'))
await stubDialog([music], null)
await win.locator('button', { hasText: 'Nhạc nền' }).click()
await win.waitForFunction(() => window.__laila.store.getState().project.media.some((m) => m.name === 'music.mp3'))
const ids = await S(() => {
  const p = window.__laila.store.getState().project
  return { ext: p.media.find((m) => m.name === 'ext.mp4').id, mus: p.media.find((m) => m.name === 'music.mp3').id }
})
await S(([e, m]) => {
  const s = window.__laila.store.getState()
  s.appendToTimeline(e)
  s.setPlayhead(0)
  s.appendToTimeline(m)
}, [ids.ext, ids.mus])
let pj = await S(() => window.__laila.store.getState().project)
check('Nhập video + nhạc qua nút Media', pj.timeline.length === 3 && pj.tracks.some((t) => t.kind === 'audio' && t.clips.some((c) => c.mediaId === ids.mus)))
const extInfo = pj.media.find((m) => m.id === ids.ext)
check('Đọc thông tin video bằng ffmpeg (không cần ffprobe)', Math.abs(extInfo.duration - 3) < 0.1 && extInfo.width === 1280 && extInfo.hasAudio, `${extInfo.duration} ${extInfo.width}x${extInfo.height}`)

// chọn clip 1, tốc độ 2x
await win.locator('.main-lane .clip').nth(0).click()
await win.locator('.clip-prop select').first().selectOption('2')
tl = await S(() => window.__laila.store.getState().project.timeline)
check('Đổi tốc độ clip 2×', tl[0].speed === 2)

// chuyển cảnh: rê chuột lên để xem thử lặp, rồi bấm chọn
await win.locator('.trans-btn').first().click()
const thumbs = await win.locator('.trans-thumb').count()
const b0 = await win.locator('.trans-grid button', { hasText: 'Đẩy sang trái' }).locator('.tt.b').getAttribute('style')
await win.waitForTimeout(400)
const b1 = await win.locator('.trans-grid button', { hasText: 'Đẩy sang trái' }).locator('.tt.b').getAttribute('style')
check('Hình thu nhỏ chuyển cảnh tự chạy lặp', thumbs === 10 && b0 !== b1)
await win.locator('.trans-grid button', { hasText: 'Mờ dần' }).hover()
await win.waitForTimeout(300)
const ph0 = await S(() => window.__laila.store.getState().playhead)
const hv = await S(() => window.__laila.store.getState().hoverTransition)
const v0 = await S(() => [...document.querySelectorAll('.screen video')].map((v) => v.currentTime.toFixed(2)).join())
await win.waitForTimeout(500)
const v1 = await S(() => [...document.querySelectorAll('.screen video')].map((v) => v.currentTime.toFixed(2)).join())
check('Rê chuột lên chuyển cảnh: preview chạy lặp đoạn nối', hv?.kind === 'fade' && v0 !== v1, `${v0} -> ${v1}`)
await win.locator('.trans-grid button', { hasText: 'Mờ dần' }).click()
await win.locator('.trans-pop button', { hasText: 'Xong' }).click()
tl = await S(() => window.__laila.store.getState().project.timeline)
const hvAfter = await S(() => window.__laila.store.getState().hoverTransition)
check('Bấm chọn chuyển cảnh; đóng thì hết preview', tl[0].transition === 'fade' && hvAfter === null && (await S(() => window.__laila.store.getState().playhead)) === ph0)

// tách clip bằng phím S, Q/W
await S(() => window.__laila.store.getState().select(null))
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

// 4b. Lớp phủ: scene Outro render nền trong suốt -> track phủ
await win.locator('.scene-card').nth(1).locator('.alpha-toggle input').check()
await win.locator('.scene-card').nth(1).locator('.sc-badge.warn').click()
await win.waitForFunction(() => { const s = window.__laila.store.getState().project.scenes[1]; return s.status === 'ready' && s.version === 2 }, null, { timeout: 60000 })
pj = await S(() => window.__laila.store.getState().project)
const ovMedia = pj.media.find((m) => m.id === pj.scenes[1].mediaId)
check('Render scene nền trong suốt (webm alpha)', ovMedia.alpha && ovMedia.path.endsWith('.webm'))
await S((id) => { const s = window.__laila.store.getState(); s.setPlayhead(0.5); s.appendToTimeline(id) }, ovMedia.id)
pj = await S(() => window.__laila.store.getState().project)
const vt = pj.tracks.find((t) => t.kind === 'video')
check('Clip trong suốt tự vào track phủ tại playhead', vt && vt.clips.length === 1 && Math.abs(vt.clips[0].start - 0.5) < 0.01)
// kéo clip phủ sang phải ~1s
const ovClip = win.locator('.track-row.kind-video .clip').first()
const box = await ovClip.boundingBox()
const zoomNow = await S(() => window.__laila.store.getState().zoom)
await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
await win.mouse.down()
await win.mouse.move(box.x + box.width / 2 + zoomNow * 1, box.y + box.height / 2, { steps: 6 })
await win.mouse.up()
pj = await S(() => window.__laila.store.getState().project)
const movedStart = pj.tracks.find((t) => t.kind === 'video').clips[0].start
check('Kéo clip trên track phủ', Math.abs(movedStart - 1.5) < 0.15, movedStart.toFixed(2))
// chỉnh tỉ lệ/độ mờ lớp phủ
await win.locator('.clip-prop', { hasText: 'Tỉ lệ' }).locator('input').fill('80')
pj = await S(() => window.__laila.store.getState().project)
check('Chỉnh tỉ lệ lớp phủ', pj.tracks.find((t) => t.kind === 'video').clips[0].scale === 80)
// thêm track âm thanh mới bằng nút
const nAudio0 = pj.tracks.filter((t) => t.kind === 'audio').length
await win.locator('button', { hasText: 'Track âm thanh' }).click()
pj = await S(() => window.__laila.store.getState().project)
check('Thêm track âm thanh bằng nút', pj.tracks.filter((t) => t.kind === 'audio').length === nAudio0 + 1)
await win.locator('.track-row.kind-audio').last().locator('button[title="Xoá track"]').click()

// phát thử 1 giây
await S(() => window.__laila.store.getState().setPlayhead(0))
await win.keyboard.press('Space')
await win.waitForTimeout(1200)
await win.keyboard.press('Space')
const ph = await S(() => window.__laila.store.getState().playhead)
check('Phát timeline (Space)', ph > 0.8, ph.toFixed(2))
await S(() => window.__laila.store.getState().setPlayhead(1.9))
await win.waitForTimeout(700)
const ovVisible = await S(() => { const v = document.querySelector('.screen video.overlay-video'); return v && +v.style.opacity > 0 && v.readyState >= 1 })
check('Preview hiện lớp phủ đúng thời điểm', ovVisible)
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

// 5. Âm thanh
await win.locator('.sidebar .segmented button', { hasText: 'Âm thanh' }).click()
await win.locator('.sfx-tile', { hasText: 'Pop' }).locator('.round-btn').click()
await win.waitForTimeout(400)
check('Nghe thử SFX', (await S(() => !!document.querySelector('.sfx-tile.on .round-btn svg path'))) && !(await win.locator('.sound-panel .error').count()))
const media0 = pj.media.length
await S(() => window.__laila.store.getState().setPlayhead(1))
await win.locator('button', { hasText: 'Thêm tại playhead' }).click()
await win.waitForFunction((n) => window.__laila.store.getState().project.media.length > n, media0, { timeout: 15000 })
pj = await S(() => window.__laila.store.getState().project)
const sfxMedia = pj.media[pj.media.length - 1]
check('Tạo SFX -> WAV vào Media + track âm thanh tại playhead', sfxMedia.kind === 'audio' && sfxMedia.path.endsWith('.wav') && pj.tracks.some((t) => t.clips.some((c) => c.mediaId === sfxMedia.id && Math.abs(c.start - 1) < 0.01)))
await win.locator('.sound-panel input[type=number]').nth(1).fill('6')
await win.locator('button', { hasText: 'Tạo & thêm' }).click()
await win.waitForFunction((n) => window.__laila.store.getState().project.media.length > n + 1, media0, { timeout: 30000 })
pj = await S(() => window.__laila.store.getState().project)
const musMedia = pj.media[pj.media.length - 1]
const vd = (() => { try { return execFileSync('sh', ['-c', `ffmpeg -hide_banner -i "${musMedia.path}" -af volumedetect -f null - 2>&1 | grep mean_volume`]).toString() } catch { return '' } })()
const meanDb = parseFloat(vd.split(':')[1] || '-99')
check('Tạo nhạc nền 6s có tiếng thật', Math.abs(musMedia.duration - 6) < 0.1 && meanDb > -40, `${musMedia.duration.toFixed(2)}s, mean ${meanDb} dB`)
await win.locator('.sound-panel textarea').fill('tiếng vút nhanh, sáng')
await win.locator('.sound-panel button', { hasText: /^Tạo$/ }).click()
await win.waitForSelector('.snd-result', { timeout: 15000 })
check('Claude thiết kế âm thanh từ mô tả', soundCalls === 1 && (await win.locator('.snd-result').innerText()).includes('Vút sáng'))
await win.locator('button', { hasText: 'Quét timeline' }).click()
const evCount = await win.locator('.sfx-events li').count()
check('Tự gắn SFX: quét được chuyển động', evCount >= 2, String(evCount))
await win.locator('button', { hasText: /Tạo track SFX/ }).click()
await win.waitForFunction(() => window.__laila.store.getState().project.tracks.some((t) => t.name === 'SFX tự động' && t.clips.length === 1), null, { timeout: 20000 })
check('Tạo track "SFX tự động"', true)
await shot('08-sound')

// 6. Phân tích reference
await stubDialog([extVideo], null)
await win.locator('button', { hasText: 'Phân tích reference' }).click()
await win.locator('.modal.reference button', { hasText: 'Chọn file' }).click()
await win.waitForSelector('.ref-drop video')
await win.locator('.modal.reference textarea').fill('lấy kiểu chữ chạy')
await win.locator('.modal.reference button', { hasText: 'Phân tích' }).click()
await win.waitForSelector('.ref-result', { timeout: 30000 })
check('Phân tích reference: trích khung hình gửi Claude', referenceCalls === 1 && referenceImages === 6, `${referenceImages} ảnh`)
check('Hiện đánh giá copy được + kỹ thuật', (await win.locator('.feas').innerText()).includes('Copy được') && (await win.locator('.tech-list li').count()) === 2)
await shot('09-reference')
await win.locator('.modal.reference button', { hasText: 'Thêm màu vào brand kit' }).click()
const nScenes = (await S(() => window.__laila.store.getState().project.scenes)).length
await win.locator('.modal.reference button', { hasText: 'Tạo scene theo reference' }).click()
await win.waitForFunction((n) => { const sc = window.__laila.store.getState().project.scenes; return sc.length === n + 1 && sc[n].status === 'ready' }, nScenes, { timeout: 60000 })
pj = await S(() => window.__laila.store.getState().project)
check('Tạo scene theo reference + thêm màu vào brand kit', pj.scenes[nScenes].title === 'Theo reference' && pj.elements.some((e) => e.value.toLowerCase() === '#ffcc00'))

// 7. Xuất video qua đúng cửa sổ Xuất
const out = join(userData, 'final.mp4')
await stubDialog(null, out)
await win.locator('.topbar button', { hasText: 'Xuất video' }).click()
await win.locator('.modal.export button', { hasText: 'Chọn nơi lưu và xuất' }).click()
await win.waitForSelector('.modal.export .ok', { timeout: 90000 })
const dur = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out]).toString())
const projTotal = await S(() => {
  const p = window.__laila.store.getState().project
  const len = (c) => (c.out - c.in) / Math.min(4, Math.max(0.25, c.speed ?? 1))
  let sum = 0
  p.timeline.forEach((c, i) => { sum += len(c); const n = p.timeline[i + 1]; if (n && c.transition && c.transition !== 'none') sum -= Math.min(c.transitionDuration ?? 0.5, len(c) * 0.45, len(n) * 0.45) })
  for (const t of p.tracks) for (const c of t.clips) sum = Math.max(sum, c.start + len(c))
  return sum
})
check('Xuất video đúng thời lượng (cả track phụ)', Math.abs(dur - projTotal) < 0.1, `file=${dur.toFixed(2)}s timeline=${projTotal.toFixed(2)}s`)
const streams = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', out]).toString().trim().split('\n')
check('File xuất có hình + tiếng', streams.includes('video') && streams.includes('audio'))
await win.locator('.modal.export button', { hasText: 'Đóng' }).click()

// 8. Khung co giãn
const left0 = await S(() => document.querySelector('.sidebar').getBoundingClientRect().width)
const sp = await win.locator('.sidebar .splitter').boundingBox()
await win.mouse.move(sp.x + 3, sp.y + 200)
await win.mouse.down()
await win.mouse.move(sp.x + 83, sp.y + 200, { steps: 5 })
await win.mouse.up()
const left1 = await S(() => document.querySelector('.sidebar').getBoundingClientRect().width)
const tlh = await win.locator('.timeline-wrap > .splitter').boundingBox()
await win.mouse.move(tlh.x + 300, tlh.y + 3)
await win.mouse.down()
await win.mouse.move(tlh.x + 300, tlh.y - 77, { steps: 5 })
await win.mouse.up()
const tlH = await S(() => document.querySelector('.timeline').getBoundingClientRect().height)
check('Kéo co giãn sidebar + timeline', Math.abs(left1 - left0 - 80) < 3 && tlH > 360, `${left0}->${left1}, timeline ${tlH}`)

// 9. Font trong máy
await win.locator('.sidebar .segmented button', { hasText: 'Brand kit' }).click()
await win.locator('.element', { hasText: 'Font' }).locator('.fp-current').click()
const nFonts = await win.locator('.fp-item').count()
check('Đọc font cài trong máy', nFonts >= 20, `${nFonts} font`)
await win.keyboard.press('Escape')
await win.mouse.click(5, 300)
if (fontReady) {
  execFileSync('cp', [newFont, join(fakeHome, '.local/share/fonts/')])
  try { execFileSync('fc-cache', ['-f', join(fakeHome, '.local/share/fonts')], { env: { ...process.env, HOME: fakeHome } }) } catch {}
  let found = false
  for (let i = 0; i < 20 && !found; i++) {
    await win.waitForTimeout(500)
    found = await S(() => window.__laila.fonts?.getState().families.some((f) => f.family === 'CC Test Sans'))
  }
  check('Cài font mới -> app tự nhận', found)
  const usable = await S(async () => { await document.fonts.ready; await new Promise((r) => setTimeout(r, 500)); return document.fonts.check('24px "CC Test Sans"') && [...document.fonts].some((f) => f.family.replace(/"/g, '') === 'CC Test Sans' && f.status === 'loaded') })
  check('Font mới dùng được ngay để vẽ chữ', usable)
}

// 10. Motion Editor: rê chuột xem thử hiệu ứng
await win.locator('.scene-card').first().locator('text=Chỉnh sửa').click()
await win.waitForSelector('.motion-editor')
await S(() => { const e = window.__laila.editor.getState(); e.select('bar'); e.setTime(1.8) })
await win.waitForTimeout(300)
const thumbsMoving = await S(async () => {
  const c = document.querySelector('.left-panels .preset-thumb')
  const a = c.toDataURL()
  await new Promise((r) => setTimeout(r, 300))
  return a !== c.toDataURL()
})
check('Hình thu nhỏ hiệu ứng tự chạy lặp', thumbsMoving)
await win.locator('.left-panels .preset-btn', { hasText: 'Xoay vào' }).hover()
await win.waitForTimeout(250)
const pv1 = await S(() => { const e = window.__laila.editor.getState(); return { has: !!e.preview, t: e.time } })
await win.waitForTimeout(350)
const pv2 = await S(() => { const e = window.__laila.editor.getState(); return { has: !!e.preview, t: e.time, keys: e.scene.layers.find((l) => l.id === 'bar').transform.rotation.keys } })
check('Rê chuột: chạy thử hiệu ứng lặp trên layer, chưa áp thật', pv1.has && pv2.has && pv1.t !== pv2.t && !pv2.keys)
await shot('10-preset-hover')
await win.mouse.move(700, 300)
await win.waitForTimeout(200)
const pv3 = await S(() => { const e = window.__laila.editor.getState(); return { has: !!e.preview, t: e.time } })
check('Rời chuột: thôi xem thử, playhead về chỗ cũ', !pv3.has && Math.abs(pv3.t - 1.8) < 0.001, String(pv3.t))
await win.locator('.left-panels .preset-btn', { hasText: 'Xoay vào' }).click()
const rk = await S(() => window.__laila.editor.getState().scene.layers.find((l) => l.id === 'bar').transform.rotation.keys)
check('Bấm: áp hiệu ứng thật', Array.isArray(rk) && rk.length >= 2)
await win.locator('.me-toolbar button', { hasText: 'Studio' }).click()

// 11. Giao diện tối
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
