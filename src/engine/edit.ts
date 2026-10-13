// Thao tác chỉnh sửa scene (thuần, trả về object mới) — dùng cho editor và có unit test.
import { valueAt } from './ease'
import { defaultAnimator, defaultTransform, newId } from './normalize'
import type { Ease, Keyframe, Layer, MotionScene, Prop, TextLayer, TransformProp } from './types'

export const KEY_EPS = 1 / 240

export function setPropAt(p: Prop, t: number, v: number): Prop {
  if (!p.keys || !p.keys.length) return { ...p, v }
  const keys = p.keys.slice()
  const i = keys.findIndex((k) => Math.abs(k.t - t) < KEY_EPS)
  if (i >= 0) keys[i] = { ...keys[i], v }
  else keys.push({ t, v, ease: nearestEase(keys, t) })
  keys.sort((a, b) => a.t - b.t)
  return { ...p, keys }
}

function nearestEase(keys: Keyframe[], t: number): Ease {
  const before = keys.filter((k) => k.t < t).pop()
  return before?.ease ?? 'easyEase'
}

/** Nút đồng hồ (stopwatch) của AE: bật -> tạo keyframe tại t; tắt -> bỏ hết keyframe */
export function toggleStopwatch(p: Prop, t: number): Prop {
  if (p.keys && p.keys.length) return { v: valueAt(p, t), wiggle: p.wiggle ?? null }
  return { ...p, keys: [{ t, v: p.v, ease: 'easyEase' }] }
}

export function hasKeyAt(p: Prop, t: number) {
  return !!p.keys?.some((k) => Math.abs(k.t - t) < KEY_EPS)
}

export function toggleKeyAt(p: Prop, t: number): Prop {
  if (!p.keys || !p.keys.length) return toggleStopwatch(p, t)
  if (hasKeyAt(p, t)) {
    const keys = p.keys.filter((k) => Math.abs(k.t - t) >= KEY_EPS)
    return keys.length ? { ...p, keys } : { ...p, v: valueAt(p, t), keys: undefined }
  }
  return setPropAt(p, t, valueAt(p, t))
}

export function moveKey(p: Prop, fromT: number, toT: number): Prop {
  if (!p.keys) return p
  const keys = p.keys
    .filter((k) => Math.abs(k.t - toT) >= KEY_EPS || Math.abs(k.t - fromT) < KEY_EPS)
    .map((k) => (Math.abs(k.t - fromT) < KEY_EPS ? { ...k, t: Math.max(0, toT) } : k))
    .sort((a, b) => a.t - b.t)
  return { ...p, keys }
}

export function setKeyEase(p: Prop, t: number, ease: Ease): Prop {
  if (!p.keys) return p
  return { ...p, keys: p.keys.map((k) => (Math.abs(k.t - t) < KEY_EPS ? { ...k, ease } : k)) }
}

export function nextKeyTime(props: Prop[], t: number, dir: 1 | -1): number | null {
  const times = props.flatMap((p) => (p.keys ?? []).map((k) => k.t))
  const cand = dir > 0 ? times.filter((x) => x > t + KEY_EPS).sort((a, b) => a - b) : times.filter((x) => x < t - KEY_EPS).sort((a, b) => b - a)
  return cand[0] ?? null
}

// ---------- truy cập thuộc tính theo đường dẫn ----------

export type PropPath = `transform.${TransformProp}` | 'text.tracking' | 'shape.width' | 'shape.height' | 'shape.trimEnd'

export function getProp(l: Layer, path: PropPath): Prop | null {
  const [group, key] = path.split('.') as [string, string]
  if (group === 'transform') return l.transform[key as TransformProp]
  if (group === 'text' && l.type === 'text') return l.text.tracking
  if (group === 'shape' && l.type === 'shape') return (l.shape as any)[key] as Prop
  return null
}

export function withProp(l: Layer, path: PropPath, fn: (p: Prop) => Prop): Layer {
  const [group, key] = path.split('.') as [string, string]
  if (group === 'transform') return { ...l, transform: { ...l.transform, [key]: fn(l.transform[key as TransformProp]) } }
  if (group === 'text' && l.type === 'text') return { ...l, text: { ...l.text, tracking: fn(l.text.tracking) } }
  if (group === 'shape' && l.type === 'shape') return { ...l, shape: { ...l.shape, [key]: fn((l.shape as any)[key]) } }
  return l
}

export function animatedPaths(l: Layer): PropPath[] {
  const all: PropPath[] = [
    'transform.x',
    'transform.y',
    'transform.scale',
    'transform.rotation',
    'transform.opacity',
    'transform.blur'
  ]
  if (l.type === 'text') all.push('text.tracking')
  if (l.type === 'shape') all.push('shape.width', 'shape.height', 'shape.trimEnd')
  return all.filter((p) => {
    const pr = getProp(l, p)
    return !!(pr && ((pr.keys && pr.keys.length) || pr.wiggle))
  })
}

export function updateLayer(scene: MotionScene, id: string, fn: (l: Layer) => Layer): MotionScene {
  return { ...scene, layers: scene.layers.map((l) => (l.id === id ? fn(l) : l)) }
}

// ---------- tạo layer mới ----------

const base = (name: string, W: number, H: number, inT: number, out: number) => ({
  id: newId(),
  name,
  in: inT,
  out,
  visible: true,
  locked: false,
  parent: null,
  anchor: [0.5, 0.5] as [number, number],
  blend: 'normal' as const,
  transform: defaultTransform(W / 2, H / 2)
})

export function newTextLayer(W: number, H: number, duration: number, content = 'Nhập chữ', font = ''): TextLayer {
  return {
    ...base('Text', W, H, 0, duration),
    type: 'text',
    text: {
      content,
      font,
      size: Math.round(Math.min(W, H) * 0.09),
      weight: 700,
      color: '#FFFFFF',
      align: 'center',
      lineHeight: 1.15,
      tracking: { v: 0 },
      maxWidth: Math.round(W * 0.8),
      animIn: defaultAnimator('slideUp'),
      animOut: null
    }
  }
}

export function newShapeLayer(W: number, H: number, duration: number, kind: 'rect' | 'ellipse' | 'line', color: string): Layer {
  const size = Math.min(W, H) * 0.3
  return {
    ...base(kind === 'rect' ? 'Rectangle' : kind === 'ellipse' ? 'Ellipse' : 'Line', W, H, 0, duration),
    type: 'shape',
    shape: {
      kind,
      width: { v: kind === 'line' ? W * 0.4 : size },
      height: { v: kind === 'line' ? 0 : size },
      radius: kind === 'rect' ? 24 : 0,
      fill: kind === 'line' ? null : color,
      stroke: kind === 'line' ? color : null,
      strokeWidth: kind === 'line' ? Math.max(4, Math.round(H * 0.006)) : 0,
      trimEnd: { v: 100 }
    }
  }
}

export function newImageLayer(W: number, H: number, duration: number, src: string): Layer {
  return { ...base(src || 'Image', W, H, 0, duration), type: 'image', image: { src, width: Math.min(W, H) * 0.35 } }
}

export function newCodeLayer(W: number, H: number, duration: number): Layer {
  return {
    ...base('Code FX', W, H, 0, duration),
    type: 'code',
    code: {
      source: `function render(ctx, t, api) {\n  // vẽ nền/hiệu ứng tuỳ ý. api.width, api.height, api.ease, api.random(seed)…\n  const g = ctx.createLinearGradient(0, 0, api.width, api.height)\n  g.addColorStop(0, '#1d1d1f')\n  g.addColorStop(1, '#3a3a3c')\n  ctx.fillStyle = g\n  ctx.fillRect(0, 0, api.width, api.height)\n}`
    }
  }
}

export function duplicateLayer(scene: MotionScene, id: string): MotionScene {
  const i = scene.layers.findIndex((l) => l.id === id)
  if (i < 0) return scene
  const copy = structuredClone(scene.layers[i])
  copy.id = newId()
  copy.name = copy.name + ' copy'
  const layers = scene.layers.slice()
  layers.splice(i, 0, copy)
  return { ...scene, layers }
}

/** Tách layer tại t (giống Split Layer ⇧⌘D trong AE) */
export function splitLayer(scene: MotionScene, id: string, t: number): MotionScene {
  const i = scene.layers.findIndex((l) => l.id === id)
  const l = scene.layers[i]
  if (!l || t <= l.in + 0.04 || t >= l.out - 0.04) return scene
  const a = { ...l, out: t }
  const b = { ...structuredClone(l), id: newId(), name: l.name + ' 2', in: t }
  const layers = scene.layers.slice()
  layers.splice(i, 1, b, a)
  return { ...scene, layers }
}

// ---------- preset chuyển động cho layer (In / Out / Loop) ----------

export type MotionPreset =
  | 'fadeIn'
  | 'slideUpIn'
  | 'slideLeftIn'
  | 'popIn'
  | 'zoomBlurIn'
  | 'blurIn'
  | 'spinIn'
  | 'drawOn'
  | 'fadeOut'
  | 'slideDownOut'
  | 'popOut'
  | 'blurOut'
  | 'wiggle'
  | 'float'
  | 'pulse'
  | 'clear'

export const PRESET_GROUPS: { label: string; items: { id: MotionPreset; label: string }[] }[] = [
  {
    label: 'Xuất hiện (In)',
    items: [
      { id: 'fadeIn', label: 'Fade in' },
      { id: 'slideUpIn', label: 'Trượt lên' },
      { id: 'slideLeftIn', label: 'Trượt từ phải' },
      { id: 'popIn', label: 'Pop (bật nảy)' },
      { id: 'zoomBlurIn', label: 'Zoom + blur' },
      { id: 'blurIn', label: 'Blur in' },
      { id: 'spinIn', label: 'Xoay vào' },
      { id: 'drawOn', label: 'Vẽ nét (Trim)' }
    ]
  },
  {
    label: 'Biến mất (Out)',
    items: [
      { id: 'fadeOut', label: 'Fade out' },
      { id: 'slideDownOut', label: 'Trượt xuống' },
      { id: 'popOut', label: 'Thu nhỏ' },
      { id: 'blurOut', label: 'Blur out' }
    ]
  },
  {
    label: 'Lặp (Loop)',
    items: [
      { id: 'wiggle', label: 'Wiggle (rung)' },
      { id: 'float', label: 'Lơ lửng' },
      { id: 'pulse', label: 'Nhịp đập' }
    ]
  },
  { label: 'Khác', items: [{ id: 'clear', label: 'Xoá keyframe' }] }
]

/** Ghi đè keyframe trong [t0, t1] bằng 2 keyframe from -> to */
function span(p: Prop, t0: number, t1: number, from: number, to: number, ease: Ease): Prop {
  const keep = (p.keys ?? []).filter((k) => k.t < t0 - KEY_EPS || k.t > t1 + KEY_EPS)
  const keys = [...keep, { t: t0, v: from, ease }, { t: t1, v: to, ease: 'easyEase' as Ease }].sort((a, b) => a.t - b.t)
  return { ...p, keys }
}

export function applyPreset(l: Layer, preset: MotionPreset, H: number, dur = 0.6): Layer {
  const tIn = l.in
  const tInEnd = Math.min(l.out, l.in + dur)
  const tOut = Math.max(l.in, l.out - dur - 0.001)
  const tOutEnd = l.out - 0.001
  const at = (p: TransformProp, t: number) => valueAt(l.transform[p], t)
  const set = (layer: Layer, p: TransformProp, fn: (pr: Prop) => Prop): Layer => ({
    ...layer,
    transform: { ...layer.transform, [p]: fn(layer.transform[p]) }
  })
  let r = l
  const restIn = (p: TransformProp) => at(p, tInEnd)
  const restOut = (p: TransformProp) => at(p, tOut)
  const dist = H * 0.08
  switch (preset) {
    case 'fadeIn':
      return set(r, 'opacity', (p) => span(p, tIn, tInEnd, 0, restIn('opacity'), 'easeOutCubic'))
    case 'slideUpIn':
      r = set(r, 'y', (p) => span(p, tIn, tInEnd, restIn('y') + dist, restIn('y'), 'easeOutExpo'))
      return set(r, 'opacity', (p) => span(p, tIn, tInEnd, 0, restIn('opacity'), 'easeOutCubic'))
    case 'slideLeftIn':
      r = set(r, 'x', (p) => span(p, tIn, tInEnd, restIn('x') + dist * 2, restIn('x'), 'easeOutExpo'))
      return set(r, 'opacity', (p) => span(p, tIn, tInEnd, 0, restIn('opacity'), 'easeOutCubic'))
    case 'popIn':
      return set(r, 'scale', (p) => span(p, tIn, tInEnd, 0, restIn('scale'), 'easeOutBack'))
    case 'zoomBlurIn':
      r = set(r, 'scale', (p) => span(p, tIn, tInEnd, restIn('scale') * 1.3, restIn('scale'), 'easeOutExpo'))
      r = set(r, 'blur', (p) => span(p, tIn, tInEnd, 30, 0, 'easeOutExpo'))
      return set(r, 'opacity', (p) => span(p, tIn, tInEnd, 0, restIn('opacity'), 'easeOutCubic'))
    case 'blurIn':
      r = set(r, 'blur', (p) => span(p, tIn, tInEnd, 40, 0, 'easeOutCubic'))
      return set(r, 'opacity', (p) => span(p, tIn, tInEnd, 0, restIn('opacity'), 'easeOutCubic'))
    case 'spinIn':
      r = set(r, 'rotation', (p) => span(p, tIn, tInEnd, restIn('rotation') - 90, restIn('rotation'), 'easeOutBack'))
      return set(r, 'scale', (p) => span(p, tIn, tInEnd, 0, restIn('scale'), 'easeOutExpo'))
    case 'drawOn':
      if (l.type !== 'shape') return applyPreset(l, 'fadeIn', H, dur)
      return { ...l, shape: { ...l.shape, trimEnd: span(l.shape.trimEnd, tIn, Math.min(l.out, l.in + dur * 1.5), 0, 100, 'easeInOutCubic') } }
    case 'fadeOut':
      return set(r, 'opacity', (p) => span(p, tOut, tOutEnd, restOut('opacity'), 0, 'easeInOutCubic'))
    case 'slideDownOut':
      r = set(r, 'y', (p) => span(p, tOut, tOutEnd, restOut('y'), restOut('y') + dist, 'easeIn'))
      return set(r, 'opacity', (p) => span(p, tOut, tOutEnd, restOut('opacity'), 0, 'easeIn'))
    case 'popOut':
      return set(r, 'scale', (p) => span(p, tOut, tOutEnd, restOut('scale'), 0, [0.36, 0, 0.66, -0.56]))
    case 'blurOut':
      r = set(r, 'blur', (p) => span(p, tOut, tOutEnd, 0, 40, 'easeIn'))
      return set(r, 'opacity', (p) => span(p, tOut, tOutEnd, restOut('opacity'), 0, 'easeIn'))
    case 'wiggle':
      r = set(r, 'x', (p) => ({ ...p, wiggle: { freq: 2, amp: H * 0.01 } }))
      return set(r, 'y', (p) => ({ ...p, wiggle: { freq: 2, amp: H * 0.01 } }))
    case 'float':
      r = set(r, 'y', (p) => ({ ...p, wiggle: { freq: 0.5, amp: H * 0.015 } }))
      return set(r, 'rotation', (p) => ({ ...p, wiggle: { freq: 0.4, amp: 2 } }))
    case 'pulse': {
      const s0 = at('scale', l.in)
      const keys: Keyframe[] = []
      for (let t = l.in; t <= l.out; t += 0.8) {
        keys.push({ t, v: s0, ease: 'easyEase' }, { t: Math.min(l.out, t + 0.4), v: s0 * 1.08, ease: 'easyEase' })
      }
      return set(r, 'scale', () => ({ v: s0, keys }))
    }
    case 'clear': {
      const tr = {} as Record<TransformProp, Prop>
      for (const k of Object.keys(l.transform) as TransformProp[]) tr[k] = { v: at(k, l.in + (l.out - l.in) / 2) }
      tr.opacity = { v: 100 }
      tr.blur = { v: 0 }
      const cleared = { ...l, transform: tr } as Layer
      if (cleared.type === 'shape') cleared.shape = { ...cleared.shape, trimEnd: { v: 100 } }
      return cleared
    }
  }
}
