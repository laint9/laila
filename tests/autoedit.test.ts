import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gridBeats, type BeatInfo } from '../src/audio/beats'
import { buildPlan, detectShots, pickMusicStart, planSlots, type SourceInfo } from '../src/lib/autoedit'
import { parseFrameStats } from '../electron/ffmpeg'

const fps = 8
/** video giả: các đoạn [độ dài, chuyển động, độ sáng] nối nhau, có cắt cảnh giữa đoạn */
function fake(id: string, parts: [number, number, number][]): SourceInfo {
  const motion: number[] = [], luma: number[] = [], sat: number[] = []
  parts.forEach(([len, m, l], p) => {
    for (let i = 0; i < len * fps; i++) {
      motion.push(i === 0 && p > 0 ? 0.8 : m)
      luma.push(l)
      sat.push(40)
    }
  })
  return { mediaId: id, duration: motion.length / fps, frames: { fps, motion, luma, sat } }
}

test('parseFrameStats đọc output metadata=print', () => {
  const txt = 'frame:0    pts:0       pts_time:0\nlavfi.signalstats.YAVG=120.5\nlavfi.signalstats.SATAVG=33\nframe:1    pts:1       pts_time:0.125\nlavfi.signalstats.YAVG=10\nlavfi.scene_score=0.42\n'
  const r = parseFrameStats(txt, 8)
  assert.deepEqual(r.luma, [120.5, 10])
  assert.deepEqual(r.motion, [0, 0.42])
  assert.deepEqual(r.sat, [33, 0])
})

test('detectShots tách tại điểm cắt cảnh', () => {
  const s = fake('a', [[3, 0.05, 100], [2, 0.1, 100], [4, 0.02, 100]])
  const shots = detectShots(s)
  assert.deepEqual(shots.map((x) => [x.start, x.end]), [[0, 3], [3, 5], [5, 9]])
})

test('planSlots: đúng thời lượng, mọi điểm cắt nằm trên beat, nhạc sôi động thì cắt dày hơn', () => {
  // 96 BPM, 8 ô nhịp đầu nhẹ, sau đó mạnh
  const g = gridBeats(96, 60)
  const info: BeatInfo = { ...g, energy: g.beats.map((t) => (t < 20 ? 0.15 : 0.9)) }
  const slots = planSlots(info, 0, 40, 'auto')
  assert.equal(slots[0].t0, 0)
  assert.equal(slots[slots.length - 1].t1, 40)
  for (let i = 1; i < slots.length; i++) assert.equal(slots[i].t0, slots[i - 1].t1)
  const beat = 60 / 96
  for (const s of slots.slice(0, -1)) assert.ok(Math.abs(s.t1 / beat - Math.round(s.t1 / beat)) < 1e-6, `cắt lệch beat ${s.t1}`)
  const len = (f: (t: number) => boolean) => {
    const v = slots.filter((s) => f(s.t0)).map((s) => s.t1 - s.t0)
    return v.reduce((a, b) => a + b, 0) / v.length
  }
  assert.ok(len((t) => t < 19) > 2 * len((t) => t > 21), `nhẹ ${len((t) => t < 19)} / mạnh ${len((t) => t > 21)}`)
  // không cảnh nào ngắn dưới 0.33s, kể cả ở tempo nhanh (trap 150)
  const fast = planSlots(gridBeats(150, 30), 0, 15, 'beat')
  assert.ok(fast.every((s) => s.t1 - s.t0 >= 0.33 || s === fast[fast.length - 1]))
})

test('pickMusicStart chọn đúng chỗ nhạc vào mạnh (drop)', () => {
  const g = gridBeats(100, 90)
  const info: BeatInfo = { ...g, energy: g.beats.map((t) => (t >= 33.6 && t < 70 ? 0.95 : 0.2)) }
  const s = pickMusicStart(info, 30)
  assert.ok(Math.abs(s - 33.6) < 2.5, `start ${s}`)
  assert.ok(info.downbeats.includes(s))
})

test('buildPlan: đủ 30s, xen kẽ nguồn, không lặp đoạn, tránh đoạn tối, hook là đoạn đẹp nhất', () => {
  const a = fake('a', [[6, 0.05, 90], [6, 0.25, 140], [6, 0.03, 8]])
  const b = fake('b', [[10, 0.12, 110], [8, 0.18, 120]])
  const c = fake('c', [[12, 0.08, 100]])
  const sources = [a, b, c]
  const shots = sources.flatMap((s) => detectShots(s))
  const info = gridBeats(95, 120, 0.7)
  const plan = buildPlan(info, sources, shots, { duration: 30, pace: 'half', musicStart: 'auto' })
  const total = plan.slots.reduce((s, x) => s + (x.t1 - x.t0), 0)
  assert.ok(Math.abs(total - 30) < 1e-6, `tổng ${total}`)
  for (const s of plan.slots) assert.ok(Math.abs(s.out - s.in - (s.t1 - s.t0)) < 1e-3)
  // không 2 cảnh liền nhau cùng nguồn
  for (let i = 1; i < plan.slots.length; i++) assert.notEqual(plan.slots[i].mediaId, plan.slots[i - 1].mediaId, `slot ${i}`)
  // không dùng đoạn tối của a (12s..18s)
  assert.ok(!plan.slots.some((s) => s.mediaId === 'a' && s.out > 12.2), 'dùng đoạn tối')
  // hook: đoạn chuyển động mạnh + sáng nhất (a 6..12)
  assert.equal(plan.slots[0].mediaId, 'a')
  assert.ok(plan.slots[0].in >= 6 && plan.slots[0].out <= 12)
  // không trùng thời gian trong cùng nguồn (đủ cảnh nên chưa phải dùng lại)
  for (const id of ['a', 'b', 'c']) {
    const r = plan.slots.filter((s) => s.mediaId === id).sort((x, y) => x.in - y.in)
    for (let i = 1; i < r.length; i++) assert.ok(r[i].in >= r[i - 1].out - 1e-6, `${id} lặp đoạn`)
  }
  assert.equal(plan.beats[0], 0)
})

test('buildPlan: Claude chấm cảnh thấp / bỏ qua thì không dùng', () => {
  const a = fake('a', [[8, 0.2, 130], [8, 0.2, 130]])
  const b = fake('b', [[16, 0.1, 100]])
  const shots = [...detectShots(a), ...detectShots(b)]
  shots[0].skip = true // a 0..8: Claude bảo bỏ (vd mờ, lộ mặt khách)
  const plan = buildPlan(gridBeats(100, 60), [a, b], shots, { duration: 12, pace: 'bar', musicStart: 0 })
  assert.ok(!plan.slots.some((s) => s.mediaId === 'a' && s.in < 8))
})
