// Chuẩn hoá dữ liệu scene (từ Claude hoặc file cũ): điền mặc định, kẹp giá trị, bỏ thứ không hợp lệ.
import { EASE_BEZIER } from './ease'
import type {
  BlendMode,
  Ease,
  EaseName,
  Keyframe,
  Layer,
  LayerType,
  MotionScene,
  Prop,
  TextAnimator,
  TextPreset,
  TransformProp
} from './types'
import { TRANSFORM_PROPS } from './types'

const EASE_NAMES = new Set<string>([...Object.keys(EASE_BEZIER), 'hold', 'easeOutElastic', 'easeOutBounce'])
const TEXT_PRESETS = new Set<TextPreset>(['fade', 'slideUp', 'slideDown', 'slideLeft', 'scale', 'blur', 'typewriter', 'rotate', 'mask'])
const BLENDS = new Set<BlendMode>(['normal', 'multiply', 'screen', 'add', 'overlay'])

const num = (v: unknown, d: number, min = -1e6, max = 1e6) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d
}
const str = (v: unknown, d: string) => (typeof v === 'string' ? v : d)
const obj = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, unknown>) : null)

/** Các tuỳ chọn kiểu chữ / đoạn văn: chỉ giữ khi có, để scene cũ không đổi */
function normTextStyle(t: Record<string, unknown>) {
  const out: Record<string, unknown> = {}
  if (t.italic === true) out.italic = true
  if (t.uppercase === true) out.uppercase = true
  if (t.paraSpacing !== undefined) out.paraSpacing = num(t.paraSpacing, 0, 0, 10)
  if (t.indent !== undefined) out.indent = num(t.indent, 0, 0, 2000)
  const st = obj(t.stroke)
  if (st) out.stroke = { color: color(st.color, '#000000'), width: num(st.width, 2, 0, 200) }
  const sh = obj(t.shadow)
  if (sh) out.shadow = { color: color(sh.color, 'rgba(0,0,0,0.6)'), blur: num(sh.blur, 8, 0, 200), x: num(sh.x, 0, -500, 500), y: num(sh.y, 3, -500, 500) }
  const bx = obj(t.box)
  if (bx) out.box = { color: color(bx.color, '#000000'), opacity: num(bx.opacity, 0.6, 0, 1), padding: num(bx.padding, 16, 0, 1000), radius: num(bx.radius, 8, 0, 1000) }
  return out
}
const color = (v: unknown, d: string | null) => (typeof v === 'string' && v.trim() ? v.trim() : d)

let idSeq = 0
export const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().slice(0, 8) : `l${Date.now()}${++idSeq}`

export function normEase(e: unknown): Ease {
  if (Array.isArray(e) && e.length === 4 && e.every((x) => typeof x === 'number')) {
    return [num(e[0], 0.33, 0, 1), num(e[1], 0, -2, 3), num(e[2], 0.67, 0, 1), num(e[3], 1, -2, 3)]
  }
  if (typeof e === 'string' && EASE_NAMES.has(e)) return e as EaseName
  return 'easyEase'
}

export function prop(v: number, keys?: Keyframe[]): Prop {
  return keys && keys.length ? { v, keys } : { v }
}

export function normProp(raw: unknown, d: number, min = -1e6, max = 1e6): Prop {
  if (typeof raw === 'number' || typeof raw === 'string') return { v: num(raw, d, min, max) }
  if (!raw || typeof raw !== 'object') return { v: d }
  const r = raw as Record<string, unknown>
  const keys = Array.isArray(r.keys)
    ? (r.keys as unknown[])
        .filter((k): k is Record<string, unknown> => !!k && typeof k === 'object')
        .map((k) => ({ t: num(k.t, 0, 0, 3600), v: num(k.v, d, min, max), ease: normEase(k.ease) }))
        .sort((a, b) => a.t - b.t)
    : undefined
  const out: Prop = { v: num(r.v, keys?.[0]?.v ?? d, min, max) }
  if (keys && keys.length) out.keys = keys
  const w = r.wiggle as Record<string, unknown> | undefined
  if (w && typeof w === 'object' && num(w.amp, 0) !== 0) out.wiggle = { freq: num(w.freq, 2, 0, 30), amp: num(w.amp, 0, -5000, 5000) }
  return out
}

export function defaultAnimator(preset: TextPreset = 'slideUp'): TextAnimator {
  return {
    preset,
    unit: preset === 'mask' ? 'line' : preset === 'typewriter' ? 'char' : 'word',
    duration: preset === 'typewriter' ? 0.05 : 0.6,
    stagger: preset === 'typewriter' ? 0.04 : 0.08,
    delay: 0,
    ease: 'easeOutExpo',
    order: 'forward',
    distance: 0.6
  }
}

function normAnimator(raw: unknown): TextAnimator | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const preset = TEXT_PRESETS.has(r.preset as TextPreset) ? (r.preset as TextPreset) : 'fade'
  const d = defaultAnimator(preset)
  return {
    preset,
    unit: r.unit === 'char' || r.unit === 'word' || r.unit === 'line' ? r.unit : d.unit,
    duration: num(r.duration, d.duration, 0.01, 10),
    stagger: num(r.stagger, d.stagger, 0, 5),
    delay: num(r.delay, 0, 0, 30),
    ease: normEase(r.ease ?? d.ease),
    order: r.order === 'reverse' || r.order === 'center' || r.order === 'random' ? r.order : 'forward',
    distance: num(r.distance, d.distance, -10, 10)
  }
}

export function defaultTransform(x: number, y: number): Record<TransformProp, Prop> {
  return { x: { v: x }, y: { v: y }, scale: { v: 100 }, rotation: { v: 0 }, opacity: { v: 100 }, blur: { v: 0 } }
}

export function normLayer(raw: unknown, duration: number, W: number, H: number): Layer | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, any>
  const type = r.type as LayerType
  if (!['text', 'shape', 'image', 'code'].includes(type)) return null
  const tr = (r.transform ?? {}) as Record<string, unknown>
  const transform = {} as Record<TransformProp, Prop>
  const ranges: Record<TransformProp, [number, number, number]> = {
    x: [W / 2, -1e5, 1e5],
    y: [H / 2, -1e5, 1e5],
    scale: [100, -10000, 10000],
    rotation: [0, -1e5, 1e5],
    opacity: [100, 0, 100],
    blur: [0, 0, 500]
  }
  for (const p of TRANSFORM_PROPS) transform[p] = normProp(tr[p], ranges[p][0], ranges[p][1], ranges[p][2])

  const inT = num(r.in, 0, 0, duration)
  const base = {
    id: str(r.id, '') || newId(),
    name: str(r.name, type),
    in: inT,
    out: Math.max(inT + 0.04, num(r.out, duration, 0, 3600)),
    visible: r.visible !== false,
    locked: r.locked === true,
    parent: typeof r.parent === 'string' && r.parent ? r.parent : null,
    anchor: (Array.isArray(r.anchor) && r.anchor.length === 2
      ? [num(r.anchor[0], 0.5, -5, 5), num(r.anchor[1], 0.5, -5, 5)]
      : [0.5, 0.5]) as [number, number],
    blend: BLENDS.has(r.blend) ? (r.blend as BlendMode) : 'normal',
    transform
  }

  if (type === 'text') {
    const t = (r.text ?? {}) as Record<string, unknown>
    return {
      ...base,
      type,
      text: {
        content: str(t.content, 'Text'),
        font: str(t.font, ''),
        size: num(t.size, Math.round(H * 0.08), 1, 2000),
        weight: num(t.weight, 600, 100, 900),
        color: color(t.color, '#FFFFFF')!,
        align: t.align === 'left' || t.align === 'right' || t.align === 'justify' ? t.align : 'center',
        lineHeight: num(t.lineHeight, 1.15, 0.5, 4),
        tracking: normProp(t.tracking, 0, -500, 2000),
        maxWidth: num(t.maxWidth, 0, 0, 20000),
        animIn: normAnimator(t.animIn),
        animOut: normAnimator(t.animOut),
        ...normTextStyle(t)
      }
    }
  }
  if (type === 'shape') {
    const s = (r.shape ?? {}) as Record<string, unknown>
    const kind = s.kind === 'ellipse' || s.kind === 'line' ? s.kind : 'rect'
    return {
      ...base,
      type,
      shape: {
        kind,
        width: normProp(s.width, W * 0.3, 0, 1e5),
        height: normProp(s.height, kind === 'line' ? 0 : H * 0.2, 0, 1e5),
        radius: num(s.radius, 0, 0, 1e4),
        fill: kind === 'line' ? null : color(s.fill, s.stroke ? null : '#FFFFFF'),
        stroke: color(s.stroke, kind === 'line' ? '#FFFFFF' : null),
        strokeWidth: num(s.strokeWidth, kind === 'line' ? 6 : 0, 0, 1000),
        trimEnd: normProp(s.trimEnd, 100, 0, 100)
      }
    }
  }
  if (type === 'image') {
    const i = (r.image ?? {}) as Record<string, unknown>
    return { ...base, type, image: { src: str(i.src, ''), width: num(i.width, W * 0.3, 1, 1e5) } }
  }
  const c = (r.code ?? {}) as Record<string, unknown>
  const source = str(c.source, '')
  if (!source.trim()) return null
  return { ...base, type: 'code', code: { source } }
}

export function normScene(raw: unknown, duration: number, W: number, H: number): MotionScene {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const layers = (Array.isArray(r.layers) ? r.layers : [])
    .map((l) => normLayer(l, duration, W, H))
    .filter((l): l is Layer => !!l)
  // id trùng -> đổi id mới; parent trỏ sai -> bỏ
  const seen = new Set<string>()
  for (const l of layers) {
    if (seen.has(l.id)) l.id = newId()
    seen.add(l.id)
  }
  for (const l of layers) if (l.parent && (!seen.has(l.parent) || l.parent === l.id)) l.parent = null
  // chặn vòng lặp parent
  const byId = new Map(layers.map((l) => [l.id, l]))
  for (const l of layers) {
    let p = l.parent
    let hops = 0
    while (p && hops < 50) {
      if (p === l.id) {
        l.parent = null
        break
      }
      p = byId.get(p)?.parent ?? null
      hops++
    }
  }
  return { background: color(r.background, null), layers }
}

/** Scene cũ chỉ có code -> scene 1 layer code phủ toàn bộ */
export function sceneFromCode(source: string, duration: number, W: number, H: number): MotionScene {
  return {
    background: null,
    layers: [
      {
        id: newId(),
        name: 'Code',
        type: 'code',
        in: 0,
        out: duration,
        visible: true,
        locked: false,
        parent: null,
        anchor: [0.5, 0.5],
        blend: 'normal',
        transform: defaultTransform(W / 2, H / 2),
        code: { source }
      }
    ]
  }
}
