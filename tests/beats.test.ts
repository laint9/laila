import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analyzeBeats, gridBeats } from '../src/audio/beats'

const SR = 22050

/** Beat giả lập: kick phách 1 & 3, snare 2 & 4, hi-hat móc đơn, thêm nhiễu nền; `intro` giây đầu chỉ có pad nhỏ */
function drumLoop(bpm: number, seconds: number, opts: { fourOnFloor?: boolean; intro?: number; offset?: number; swing?: number } = {}) {
  const out = new Float32Array(Math.round(SR * seconds))
  let seed = 7
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1
  for (let i = 0; i < out.length; i++) out[i] = rnd() * 0.01 + 0.05 * Math.sin((2 * Math.PI * 220 * i) / SR)
  const sp = 60 / bpm
  const hit = (t: number, f: (k: number) => number, len: number) => {
    const a = Math.round(t * SR)
    for (let k = 0; k < len * SR && a + k < out.length; k++) out[a + k] += f(k)
  }
  const kick = (t: number) => hit(t, (k) => 0.9 * Math.exp(-k / (SR * 0.08)) * Math.sin(2 * Math.PI * (55 + 90 * Math.exp(-k / (SR * 0.03))) * (k / SR)), 0.3)
  const snare = (t: number) => hit(t, (k) => 0.5 * Math.exp(-k / (SR * 0.06)) * rnd(), 0.2)
  const hat = (t: number) => hit(t, (k) => 0.12 * Math.exp(-k / (SR * 0.01)) * rnd(), 0.05)
  const start = (opts.intro ?? 0) + (opts.offset ?? 0)
  for (let b = 0, t = start; t < seconds - 0.3; b++, t = start + b * sp) {
    if (opts.fourOnFloor || b % 4 === 0 || b % 4 === 2) kick(t)
    if (b % 4 === 1 || b % 4 === 3) snare(t)
    hat(t)
    hat(t + sp * (0.5 + (opts.swing ?? 0)))
  }
  return { samples: out, start, sp }
}

const near = (arr: number[], t: number) => Math.min(...arr.map((x) => Math.abs(x - t)))

test('hip hop boom bap 92 BPM: đúng tempo, beat trùng nhịp trống', () => {
  const { samples, start, sp } = drumLoop(92, 30, { offset: 0.37 })
  const r = analyzeBeats(samples, SR)
  assert.ok(Math.abs(r.bpm - 92) < 1.5, `bpm ${r.bpm}`)
  for (let b = 4; b < 30; b++) assert.ok(near(r.beats, start + b * sp) < 0.04, `beat ${b} lệch ${near(r.beats, start + b * sp).toFixed(3)}`)
  // phách mạnh rơi vào kick đầu ô nhịp (beat 0, 4, 8…)
  const bars = r.downbeats.filter((t) => t > 2 && t < 25)
  assert.ok(bars.length >= 6)
  for (const t of bars) assert.ok(Math.abs(((t - start) / sp) % 4) < 0.15 || Math.abs(((t - start) / sp) % 4 - 4) < 0.15 || Math.abs(((t - start) / sp) % 4 - 2) < 0.15, `downbeat ${t}`)
})

test('old school có swing 98 BPM và club house 124 BPM', () => {
  const a = analyzeBeats(drumLoop(98, 25, { swing: 0.08 }).samples, SR)
  assert.ok(Math.abs(a.bpm - 98) < 1.5, `old school ${a.bpm}`)
  const b = analyzeBeats(drumLoop(124, 25, { fourOnFloor: true }).samples, SR)
  assert.ok(Math.abs(b.bpm - 124) < 1.5, `house ${b.bpm}`)
})

test('đoạn intro nhỏ rồi trống vào: năng lượng phần trống cao hơn hẳn', () => {
  const { samples } = drumLoop(95, 30, { intro: 8 })
  const r = analyzeBeats(samples, SR)
  const avg = (f: (t: number) => boolean) => {
    const v = r.energy.filter((_, i) => f(r.beats[i]))
    return v.reduce((a, b) => a + b, 0) / v.length
  }
  assert.ok(avg((t) => t > 12) > avg((t) => t < 6) + 0.3, `${avg((t) => t < 6)} -> ${avg((t) => t > 12)}`)
  assert.ok(Math.abs(r.bpm - 95) < 1.5, `bpm ${r.bpm}`)
})

test('gridBeats cho nhạc tự tạo', () => {
  const g = gridBeats(120, 4)
  assert.deepEqual(g.beats, [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5])
  assert.deepEqual(g.downbeats, [0, 2])
})
