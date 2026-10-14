import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import { classify, importPath, makeImageItem, pngHasAlpha } from '../electron/importer'
import { FFMPEG, runExport } from '../electron/ffmpeg'

const dir = mkdtempSync(join(tmpdir(), 'cc-import-'))

/** PNG RGBA tối giản: màu `rgba` ở giữa, viền trong suốt */
function png(w: number, h: number, rgba: [number, number, number, number], border = 0): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (b: Buffer) => {
    let c = 0xffffffff
    for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type), data])
    const c = Buffer.alloc(4)
    c.writeUInt32BE(crc(td))
    return Buffer.concat([len, td, c])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const inside = x >= border && y >= border && x < w - border && y < h - border
      const o = y * (w * 4 + 1) + 1 + x * 4
      if (inside) raw.set(rgba, o)
    }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

test('classify: nhận đúng loại theo đuôi file', () => {
  assert.equal(classify('/a/b.MOV').cls, 'video')
  assert.equal(classify('a.wav').cls, 'audio')
  assert.equal(classify('a.aiff').cls, 'audio')
  assert.equal(classify('a.JPG').cls, 'image')
  assert.equal(classify('logo.svg').cls, 'svg')
  assert.equal(classify('logo.ai').cls, 'pdf')
  assert.equal(classify('logo.pdf').cls, 'pdf')
  assert.equal(classify('logo.eps').cls, 'unsupported')
  assert.match(classify('logo.eps').reason!, /SVG hoặc PDF/)
  assert.equal(classify('notes.txt').cls, 'unsupported')
})

test('pngHasAlpha: RGBA có, JPG không', () => {
  assert.equal(pngHasAlpha(png(4, 4, [255, 0, 0, 255])), true)
  assert.equal(pngHasAlpha(Buffer.from('not png at all, definitely not png......')), false)
})

test('importPath: ảnh PNG -> media ảnh 5s có alpha, file lạ báo lỗi', async () => {
  const p = join(dir, 'logo.png')
  writeFileSync(p, png(120, 80, [255, 0, 0, 255], 20))
  const r = await importPath(p)
  assert.equal(r.item?.kind, 'image')
  assert.equal(r.item?.duration, 5)
  assert.equal(r.item?.width, 120)
  assert.equal(r.item?.height, 80)
  assert.equal(r.item?.alpha, true)
  const svg = await importPath(join(dir, 'x.svg'))
  assert.equal(svg.vector, 'svg')
  const bad = await importPath(join(dir, 'x.eps'))
  assert.match(bad.error!, /EPS/)
})

test('xuất video: ảnh trên track chính kéo dài 3s + ảnh trong suốt làm lớp phủ', async () => {
  const bg = join(dir, 'bg.png')
  writeFileSync(bg, png(64, 36, [0, 0, 255, 255]))
  const logo = join(dir, 'logo2.png')
  writeFileSync(logo, png(64, 36, [255, 0, 0, 255], 12))
  const item = await makeImageItem(logo)
  assert.equal(item.alpha, true)
  const out = join(dir, 'out.mp4')
  const base = { start: 0, in: 0, speed: 1, volume: 1, fadeIn: 0, fadeOut: 0 }
  await runExport(
    {
      outPath: out,
      settings: { width: 320, height: 180, fps: 24 },
      quality: 'draft',
      clips: [{ path: bg, image: true, in: 0, out: 3, hasAudio: false, volume: 1, speed: 1, transition: 'none', transitionDuration: 0.5, fadeIn: 0, fadeOut: 0 }],
      overlays: [{ ...base, path: logo, image: true, alpha: true, hasAudio: false, start: 1, out: 1.5, opacity: 100, scale: 100, x: 0, y: 0 }]
    },
    () => {}
  ).promise
  const probeOut = (() => {
    try {
      execFileSync(FFMPEG, ['-hide_banner', '-i', out], { stdio: ['ignore', 'pipe', 'pipe'] })
      return ''
    } catch (e) {
      return String((e as { stderr: Buffer }).stderr)
    }
  })()
  const m = probeOut.match(/Duration: (\d+):(\d+):([\d.]+)/)!
  const dur = +m[1] * 3600 + +m[2] * 60 + +m[3]
  assert.ok(Math.abs(dur - 3) < 0.15, `duration ${dur}`)
  // pixel giữa khung: giây 0.5 xanh dương (nền), giây 1.8 đỏ (logo phủ), viền logo vẫn thấy nền
  const px = (t: number, x: number, y: number) =>
    [...execFileSync(FFMPEG, ['-v', 'error', '-ss', String(t), '-i', out, '-frames:v', '1', '-vf', `crop=2:2:${x}:${y}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])]
  const [r0, , b0] = px(0.5, 160, 90)
  assert.ok(b0 > 180 && r0 < 60, `nền ${r0},${b0}`)
  const [r1, , b1] = px(1.8, 160, 90)
  assert.ok(r1 > 180 && b1 < 60, `logo ${r1},${b1}`)
  const [r2, , b2] = px(1.8, 10, 10)
  assert.ok(b2 > 180 && r2 < 60, `viền trong suốt ${r2},${b2}`)
})
