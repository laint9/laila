// Mô hình scene kiểu After Effects: composition gồm các layer, mỗi thuộc tính có thể có keyframe.

export type EaseName =
  | 'linear'
  | 'hold'
  | 'easyEase'
  | 'easeIn'
  | 'easeOut'
  | 'easeOutCubic'
  | 'easeInOutCubic'
  | 'easeOutQuart'
  | 'easeOutExpo'
  | 'easeInOutExpo'
  | 'easeOutBack'
  | 'easeOutElastic'
  | 'easeOutBounce'

/** Tên preset hoặc cubic-bezier [x1, y1, x2, y2] như graph editor/Flow */
export type Ease = EaseName | [number, number, number, number]

/** Keyframe: ease áp dụng cho đoạn từ keyframe này tới keyframe kế tiếp */
export interface Keyframe {
  t: number
  v: number
  ease: Ease
}

export interface Prop {
  v: number
  keys?: Keyframe[]
  /** expression wiggle(freq, amp) như AE */
  wiggle?: { freq: number; amp: number } | null
}

export const TRANSFORM_PROPS = ['x', 'y', 'scale', 'rotation', 'opacity', 'blur'] as const
export type TransformProp = (typeof TRANSFORM_PROPS)[number]

export type BlendMode = 'normal' | 'multiply' | 'screen' | 'add' | 'overlay'

export type TextPreset = 'fade' | 'slideUp' | 'slideDown' | 'slideLeft' | 'scale' | 'blur' | 'typewriter' | 'rotate' | 'mask'

/** Text animator kiểu AE (range selector theo ký tự/từ/dòng), đóng gói thành preset có tham số */
export interface TextAnimator {
  preset: TextPreset
  unit: 'char' | 'word' | 'line'
  /** thời gian mỗi đơn vị chạy (giây) */
  duration: number
  /** độ trễ giữa các đơn vị (giây) */
  stagger: number
  /** trễ so với đầu (in) hoặc cuối (out) layer */
  delay: number
  ease: Ease
  order: 'forward' | 'reverse' | 'center' | 'random'
  /** quãng đường trượt, tính theo cỡ chữ (0.6 = 60% cỡ chữ) */
  distance: number
}

export interface TextData {
  content: string
  font: string
  size: number
  weight: number
  color: string
  align: 'left' | 'center' | 'right'
  lineHeight: number
  tracking: Prop
  /** 0 = không xuống dòng tự động */
  maxWidth: number
  animIn: TextAnimator | null
  animOut: TextAnimator | null
}

export interface ShapeData {
  kind: 'rect' | 'ellipse' | 'line'
  width: Prop
  height: Prop
  radius: number
  fill: string | null
  stroke: string | null
  strokeWidth: number
  /** Trim Paths: phần trăm nét được vẽ (0-100) */
  trimEnd: Prop
}

export interface ImageData {
  /** tên brand element ảnh */
  src: string
  width: number
}

interface LayerBase {
  id: string
  name: string
  in: number
  out: number
  visible: boolean
  locked: boolean
  parent: string | null
  /** điểm neo trong hộp layer, 0..1 */
  anchor: [number, number]
  blend: BlendMode
  transform: Record<TransformProp, Prop>
}

export interface TextLayer extends LayerBase {
  type: 'text'
  text: TextData
}
export interface ShapeLayer extends LayerBase {
  type: 'shape'
  shape: ShapeData
}
export interface ImageLayer extends LayerBase {
  type: 'image'
  image: ImageData
}
/** Layer code tự do (particles, nền động…) chạy trong sandbox: render(ctx, t, api) */
export interface CodeLayer extends LayerBase {
  type: 'code'
  code: { source: string }
}

export type Layer = TextLayer | ShapeLayer | ImageLayer | CodeLayer
export type LayerType = Layer['type']

export interface MotionScene {
  background: string | null
  /** layers[0] nằm trên cùng (giống thứ tự trong AE) */
  layers: Layer[]
}
