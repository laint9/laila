import type { Ease, EaseName, Keyframe, Prop } from './types'

export const EASE_BEZIER: Partial<Record<EaseName, [number, number, number, number]>> = {
  linear: [0, 0, 1, 1],
  easyEase: [0.33, 0, 0.67, 1],
  easeIn: [0.42, 0, 1, 1],
  easeOut: [0, 0, 0.58, 1],
  easeOutCubic: [0.33, 1, 0.68, 1],
  easeInOutCubic: [0.65, 0, 0.35, 1],
  easeOutQuart: [0.25, 1, 0.5, 1],
  easeOutExpo: [0.16, 1, 0.3, 1],
  easeInOutExpo: [0.87, 0, 0.13, 1],
  easeOutBack: [0.34, 1.56, 0.64, 1]
}

export const EASE_LABELS: Record<EaseName, string> = {
  linear: 'Linear',
  hold: 'Hold (giữ)',
  easyEase: 'Easy Ease',
  easeIn: 'Ease In',
  easeOut: 'Ease Out',
  easeOutCubic: 'Out Cubic',
  easeInOutCubic: 'In-Out Cubic',
  easeOutQuart: 'Out Quart',
  easeOutExpo: 'Out Expo (mượt mạnh)',
  easeInOutExpo: 'In-Out Expo',
  easeOutBack: 'Out Back (vượt rồi về)',
  easeOutElastic: 'Elastic (nảy lò xo)',
  easeOutBounce: 'Bounce (nảy)'
}

/** Giải cubic-bezier(x1,y1,x2,y2) như CSS */
export function bezier(x1: number, y1: number, x2: number, y2: number) {
  const cx = 3 * x1,
    bx = 3 * (x2 - x1) - cx,
    ax = 1 - cx - bx
  const cy = 3 * y1,
    by = 3 * (y2 - y1) - cy,
    ay = 1 - cy - by
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t
  const sy = (t: number) => ((ay * t + by) * t + cy) * t
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx
  return (x: number) => {
    if (x <= 0) return 0
    if (x >= 1) return 1
    let t = x
    for (let i = 0; i < 8; i++) {
      const e = sx(t) - x
      if (Math.abs(e) < 1e-6) return sy(t)
      const d = dx(t)
      if (Math.abs(d) < 1e-6) break
      t -= e / d
    }
    // bisection dự phòng
    let lo = 0,
      hi = 1
    t = x
    for (let i = 0; i < 30; i++) {
      const v = sx(t)
      if (Math.abs(v - x) < 1e-6) break
      if (v < x) lo = t
      else hi = t
      t = (lo + hi) / 2
    }
    return sy(t)
  }
}

const elastic = (x: number) => {
  const c4 = (2 * Math.PI) / 3
  return x === 0 ? 0 : x === 1 ? 1 : Math.pow(2, -10 * x) * Math.sin((x * 10 - 0.75) * c4) + 1
}
const bounce = (x: number) => {
  const n1 = 7.5625,
    d1 = 2.75
  if (x < 1 / d1) return n1 * x * x
  if (x < 2 / d1) return n1 * (x -= 1.5 / d1) * x + 0.75
  if (x < 2.5 / d1) return n1 * (x -= 2.25 / d1) * x + 0.9375
  return n1 * (x -= 2.625 / d1) * x + 0.984375
}

const cache = new Map<string, (x: number) => number>()

export function easeFn(e: Ease): (x: number) => number {
  const key = Array.isArray(e) ? e.join(',') : e
  let f = cache.get(key)
  if (f) return f
  if (Array.isArray(e)) f = bezier(e[0], e[1], e[2], e[3])
  else if (e === 'hold') f = (x) => (x >= 1 ? 1 : 0)
  else if (e === 'easeOutElastic') f = elastic
  else if (e === 'easeOutBounce') f = bounce
  else {
    const b = EASE_BEZIER[e] ?? EASE_BEZIER.easyEase!
    f = bezier(b[0], b[1], b[2], b[3])
  }
  cache.set(key, f)
  return f
}

/** Bezier tương đương để hiển thị trên graph editor (elastic/bounce không có) */
export function easeToBezier(e: Ease): [number, number, number, number] | null {
  if (Array.isArray(e)) return e
  return EASE_BEZIER[e] ?? null
}

// Nhiễu mượt xác định (cho wiggle): tổng vài sóng sin với pha lấy từ seed
function noise(t: number, seed: number) {
  const r = (n: number) => {
    const x = Math.sin(seed * 127.1 + n * 311.7) * 43758.5453
    return x - Math.floor(x)
  }
  return (
    (Math.sin(t * 2 * Math.PI + r(1) * 6.28) * 0.5 +
      Math.sin(t * 2 * Math.PI * 2.13 + r(2) * 6.28) * 0.3 +
      Math.sin(t * 2 * Math.PI * 4.37 + r(3) * 6.28) * 0.2) /
    1
  )
}

export function sortedKeys(p: Prop): Keyframe[] {
  return (p.keys ?? []).slice().sort((a, b) => a.t - b.t)
}

/** Giá trị thuộc tính tại thời điểm t (giây, tính trong scene) */
export function valueAt(p: Prop, t: number, seed = 0): number {
  let v = p.v
  const keys = p.keys
  if (keys && keys.length) {
    const ks = keys.length > 1 ? sortedKeys(p) : keys
    if (t <= ks[0].t) v = ks[0].v
    else if (t >= ks[ks.length - 1].t) v = ks[ks.length - 1].v
    else {
      for (let i = 0; i < ks.length - 1; i++) {
        const a = ks[i],
          b = ks[i + 1]
        if (t >= a.t && t <= b.t) {
          const u = b.t > a.t ? (t - a.t) / (b.t - a.t) : 1
          v = a.v + (b.v - a.v) * easeFn(a.ease)(u)
          break
        }
      }
    }
  }
  if (p.wiggle && p.wiggle.amp) v += noise(t * p.wiggle.freq, seed) * p.wiggle.amp
  return v
}

export const isAnimated = (p: Prop) => !!(p.keys && p.keys.length)
