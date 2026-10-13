// Logic timeline thuần (không phụ thuộc React) để dễ test.
import type { TimelineClip } from '../../shared/types'

export const MIN_CLIP = 0.1

export const clipLength = (c: TimelineClip) => Math.max(0, c.out - c.in)

export const totalDuration = (clips: TimelineClip[]) => clips.reduce((s, c) => s + clipLength(c), 0)

/** Thời điểm bắt đầu của từng clip trên timeline. */
export function clipStarts(clips: TimelineClip[]): number[] {
  const starts: number[] = []
  let acc = 0
  for (const c of clips) {
    starts.push(acc)
    acc += clipLength(c)
  }
  return starts
}

/** Tìm clip tại thời điểm t (giây trên timeline). */
export function locate(clips: TimelineClip[], t: number): { index: number; local: number } | null {
  let acc = 0
  for (let i = 0; i < clips.length; i++) {
    const len = clipLength(clips[i])
    if (t < acc + len || i === clips.length - 1) {
      return { index: i, local: Math.min(len, Math.max(0, t - acc)) }
    }
    acc += len
  }
  return null
}

/** Cắt clip tại playhead thành 2 clip. Trả về mảng mới, hoặc nguyên mảng nếu không cắt được. */
export function splitAt(clips: TimelineClip[], t: number, newId: () => string): TimelineClip[] {
  const hit = locate(clips, t)
  if (!hit) return clips
  const c = clips[hit.index]
  const cut = c.in + hit.local
  if (cut - c.in < MIN_CLIP || c.out - cut < MIN_CLIP) return clips
  const a: TimelineClip = { ...c, out: cut }
  const b: TimelineClip = { ...c, id: newId(), in: cut }
  return [...clips.slice(0, hit.index), a, b, ...clips.slice(hit.index + 1)]
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
