// Clip chữ / hình trên timeline: mỗi clip là 1 layer của engine motion, vẽ bằng đúng renderer của Motion Editor
// nên xem trước và bản xuất giống hệt nhau.
import type { GraphicData, ProjectSettings, TrackClip } from '../../shared/types'
import { applyPreset, newShapeLayer, newTextLayer, type MotionPreset } from '../engine/edit'
import { defaultAnimator } from '../engine/normalize'
import type { Layer, MotionScene, ShapeLayer, TextLayer } from '../engine/types'

export const GRAPHIC_TRACK = 'Chữ & hình'
export const GRAPHIC_LEN = 3

export type TextPresetId = 'title' | 'subtitle' | 'paragraph' | 'lower' | 'neon' | 'outline' | 'tag'
export type ShapePresetId = 'rect' | 'ellipse' | 'line' | 'pill'

export const TEXT_PRESETS: { id: TextPresetId; label: string; sample: string }[] = [
  { id: 'title', label: 'Tiêu đề', sample: 'TIÊU ĐỀ' },
  { id: 'subtitle', label: 'Phụ đề', sample: 'Phụ đề nằm dưới khung' },
  { id: 'paragraph', label: 'Đoạn văn', sample: 'Đoạn văn nhiều dòng' },
  { id: 'lower', label: 'Lower third', sample: 'DJ Name' },
  { id: 'neon', label: 'Neon', sample: 'NEON' },
  { id: 'outline', label: 'Viền chữ', sample: 'OUTLINE' },
  { id: 'tag', label: 'Nhãn', sample: 'TONIGHT' }
]

export const SHAPE_PRESETS: { id: ShapePresetId; label: string }[] = [
  { id: 'rect', label: 'Chữ nhật' },
  { id: 'ellipse', label: 'Tròn' },
  { id: 'pill', label: 'Viên thuốc' },
  { id: 'line', label: 'Đường kẻ' }
]

/** Layer chữ theo mẫu, đặt tại (x, y) — mặc định giữa khung */
export function textPreset(id: TextPresetId, s: ProjectSettings, at?: { x: number; y: number }, content?: string): TextLayer {
  const { width: W, height: H } = s
  const u = Math.min(W, H)
  const l = newTextLayer(W, H, GRAPHIC_LEN, content ?? TEXT_PRESETS.find((p) => p.id === id)!.sample)
  const t = l.text
  l.name = TEXT_PRESETS.find((p) => p.id === id)!.label
  switch (id) {
    case 'title':
      Object.assign(t, { size: Math.round(u * 0.11), weight: 800, maxWidth: Math.round(W * 0.86), animIn: defaultAnimator('slideUp') })
      break
    case 'subtitle':
      Object.assign(t, {
        size: Math.round(u * 0.045),
        weight: 600,
        maxWidth: Math.round(W * 0.84),
        animIn: defaultAnimator('fade'),
        box: { color: '#000000', opacity: 0.55, padding: Math.round(u * 0.018), radius: Math.round(u * 0.012) }
      })
      break
    case 'paragraph':
      Object.assign(t, {
        size: Math.round(u * 0.042),
        weight: 400,
        align: 'left',
        lineHeight: 1.4,
        paraSpacing: 0.6,
        maxWidth: Math.round(W * 0.7),
        content: content ?? 'Đoạn văn tự xuống dòng theo độ rộng khung.\nNhấn Enter để sang đoạn mới.',
        animIn: defaultAnimator('fade')
      })
      break
    case 'lower':
      Object.assign(t, {
        size: Math.round(u * 0.05),
        weight: 700,
        align: 'left',
        maxWidth: 0,
        animIn: defaultAnimator('slideLeft'),
        box: { color: '#FF2D55', opacity: 1, padding: Math.round(u * 0.02), radius: 0 }
      })
      break
    case 'neon':
      Object.assign(t, {
        size: Math.round(u * 0.12),
        weight: 800,
        color: '#FFE9FF',
        shadow: { color: '#FF2DCB', blur: Math.round(u * 0.035), x: 0, y: 0 },
        animIn: defaultAnimator('blur')
      })
      break
    case 'outline':
      Object.assign(t, { size: Math.round(u * 0.11), weight: 900, color: '#FFFFFF', stroke: { color: '#000000', width: Math.max(2, Math.round(u * 0.006)) }, animIn: defaultAnimator('scale') })
      break
    case 'tag':
      Object.assign(t, {
        size: Math.round(u * 0.04),
        weight: 800,
        uppercase: true,
        tracking: { v: Math.round(u * 0.006) },
        color: '#000000',
        maxWidth: 0,
        animIn: defaultAnimator('fade'),
        box: { color: '#FFD60A', opacity: 1, padding: Math.round(u * 0.016), radius: Math.round(u * 0.04) }
      })
      break
  }
  const pos = at ?? (id === 'subtitle' ? { x: W / 2, y: H * 0.85 } : id === 'lower' ? { x: W * 0.3, y: H * 0.8 } : { x: W / 2, y: H / 2 })
  l.transform = { ...l.transform, x: { v: pos.x }, y: { v: pos.y } }
  return l
}

export function shapePreset(id: ShapePresetId, s: ProjectSettings, at?: { x: number; y: number }, color = '#FF2D55'): ShapeLayer {
  const { width: W, height: H } = s
  const l = newShapeLayer(W, H, GRAPHIC_LEN, id === 'pill' ? 'rect' : id, color) as ShapeLayer
  l.name = SHAPE_PRESETS.find((p) => p.id === id)!.label
  if (id === 'pill') {
    const h = Math.round(Math.min(W, H) * 0.1)
    l.shape = { ...l.shape, width: { v: h * 3.2 }, height: { v: h }, radius: h / 2 }
  }
  const pos = at ?? { x: W / 2, y: H / 2 }
  l.transform = { ...l.transform, x: { v: pos.x }, y: { v: pos.y } }
  return l
}

/** Ảnh brand element (đã có trong brand kit) làm layer ảnh */
export function graphicOf(c: TrackClip): GraphicData | null {
  return c.graphic ?? null
}

/** Scene 1 layer cho clip, thời gian 0..độ dài clip, áp hiệu ứng vào/ra theo độ dài hiện tại */
export function graphicScene(g: GraphicData, len: number, H: number): MotionScene {
  let l = { ...(g.layer as unknown as Layer), in: 0, out: Math.max(0.05, len), visible: true }
  const d = Math.min(0.6, len / 3)
  if (g.motionIn) l = applyPreset(l, g.motionIn as MotionPreset, H, d)
  if (g.motionOut) l = applyPreset(l, g.motionOut as MotionPreset, H, d)
  return { background: null, layers: [l] }
}

/** Có chuyển động theo thời gian không (không thì xuất 1 ảnh tĩnh là đủ) */
export function graphicAnimated(g: GraphicData): boolean {
  if (g.motionIn || g.motionOut) return true
  const l = g.layer as unknown as Layer
  if (l.type === 'text' && (l.text.animIn || l.text.animOut)) return true
  return Object.values(l.transform).some((p) => (p.keys?.length ?? 0) > 1 || !!p.wiggle)
}

export const graphicLabel = (g: GraphicData) => {
  const l = g.layer as unknown as Layer
  return l.type === 'text' ? l.text.content.split('\n')[0] || 'Chữ' : l.name || 'Hình'
}

// ---------- xuất ----------

const fileCache = new Map<string, Promise<{ path: string; video: boolean }>>()

/**
 * Render clip chữ/hình ra file để ffmpeg phủ lên video: PNG nền trong nếu đứng yên,
 * WebM có kênh alpha nếu có chuyển động (phủ cả khung, thời gian 0..out của clip).
 */
export function graphicFile(
  c: TrackClip,
  settings: ProjectSettings,
  elements: import('../../shared/types').BrandElement[],
  onProgress?: (p: number) => void
): Promise<{ path: string; video: boolean }> {
  const g = c.graphic!
  const key = JSON.stringify([g, c.out, settings.width, settings.height, settings.fps, elements])
  let job = fileCache.get(key)
  if (!job) {
    job = (async () => {
      const { SceneRunner, renderSceneToFile } = await import('../engine/player')
      const scene = graphicScene(g, c.out, settings.height)
      if (graphicAnimated(g)) {
        const r = await renderSceneToFile(scene, c.out, settings, elements, 'chu', (p) => onProgress?.(p), undefined, true)
        return { path: r.path, video: true }
      }
      const runner = new SceneRunner(settings, elements)
      try {
        const canvas = document.createElement('canvas')
        canvas.width = settings.width
        canvas.height = settings.height
        await runner.prepare(scene)
        await runner.draw(canvas.getContext('2d')!, scene, Math.min(c.out - 0.001, (c.in + c.out) / 2))
        const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Không vẽ được chữ'))), 'image/png'))
        const item = await window.laila.media.saveRaster('chu.png', new Uint8Array(await blob.arrayBuffer()))
        return { path: item.path, video: false }
      } finally {
        runner.dispose()
      }
    })()
    job.catch(() => fileCache.delete(key))
    fileCache.set(key, job)
  }
  return job
}
