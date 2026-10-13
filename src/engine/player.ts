// Chạy scene trong renderer: nạp asset, quản lý sandbox cho layer code, vẽ frame, render ra file.
import type { BrandElement, ProjectSettings } from '../../shared/types'
import { MotionSandbox, loadBitmap } from '../lib/sandbox'
import { isActive, renderScene, type RenderAssets } from './render'
import type { CodeLayer, MotionScene } from './types'

export async function buildAssets(elements: BrandElement[], settings: ProjectSettings): Promise<RenderAssets> {
  const fonts: Record<string, string> = {}
  const images: RenderAssets['images'] = {}
  for (const e of elements) {
    if (e.kind === 'font' && e.value) fonts[e.name] = e.value
    if (e.kind === 'image' && e.value) {
      const bmp = await loadBitmap(e.value)
      if (bmp) images[e.name] = bmp
    }
  }
  return { width: settings.width, height: settings.height, fonts, images }
}

/**
 * Giữ 1 sandbox cho mỗi layer code. Tạo lại khi source đổi.
 */
export class SceneRunner {
  private boxes = new Map<string, { source: string; sb: MotionSandbox; ready: Promise<void>; error: string | null }>()
  assets: RenderAssets | null = null

  constructor(
    private settings: ProjectSettings,
    private elements: BrandElement[]
  ) {}

  async prepare(scene: MotionScene) {
    if (!this.assets) this.assets = await buildAssets(this.elements, this.settings)
    const codeLayers = scene.layers.filter((l): l is CodeLayer => l.type === 'code')
    const keep = new Set(codeLayers.map((l) => l.id))
    for (const [id, box] of this.boxes) {
      if (!keep.has(id)) {
        box.sb.dispose()
        this.boxes.delete(id)
      }
    }
    for (const l of codeLayers) {
      const cur = this.boxes.get(l.id)
      if (cur && cur.source === l.code.source) continue
      cur?.sb.dispose()
      const sb = new MotionSandbox()
      const entry = { source: l.code.source, sb, ready: Promise.resolve(), error: null as string | null }
      entry.ready = sb
        .load({ code: l.code.source, duration: l.out - l.in, settings: this.settings, elements: this.elements })
        .catch((e) => {
          entry.error = (e as Error).message
        })
      this.boxes.set(l.id, entry)
    }
    await Promise.all([...this.boxes.values()].map((b) => b.ready))
  }

  /** Lỗi đầu tiên của layer code (nếu có) */
  errors(): { layerId: string; message: string }[] {
    return [...this.boxes.entries()].filter(([, b]) => b.error).map(([id, b]) => ({ layerId: id, message: b.error! }))
  }

  async draw(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, scene: MotionScene, t: number) {
    if (!this.assets) await this.prepare(scene)
    const codeFrames = new Map<string, CanvasImageSource>()
    const bitmaps: ImageBitmap[] = []
    for (const l of scene.layers) {
      if (l.type !== 'code' || !isActive(l, t)) continue
      const box = this.boxes.get(l.id)
      if (!box || box.error) continue
      try {
        const bmp = await box.sb.bitmap(t - l.in)
        codeFrames.set(l.id, bmp)
        bitmaps.push(bmp)
      } catch (e) {
        box.error = (e as Error).message
      }
    }
    renderScene(ctx, scene, t, { ...this.assets!, codeFrames })
    for (const b of bitmaps) b.close()
  }

  /** Chạy thử vài frame, trả về lỗi layer code nếu có */
  async validate(scene: MotionScene, duration: number): Promise<string | null> {
    await this.prepare(scene)
    const c = new OffscreenCanvas(this.settings.width, this.settings.height).getContext('2d')!
    for (const t of [0, duration * 0.25, duration * 0.5, duration * 0.75, Math.max(0, duration - 0.01)]) {
      await this.draw(c, scene, t)
    }
    const errs = this.errors()
    if (!errs.length) return null
    const names = new Map(scene.layers.map((l) => [l.id, l.name]))
    return errs.map((e) => `Layer "${names.get(e.layerId)}": ${e.message}`).join('\n')
  }

  dispose() {
    for (const b of this.boxes.values()) b.sb.dispose()
    this.boxes.clear()
  }
}

/** Render cả scene ra mp4 qua ffmpeg ở main process */
export async function renderSceneToFile(
  scene: MotionScene,
  duration: number,
  settings: ProjectSettings,
  elements: BrandElement[],
  label: string,
  onProgress: (p: number) => void,
  signal?: { cancelled: boolean },
  alpha = false
) {
  // nền trong suốt: bỏ màu nền của scene
  if (alpha) scene = { ...scene, background: null }
  const runner = new SceneRunner(settings, elements)
  const jobId = crypto.randomUUID()
  let started = false
  try {
    await runner.prepare(scene)
    const canvas = new OffscreenCanvas(settings.width, settings.height)
    const ctx = canvas.getContext('2d')!
    const fps = settings.fps
    const frames = Math.max(1, Math.round(duration * fps))
    await window.laila.render.start(jobId, fps, label, alpha)
    started = true
    for (let i = 0; i < frames; i++) {
      if (signal?.cancelled) throw new Error('Đã huỷ')
      await runner.draw(ctx, scene, i / fps)
      const blob = await canvas.convertToBlob({ type: 'image/png' })
      await window.laila.render.frame(jobId, new Uint8Array(await blob.arrayBuffer()))
      if (i % 3 === 0) onProgress(i / frames)
    }
    onProgress(1)
    return await window.laila.render.finish(jobId)
  } catch (e) {
    if (started) await window.laila.render.abort(jobId)
    throw e
  } finally {
    runner.dispose()
  }
}
