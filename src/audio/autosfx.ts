// Tự gắn hiệu ứng âm thanh theo chuyển động của các scene trên timeline.
import type { Project } from '../../shared/types'
import { valueAt } from '../engine/ease'
import { normScene } from '../engine/normalize'
import type { Layer, MotionScene } from '../engine/types'
import { clipStarts, speedOf, tSpeed, transitionAfter } from '../lib/timeline'
import { normSfx, type SfxKind, type SfxSpec } from './spec'

export interface SfxEvent {
  t: number
  spec: SfxSpec
  /** mô tả để hiển thị */
  why: string
}

const ev = (t: number, kind: SfxKind, why: string, patch: Partial<SfxSpec> = {}): SfxEvent => ({ t, spec: normSfx({ kind, ...patch }), why })

/** Sự kiện âm thanh trong 1 scene (thời gian tính trong scene) */
export function sceneEvents(scene: MotionScene, W: number, H: number): SfxEvent[] {
  const out: SfxEvent[] = []
  const diag = Math.hypot(W, H)
  for (const l of scene.layers) {
    if (!l.visible || l.type === 'code') continue
    const name = l.name || l.type
    if (l.type === 'text' && l.text.animIn) {
      const a = l.text.animIn
      const t = l.in + a.delay
      if (a.preset === 'typewriter') {
        const n = [...l.text.content].length
        out.push(ev(t, 'typing', `${name}: chữ đánh máy`, { duration: Math.min(4, Math.max(0.3, n * a.stagger + a.duration)) }))
      } else if (a.preset === 'scale') out.push(ev(t, 'pop', `${name}: chữ bật lên`))
      else if (a.preset === 'fade' || a.preset === 'blur') out.push(ev(t, 'whoosh', `${name}: chữ hiện dần`, { intensity: 0.4, duration: 0.8 }))
      else out.push(ev(t, 'swish', `${name}: chữ trượt vào`))
    }
    // chuyển động lớn giữa 2 keyframe liền nhau
    const kx = l.transform.x.keys ?? []
    const ky = l.transform.y.keys ?? []
    const times = [...new Set([...kx, ...ky].map((k) => k.t))].sort((a, b) => a - b)
    for (let i = 0; i < times.length - 1; i++) {
      const a = times[i],
        b = times[i + 1]
      const dist = Math.hypot(valueAt(l.transform.x, b) - valueAt(l.transform.x, a), valueAt(l.transform.y, b) - valueAt(l.transform.y, a))
      if (dist > diag * 0.12) {
        const fast = dist / Math.max(0.05, b - a) > diag * 0.8
        out.push(ev(a, fast ? 'swish' : 'whoosh', `${name}: di chuyển`, { duration: Math.min(1.2, Math.max(0.3, (b - a) * 1.2)) }))
      }
    }
    // bật từ 0 lên (pop)
    const ks = l.transform.scale.keys ?? []
    if (ks.length >= 2 && ks[0].v < 20 && ks[1].v > 60) out.push(ev(ks[0].t, 'pop', `${name}: bật lên`))
    // xoay mạnh
    const kr = l.transform.rotation.keys ?? []
    if (kr.length >= 2 && Math.abs(kr[1].v - kr[0].v) >= 60) out.push(ev(kr[0].t, 'swish', `${name}: xoay`))
    // vẽ nét
    if (l.type === 'shape' && (l.shape.trimEnd.keys?.length ?? 0) >= 2) out.push(ev(l.shape.trimEnd.keys![0].t, 'swish', `${name}: vẽ nét`, { intensity: 0.4, duration: 0.5 }))
  }
  return out
}

/** Gộp các sự kiện quá gần nhau (giữ cái đầu), giới hạn số lượng */
export function dedupe(events: SfxEvent[], minGap = 0.15, max = 60): SfxEvent[] {
  const sorted = events.slice().sort((a, b) => a.t - b.t)
  const out: SfxEvent[] = []
  for (const e of sorted) {
    if (out.length && e.t - out[out.length - 1].t < minGap) continue
    out.push(e)
    if (out.length >= max) break
  }
  return out
}

/** Sự kiện trên toàn timeline: scene ở track chính, track phủ và các điểm chuyển cảnh */
export function timelineEvents(p: Project): SfxEvent[] {
  const { width: W, height: H } = p.settings
  const sceneOf = (mediaId: string) => {
    const m = p.media.find((x) => x.id === mediaId)
    const s = m?.sceneId ? p.scenes.find((x) => x.id === m.sceneId) : undefined
    return s?.motion ? normScene(s.motion, s.duration, W, H) : null
  }
  const out: SfxEvent[] = []
  const place = (scene: MotionScene, clipIn: number, clipOut: number, start: number, speed: number) => {
    for (const e of sceneEvents(scene, W, H)) {
      if (e.t < clipIn - 0.01 || e.t > clipOut) continue
      out.push({ ...e, t: start + (e.t - clipIn) / speed })
    }
  }
  const starts = clipStarts(p.timeline)
  p.timeline.forEach((c, i) => {
    const sc = sceneOf(c.mediaId)
    if (sc) place(sc, c.in, c.out, starts[i], speedOf(c))
    const td = transitionAfter(p.timeline, i)
    if (td > 0) out.push(ev(starts[i + 1], 'whoosh', 'Chuyển cảnh', { duration: Math.max(0.4, td * 1.4), intensity: 0.6 }))
  })
  for (const t of p.tracks ?? []) {
    if (t.kind !== 'video' || t.hidden) continue
    for (const c of t.clips) {
      const sc = sceneOf(c.mediaId)
      if (sc) place(sc, c.in, c.out, c.start, tSpeed(c))
    }
  }
  return dedupe(out)
}

export type { Layer }
