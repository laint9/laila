// Logic timeline thuần (không phụ thuộc React) để dễ test.
// Clip có tốc độ (speed) và chuyển cảnh sang clip kế tiếp (chồng lấn như CapCut).
import type { TimelineClip } from '../../shared/types'

export const MIN_CLIP = 0.1

export const speedOf = (c: TimelineClip) => Math.min(4, Math.max(0.25, c.speed ?? 1))

/** Độ dài clip trên timeline (đã tính tốc độ) */
export const clipLength = (c: TimelineClip) => Math.max(0, c.out - c.in) / speedOf(c)

/** Độ dài chuyển cảnh thực tế giữa clip i và i+1 (kẹp theo độ dài 2 clip) */
export function transitionAfter(clips: TimelineClip[], i: number): number {
  const c = clips[i]
  const n = clips[i + 1]
  if (!c || !n || !c.transition || c.transition === 'none') return 0
  const d = c.transitionDuration ?? 0.5
  return Math.max(0, Math.min(d, clipLength(c) * 0.45, clipLength(n) * 0.45))
}

/** Thời điểm bắt đầu của từng clip trên timeline */
export function clipStarts(clips: TimelineClip[]): number[] {
  const starts: number[] = []
  let acc = 0
  clips.forEach((c, i) => {
    starts.push(acc)
    acc += clipLength(c) - transitionAfter(clips, i)
  })
  return starts
}

export const totalDuration = (clips: TimelineClip[]) => {
  if (!clips.length) return 0
  const s = clipStarts(clips)
  return s[s.length - 1] + clipLength(clips[clips.length - 1])
}

/** Clip "chính" tại thời điểm t (clip sau thắng trong vùng chuyển cảnh) */
export function locate(clips: TimelineClip[], t: number): { index: number; local: number } | null {
  if (!clips.length) return null
  const starts = clipStarts(clips)
  for (let i = clips.length - 1; i >= 0; i--) {
    if (t >= starts[i] || i === 0) {
      const len = clipLength(clips[i])
      return { index: i, local: Math.min(len, Math.max(0, t - starts[i])) }
    }
  }
  return null
}

/** Mọi clip đang hiện tại t (2 clip khi đang chuyển cảnh) */
export function activeClips(clips: TimelineClip[], t: number): { index: number; local: number; source: number }[] {
  const starts = clipStarts(clips)
  const out: { index: number; local: number; source: number }[] = []
  clips.forEach((c, i) => {
    const len = clipLength(c)
    if (t >= starts[i] - 1e-6 && t < starts[i] + len) {
      const local = t - starts[i]
      out.push({ index: i, local, source: c.in + local * speedOf(c) })
    }
  })
  return out
}

/** Thời gian nguồn (trong file) ứng với vị trí local trong clip */
export const sourceTime = (c: TimelineClip, local: number) => c.in + local * speedOf(c)

/** Cắt clip tại playhead thành 2 clip. */
export function splitAt(clips: TimelineClip[], t: number, newId: () => string): TimelineClip[] {
  const hit = locate(clips, t)
  if (!hit) return clips
  const c = clips[hit.index]
  const cut = sourceTime(c, hit.local)
  if (cut - c.in < MIN_CLIP || c.out - cut < MIN_CLIP) return clips
  const a: TimelineClip = { ...c, out: cut, transition: 'none' }
  const b: TimelineClip = { ...c, id: newId(), in: cut }
  return [...clips.slice(0, hit.index), a, b, ...clips.slice(hit.index + 1)]
}

/** CapCut Q: xoá phần bên trái playhead của clip dưới playhead */
export function trimLeftAt(clips: TimelineClip[], t: number): TimelineClip[] {
  const hit = locate(clips, t)
  if (!hit) return clips
  const c = clips[hit.index]
  const cut = sourceTime(c, hit.local)
  if (c.out - cut < MIN_CLIP) return clips
  return clips.map((x, i) => (i === hit.index ? { ...x, in: cut } : x))
}

/** CapCut W: xoá phần bên phải playhead */
export function trimRightAt(clips: TimelineClip[], t: number): TimelineClip[] {
  const hit = locate(clips, t)
  if (!hit) return clips
  const c = clips[hit.index]
  const cut = sourceTime(c, hit.local)
  if (cut - c.in < MIN_CLIP) return clips
  return clips.map((x, i) => (i === hit.index ? { ...x, out: cut } : x))
}

export function trimClip(
  clips: TimelineClip[],
  id: string,
  edge: 'in' | 'out',
  value: number,
  mediaDuration: number
): TimelineClip[] {
  return clips.map((c) => {
    if (c.id !== id) return c
    if (edge === 'in') return { ...c, in: Math.min(Math.max(0, value), c.out - MIN_CLIP) }
    return { ...c, out: Math.max(Math.min(mediaDuration, value), c.in + MIN_CLIP) }
  })
}

export function moveClip(clips: TimelineClip[], id: string, toIndex: number): TimelineClip[] {
  const from = clips.findIndex((c) => c.id === id)
  if (from < 0) return clips
  const next = clips.slice()
  const [c] = next.splice(from, 1)
  const idx = Math.max(0, Math.min(next.length, toIndex > from ? toIndex - 1 : toIndex))
  next.splice(idx, 0, c)
  return next
}

/** Điểm hít (snap) trên timeline: đầu/cuối các clip */
export function snapPoints(clips: TimelineClip[]): number[] {
  const s = clipStarts(clips)
  return [0, ...clips.flatMap((c, i) => [s[i], s[i] + clipLength(c)])]
}
