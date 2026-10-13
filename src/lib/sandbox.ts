import type { BrandElement, ProjectSettings } from '../../shared/types'
import { mediaUrl } from './media'

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void }

export interface SceneProgram {
  code: string
  duration: number
  settings: ProjectSettings
  elements: BrandElement[]
}

const bitmapCache = new Map<string, Promise<ImageBitmap | null>>()

/** Đọc ảnh từ đĩa (qua media://) thành ImageBitmap để chuyển vào sandbox. */
export function loadBitmap(path: string): Promise<ImageBitmap | null> {
  let p = bitmapCache.get(path)
  if (!p) {
    p = new Promise<ImageBitmap | null>((resolve) => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => createImageBitmap(img).then(resolve, () => resolve(null))
      img.onerror = () => resolve(null)
      img.src = mediaUrl(path)
    })
    bitmapCache.set(path, p)
  }
  return p
}

export async function elementPayload(elements: BrandElement[]) {
  const el: Record<string, string> = {}
  const fonts: Record<string, string> = {}
  const images: Record<string, ImageBitmap> = {}
  for (const e of elements) {
    if (e.kind === 'image') {
      const bmp = await loadBitmap(e.value)
      if (bmp) images[e.name] = bmp
    } else if (e.kind === 'font') {
      fonts[e.name] = e.value
      el[e.name] = e.value
    } else {
      el[e.name] = e.value
    }
  }
  return { el, fonts, images }
}

/**
 * Bọc 1 iframe sandbox chạy code motion graphic. Có thể gắn vào DOM để xem trực tiếp
 * (preview) hoặc để ẩn khi render ra file.
 */
export class MotionSandbox {
  readonly iframe: HTMLIFrameElement
  private seq = 0
  private pending = new Map<number, Pending>()
  private ready: Promise<void>
  private lastError: string | null = null

  constructor(host?: HTMLElement) {
    this.iframe = document.createElement('iframe')
    this.iframe.setAttribute('sandbox', 'allow-scripts')
    this.iframe.src = './sandbox.html'
    this.iframe.style.border = '0'
    if (host) {
      this.iframe.style.width = '100%'
      this.iframe.style.height = '100%'
      host.appendChild(this.iframe)
    } else {
      Object.assign(this.iframe.style, { position: 'fixed', left: '-10000px', top: '0', width: '320px', height: '180px' })
      document.body.appendChild(this.iframe)
    }
    this.ready = new Promise((resolve) => {
      const onReady = (e: MessageEvent) => {
        if (e.source === this.iframe.contentWindow && e.data?.type === 'ready') {
          window.removeEventListener('message', onReady)
          resolve()
        }
      }
      window.addEventListener('message', onReady)
    })
    window.addEventListener('message', this.onMessage)
  }

  private onMessage = (e: MessageEvent) => {
    if (e.source !== this.iframe.contentWindow) return
    const m = e.data
    if (!m || m.type === 'ready') return
    if (m.id === -1) {
      this.lastError = m.message
      return
    }
    const p = this.pending.get(m.id)
    if (!p) return
    this.pending.delete(m.id)
    if (m.type === 'error') p.reject(new Error(m.message))
    else p.resolve(m)
  }

  private async call<T = any>(msg: Record<string, unknown>, timeoutMs = 10000): Promise<T> {
    await this.ready
    const id = ++this.seq
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(this.lastError || 'Render timeout: code chạy quá lâu hoặc bị treo'))
      }, timeoutMs)
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer)
          resolve(v)
        },
        reject: (e) => {
          clearTimeout(timer)
          reject(e)
        }
      })
      this.iframe.contentWindow!.postMessage({ ...msg, id }, '*')
    })
  }

  async load(prog: SceneProgram): Promise<void> {
    const payload = await elementPayload(prog.elements)
    await this.call({
      type: 'load',
      code: prog.code,
      width: prog.settings.width,
      height: prog.settings.height,
      fps: prog.settings.fps,
      duration: prog.duration,
      ...payload
    })
  }

  draw(t: number): Promise<{ ms: number }> {
    return this.call({ type: 'draw', t })
  }

  async capture(t: number): Promise<Uint8Array> {
    const r = await this.call<{ buf: ArrayBuffer }>({ type: 'capture', t })
    return new Uint8Array(r.buf)
  }

  /** Chạy thử vài frame để bắt lỗi trước khi render thật. */
  async validate(duration: number): Promise<void> {
    const samples = [0, duration * 0.25, duration * 0.5, duration * 0.75, Math.max(0, duration - 0.001)]
    for (const t of samples) {
      const { ms } = await this.draw(t)
      if (ms > 1500) throw new Error(`Frame tại t=${t.toFixed(2)}s mất ${Math.round(ms)}ms, quá chậm để render`)
    }
  }

  dispose() {
    window.removeEventListener('message', this.onMessage)
    for (const p of this.pending.values()) p.reject(new Error('sandbox disposed'))
    this.pending.clear()
    this.iframe.remove()
  }
}

/** Render toàn bộ scene ra mp4 qua ffmpeg ở main process. */
export async function renderToFile(
  prog: SceneProgram,
  label: string,
  onProgress: (p: number) => void,
  signal?: { cancelled: boolean }
) {
  const sb = new MotionSandbox()
  const jobId = crypto.randomUUID()
  let started = false
  try {
    await sb.load(prog)
    await sb.validate(prog.duration)
    const fps = prog.settings.fps
    const frames = Math.max(1, Math.round(prog.duration * fps))
    await window.laila.render.start(jobId, fps, label)
    started = true
    for (let i = 0; i < frames; i++) {
      if (signal?.cancelled) throw new Error('Đã huỷ')
      const png = await sb.capture(i / fps)
      await window.laila.render.frame(jobId, png)
      if (i % 3 === 0) onProgress(i / frames)
    }
    onProgress(1)
    return await window.laila.render.finish(jobId)
  } catch (e) {
    if (started) await window.laila.render.abort(jobId)
    throw e
  } finally {
    sb.dispose()
  }
}
