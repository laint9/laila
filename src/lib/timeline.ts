// Logic timeline thuần (không phụ thuộc React) để dễ test.
// Clip có tốc độ (speed) và chuyển cảnh sang clip kế tiếp (chồng lấn như CapCut).
import type { Project, Track, TrackClip, TimelineClip } from '../../shared/types'

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

// ---------- track phụ (video phủ / âm thanh) ----------

export const tSpeed = (c: TrackClip) => Math.min(4, Math.max(0.25, c.speed ?? 1))
export const tLength = (c: TrackClip) => Math.max(0, c.out - c.in) / tSpeed(c)
export const tEnd = (c: TrackClip) => c.start + tLength(c)

export const trackEnd = (t: Track) => t.clips.reduce((m, c) => Math.max(m, tEnd(c)), 0)

/** Tổng thời lượng video: dài nhất giữa track chính và các track phụ */
export function projectDuration(p: Pick<Project, 'timeline' | 'tracks'>): number {
  return Math.max(totalDuration(p.timeline), ...(p.tracks ?? []).filter((t) => !(t.kind === 'video' && t.hidden)).map(trackEnd), 0)
}

/** Clip của track tại thời điểm t */
export function trackClipAt(t: Track, time: number): TrackClip | null {
  return t.clips.find((c) => time >= c.start - 1e-6 && time < tEnd(c)) ?? null
}

const overlaps = (a0: number, a1: number, b0: number, b1: number) => a0 < b1 - 1e-6 && b0 < a1 - 1e-6

/** Vị trí bắt đầu gần `start` nhất mà không đè clip khác (ưu tiên lùi về sau) */
export function freeStart(clips: TrackClip[], start: number, len: number, ignoreId?: string): number {
  const others = clips.filter((c) => c.id !== ignoreId).sort((a, b) => a.start - b.start)
  let s = Math.max(0, start)
  for (let guard = 0; guard < 1000; guard++) {
    const hit = others.find((c) => overlaps(s, s + len, c.start, tEnd(c)))
    if (!hit) return s
    s = tEnd(hit)
  }
  return s
}

export function fitsAt(clips: TrackClip[], start: number, len: number, ignoreId?: string): boolean {
  return start >= 0 && !clips.some((c) => c.id !== ignoreId && overlaps(start, start + len, c.start, tEnd(c)))
}

/** Tách clip track tại thời điểm time */
export function splitTrackClip(t: Track, clipId: string, time: number, newId: () => string): Track {
  const c = t.clips.find((x) => x.id === clipId)
  if (!c || time <= c.start + MIN_CLIP || time >= tEnd(c) - MIN_CLIP) return t
  const cut = c.in + (time - c.start) * tSpeed(c)
  const a: TrackClip = { ...c, out: cut }
  const b: TrackClip = { ...c, id: newId(), in: cut, start: time }
  return { ...t, clips: t.clips.flatMap((x) => (x.id === clipId ? [a, b] : [x])) }
}

/** Trim mép clip track: mép trái đổi cả in lẫn start (giữ nguyên nội dung phía sau) */
export function trimTrackClip(c: TrackClip, edge: 'in' | 'out', value: number, mediaDuration: number): TrackClip {
  const sp = tSpeed(c)
  if (edge === 'in') {
    const nin = Math.min(Math.max(0, value), c.out - MIN_CLIP)
    return { ...c, in: nin, start: Math.max(0, c.start + (nin - c.in) / sp) }
  }
  return { ...c, out: Math.max(Math.min(mediaDuration, value), c.in + MIN_CLIP) }
}

/** Project cũ có `music` -> chuyển thành track âm thanh */
export function migrateProject<T extends Project>(p: T, newId: () => string, mediaDuration: (id: string) => number): T {
  if (!p.music) return { ...p, tracks: p.tracks ?? [] }
  const { music, ...rest } = p
  const audio: Track = {
    id: newId(),
    kind: 'audio',
    name: 'Nhạc nền',
    clips: [{ id: newId(), mediaId: music.mediaId, start: 0, in: music.in, out: mediaDuration(music.mediaId) || music.in + 1, volume: music.volume }]
  }
  return { ...(rest as T), tracks: [...(p.tracks ?? []), audio] }
}

/** Ảnh tĩnh kéo dài được tới mức này (giây) */
export const IMAGE_MAX = 3600

/** Giới hạn điểm ra khi trim: video/âm thanh theo độ dài file, ảnh thì gần như không giới hạn */
export const mediaLimit = (m: { kind: string; duration: number }) => (m.kind === 'image' ? IMAGE_MAX : m.duration)
