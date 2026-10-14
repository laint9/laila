// Dựng tự động theo nhạc: chia video thành các cảnh, chấm điểm từng đoạn, rồi cắt khớp beat
// trong đúng thời lượng yêu cầu. Thuần tính toán để test được ngoài app.
import type { BeatInfo } from '../audio/beats'

export interface FrameStats {
  fps: number
  motion: number[]
  luma: number[]
  sat: number[]
}

export interface SourceInfo {
  mediaId: string
  duration: number
  frames: FrameStats
}

export interface Shot {
  mediaId: string
  start: number
  end: number
  /** điểm Claude chấm 0..10 (nếu có) */
  rating?: number
  tag?: string
  skip?: boolean
}

export type Pace = 'auto' | 'beat' | 'half' | 'bar'

export interface EditOptions {
  /** tổng thời lượng video (giây) */
  duration: number
  pace: Pace
  /** 'auto' = tự chọn đoạn sôi động nhất; số = giây bắt đầu trong bài */
  musicStart: 'auto' | number
}

export interface Slot {
  /** thời điểm trên timeline (giây, tính từ đầu video) */
  t0: number
  t1: number
  /** độ sôi động của nhạc trong slot 0..1 */
  energy: number
  mediaId: string
  in: number
  out: number
}

export interface EditPlan {
  bpm: number
  musicStart: number
  duration: number
  slots: Slot[]
  /** beat trên timeline (để hiện vạch và hít khi chỉnh tay) */
  beats: number[]
}

// ---------- chia cảnh ----------

/** Tách cảnh tại chỗ độ thay đổi khung hình vọt lên (cắt cảnh trong video gốc) */
export function detectShots(src: SourceInfo, threshold = 0.3, minLen = 0.5): Shot[] {
  const { fps, motion } = src.frames
  const cuts = [0]
  for (let i = 1; i < motion.length; i++) {
    const t = i / fps
    if (motion[i] > threshold && t - cuts[cuts.length - 1] >= minLen && src.duration - t >= minLen) cuts.push(t)
  }
  cuts.push(src.duration)
  const shots: Shot[] = []
  for (let i = 0; i < cuts.length - 1; i++) shots.push({ mediaId: src.mediaId, start: cuts[i], end: cuts[i + 1] })
  return shots
}

// ---------- chọn đoạn nhạc ----------

const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0)

/** Chọn điểm bắt đầu (một phách mạnh) để đoạn nhạc sôi động nhất, ưu tiên đúng chỗ "drop" */
export function pickMusicStart(info: BeatInfo, duration: number): number {
  const cands = info.downbeats.filter((t) => t + duration <= info.duration + 0.05)
  if (!cands.length) return info.downbeats[0] ?? 0
  const eAt = (a: number, b: number) => mean(info.beats.map((t, i) => (t >= a && t < b ? info.energy[i] : NaN)).filter((x) => !Number.isNaN(x)))
  const bar = (60 / info.bpm) * 4
  let best = cands[0],
    bestScore = -Infinity
  for (const t of cands) {
    const inside = eAt(t, t + duration)
    const jump = eAt(t, t + 2 * bar) - eAt(t - 2 * bar, t)
    const s = inside + 0.5 * Math.max(0, jump) - 0.002 * t // hoà điểm thì lấy đoạn sớm hơn
    if (s > bestScore) {
      bestScore = s
      best = t
    }
  }
  return best
}

// ---------- chia slot theo beat ----------

/** Số beat mỗi lần cắt theo nhịp độ và độ sôi động */
function beatsPerCut(pace: Pace, energy: number, beatLen: number): number {
  const minCut = 0.33 // cắt nhanh hơn mức này thì mắt không kịp đọc hình
  let n = pace === 'beat' ? 1 : pace === 'half' ? 2 : pace === 'bar' ? 4 : energy > 0.62 ? 1 : energy > 0.3 ? 2 : 4
  while (n * beatLen < minCut && n < 4) n *= 2
  return n
}

export function planSlots(info: BeatInfo, start: number, duration: number, pace: Pace): { t0: number; t1: number; energy: number }[] {
  const beatLen = 60 / info.bpm
  const end = start + duration
  // các beat trong đoạn, kèm năng lượng; bảo đảm có beat tại điểm bắt đầu
  const idx = info.beats.map((t, i) => i).filter((i) => info.beats[i] >= start - 0.02 && info.beats[i] < end - 0.05)
  const times = idx.map((i) => info.beats[i])
  const energy = idx.map((i) => info.energy[i] ?? 0.5)
  if (!times.length || times[0] > start + 0.02) {
    times.unshift(start)
    energy.unshift(energy[0] ?? 0.5)
  }
  // nhạc ngắn hơn yêu cầu: kéo lưới beat ra tới hết
  while (times[times.length - 1] + beatLen < end - 0.05) {
    times.push(times[times.length - 1] + beatLen)
    energy.push(energy[energy.length - 1])
  }
  const slots: { t0: number; t1: number; energy: number }[] = []
  let i = 0
  while (i < times.length) {
    // độ sôi động của ô nhịp hiện tại quyết định nhịp cắt
    const barE = mean(energy.slice(i, i + 4))
    let n = beatsPerCut(pace, barE, beatLen)
    // giữ điểm cắt khớp ô nhịp: không để slot vắt qua phách mạnh khi cắt chậm
    const posInBar = i % 4
    if (posInBar + n > 4) n = 4 - posInBar
    const t0 = times[i] - start
    const j = Math.min(times.length, i + n)
    const t1 = j < times.length ? times[j] - start : duration
    slots.push({ t0, t1, energy: mean(energy.slice(i, j)) })
    i = j
  }
  // slot cuối quá ngắn (< nửa beat) thì gộp vào slot trước
  if (slots.length > 1 && slots[slots.length - 1].t1 - slots[slots.length - 1].t0 < beatLen / 2) {
    const last = slots.pop()!
    slots[slots.length - 1].t1 = last.t1
  }
  slots[0].t0 = 0
  slots[slots.length - 1].t1 = duration
  return slots
}

// ---------- chấm điểm & ghép ----------

interface Window {
  mediaId: string
  in: number
  out: number
  motion: number
  quality: number
  shotKey: string
}

/** Phân vị (0..1) của từng giá trị trong mảng tham chiếu đã sắp xếp */
const rankIn = (sorted: number[], v: number) => {
  let lo = 0,
    hi = sorted.length
  while (lo < hi) {
    const m = (lo + hi) >> 1
    if (sorted[m] < v) lo = m + 1
    else hi = m
  }
  return sorted.length ? lo / sorted.length : 0.5
}

function windowsFor(len: number, sources: SourceInfo[], shots: Shot[]): Window[] {
  const allMotion = sources.flatMap((s) => s.frames.motion).sort((a, b) => a - b)
  const allLuma = sources.flatMap((s) => s.frames.luma).sort((a, b) => a - b)
  const allSat = sources.flatMap((s) => s.frames.sat).sort((a, b) => a - b)
  const out: Window[] = []
  for (const sh of shots) {
    if (sh.skip) continue
    const src = sources.find((s) => s.mediaId === sh.mediaId)
    if (!src) continue
    const { fps, motion, luma, sat } = src.frames
    // tránh 0.12s sát điểm cắt của video gốc
    const a = sh.start + (sh.start > 0 ? 0.12 : 0)
    const b = sh.end - (sh.end < src.duration ? 0.12 : 0)
    if (b - a < len) continue
    const step = Math.max(0.25, Math.min(1, (b - a - len) / 12))
    for (let t = a; t + len <= b + 1e-6; t += step) {
      const i0 = Math.floor(t * fps),
        i1 = Math.max(i0 + 1, Math.ceil((t + len) * fps))
      // bỏ khung đầu (điểm cắt) khi tính chuyển động
      const m = mean(motion.slice(i0 + 1, i1))
      const l = mean(luma.slice(i0, i1))
      const minL = Math.min(...luma.slice(i0, i1))
      const sa = mean(sat.slice(i0, i1))
      const mp = rankIn(allMotion, m)
      const lp = rankIn(allLuma, l)
      let q = 0.35 * mp + 0.25 * lp + 0.2 * rankIn(allSat, sa)
      if (minL < 14) q -= 0.6 // có khung gần như đen
      if (lp < 0.1) q -= 0.2
      if (sh.rating !== undefined) q += 0.5 * (sh.rating / 10 - 0.5)
      out.push({ mediaId: sh.mediaId, in: t, out: t + len, motion: mp, quality: q, shotKey: `${sh.mediaId}@${sh.start}` })
    }
  }
  return out
}

export function buildPlan(info: BeatInfo, sources: SourceInfo[], shots: Shot[], opts: EditOptions): EditPlan {
  const duration = Math.max(1, opts.duration)
  const musicStart = opts.musicStart === 'auto' ? pickMusicStart(info, duration) : Math.max(0, opts.musicStart)
  const raw = planSlots(info, musicStart, duration, opts.pace)
  const used = new Map<string, [number, number][]>()
  const shotUse = new Map<string, number>()
  const slots: Slot[] = []
  const cache = new Map<string, Window[]>()
  raw.forEach((sl, k) => {
    const len = +(sl.t1 - sl.t0).toFixed(3)
    const key = len.toFixed(2)
    if (!cache.has(key)) cache.set(key, windowsFor(len, sources, shots))
    let cands = cache.get(key)!
    const overlaps = (w: Window) => (used.get(w.mediaId) ?? []).some(([a, b]) => w.in < b + 0.2 && a < w.out + 0.2)
    let fresh = cands.filter((w) => !overlaps(w))
    if (!fresh.length) fresh = cands // hết cảnh mới: cho dùng lại
    if (!fresh.length) {
      // không cảnh nào đủ dài: lấy đoạn đầu video dài nhất (tua chậm sẽ do người dùng chỉnh)
      const s = sources.slice().sort((a, b) => b.duration - a.duration)[0]
      cands = [{ mediaId: s.mediaId, in: 0, out: Math.min(len, s.duration), motion: 0.5, quality: 0, shotKey: 'x' }]
      fresh = cands
    }
    const prev = slots[k - 1]?.mediaId
    const prev2 = slots[k - 2]?.mediaId
    let best = fresh[0],
      bestS = -Infinity
    for (const w of fresh) {
      // slot đầu là "hook": lấy đoạn đẹp nhất; các slot sau khớp chuyển động với độ sôi động của nhạc
      let s = k === 0 ? 1.5 * w.quality + 0.3 * w.motion : w.quality + 0.6 * (1 - Math.abs(w.motion - sl.energy))
      if (sources.length > 1 && w.mediaId === prev) s -= 0.5
      if (sources.length > 2 && w.mediaId === prev2) s -= 0.15
      s -= 0.25 * (shotUse.get(w.shotKey) ?? 0)
      if (overlaps(w)) s -= 1
      if (s > bestS) {
        bestS = s
        best = w
      }
    }
    used.set(best.mediaId, [...(used.get(best.mediaId) ?? []), [best.in, best.out]])
    shotUse.set(best.shotKey, (shotUse.get(best.shotKey) ?? 0) + 1)
    slots.push({ ...sl, mediaId: best.mediaId, in: +best.in.toFixed(3), out: +(best.in + len).toFixed(3) })
  })
  const beats = info.beats.filter((t) => t >= musicStart - 0.01 && t < musicStart + duration).map((t) => +(t - musicStart).toFixed(3))
  return { bpm: info.bpm, musicStart, duration, slots, beats }
}
