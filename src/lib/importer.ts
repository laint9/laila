// Nhập file từ máy (kéo thả / hộp thoại): video, âm thanh, ảnh, vector (SVG, PDF, AI).
import type { ImportedFile, MediaItem } from '../../shared/types'
import { mediaUrl } from './media'
import { useStore } from './store'

export interface ImportResult {
  items: MediaItem[]
  errors: string[]
}

/** Cạnh dài khi vẽ vector ra PNG: gấp đôi khung hình để phóng to vẫn nét */
const rasterSize = () => {
  const { width, height } = useStore.getState().project.settings
  return Math.min(4096, Math.max(2048, 2 * Math.max(width, height)))
}

const canvasToPng = (c: HTMLCanvasElement) =>
  new Promise<Uint8Array>((resolve, reject) =>
    c.toBlob((b) => (b ? b.arrayBuffer().then((a) => resolve(new Uint8Array(a)), reject) : reject(new Error('Không tạo được PNG'))), 'image/png')
  )

/** Kích thước gốc của SVG: width/height, không có thì lấy theo viewBox */
export function svgSize(text: string): { w: number; h: number } {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml')
  const el = doc.documentElement
  const num = (v: string | null) => {
    const n = parseFloat(v ?? '')
    return v && !v.trim().endsWith('%') && Number.isFinite(n) && n > 0 ? n : 0
  }
  const vb = (el.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number)
  const vw = vb.length === 4 && vb[2] > 0 ? vb[2] : 0
  const vh = vb.length === 4 && vb[3] > 0 ? vb[3] : 0
  let w = num(el.getAttribute('width'))
  let h = num(el.getAttribute('height'))
  if (!w && !h) {
    w = vw || 300
    h = vh || 150
  } else if (!w) w = vw && vh ? (h * vw) / vh : h
  else if (!h) h = vw && vh ? (w * vh) / vw : w
  return { w, h }
}

async function rasterizeSvg(path: string): Promise<Uint8Array> {
  const text = await (await fetch(mediaUrl(path))).text()
  const { w, h } = svgSize(text)
  const k = rasterSize() / Math.max(w, h)
  const img = new Image()
  // gắn kích thước rõ ràng để SVG không có width/height vẫn vẽ đúng tỉ lệ
  img.src = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }))
  try {
    await img.decode()
    const c = document.createElement('canvas')
    c.width = Math.max(1, Math.round(w * k))
    c.height = Math.max(1, Math.round(h * k))
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
    return await canvasToPng(c)
  } finally {
    URL.revokeObjectURL(img.src)
  }
}

let pdfjs: Promise<typeof import('pdfjs-dist')> | null = null
const loadPdfjs = () =>
  (pdfjs ??= Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]).then(([lib, worker]) => {
    lib.GlobalWorkerOptions.workerSrc = worker.default
    return lib
  }))

/** Vẽ trang đầu của PDF / AI ra PNG nền trong suốt */
async function rasterizePdf(path: string): Promise<Uint8Array> {
  const lib = await loadPdfjs()
  const data = new Uint8Array(await (await fetch(mediaUrl(path))).arrayBuffer())
  const doc = await lib.getDocument({ data, isEvalSupported: false }).promise
  try {
    const page = await doc.getPage(1)
    const base = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: rasterSize() / Math.max(base.width, base.height) })
    const c = document.createElement('canvas')
    c.width = Math.round(viewport.width)
    c.height = Math.round(viewport.height)
    await page.render({ canvasContext: c.getContext('2d')!, viewport, background: 'rgba(0,0,0,0)' }).promise
    return await canvasToPng(c)
  } catch (e) {
    throw new Error(/\.ai$/i.test(path) ? 'file AI không có bản PDF bên trong — lưu lại từ Illustrator với tuỳ chọn "Create PDF Compatible File"' : (e as Error).message)
  } finally {
    doc.destroy()
  }
}

const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p

/** Đổi kết quả từ main (vector -> PNG) thành MediaItem */
async function finish(files: ImportedFile[]): Promise<ImportResult> {
  const items: MediaItem[] = []
  const errors: string[] = []
  for (const f of files) {
    if (f.item) items.push(f.item)
    else if (f.vector) {
      try {
        const png = f.vector === 'svg' ? await rasterizeSvg(f.path) : await rasterizePdf(f.path)
        items.push(await window.laila.media.saveRaster(f.path, png))
      } catch (e) {
        errors.push(`${baseName(f.path)}: ${(e as Error).message}`)
      }
    } else if (f.error) errors.push(f.error)
  }
  return { items, errors }
}

/** Đường dẫn của các File kéo vào; file không có đường dẫn (kéo từ web) được lưu lại trước */
export async function pathsOf(files: File[]): Promise<string[]> {
  const out: string[] = []
  for (const f of files) {
    let p = window.laila.file.pathOf(f)
    if (!p) p = await window.laila.media.saveDropped(f.name || 'file', new Uint8Array(await f.arrayBuffer()))
    out.push(p)
  }
  return out
}

/** Nhập file vào Media của project */
export async function importPaths(paths: string[]): Promise<ImportResult> {
  if (!paths.length) return { items: [], errors: [] }
  const r = await finish(await window.laila.media.importPaths(paths))
  if (r.items.length) useStore.getState().addMedia(r.items)
  reportErrors(r.errors)
  return r
}

export async function importDropped(files: File[]): Promise<ImportResult> {
  return importPaths(await pathsOf(files))
}

/** Mở hộp thoại chọn file rồi nhập */
export async function importDialog(kind: 'video' | 'audio' | 'image' | 'all'): Promise<ImportResult> {
  const r = await finish(await window.laila.media.import(kind))
  if (r.items.length) useStore.getState().addMedia(r.items)
  reportErrors(r.errors)
  return r
}

/**
 * Ảnh dùng cho brand kit / layer ảnh: ảnh giữ nguyên, SVG/PDF/AI vẽ ra PNG,
 * file khác không phải ảnh thì trả lỗi.
 */
export async function brandImagePath(path: string): Promise<string> {
  if (/\.(png|jpe?g|webp|gif|bmp)$/i.test(path)) return path
  // vector vẽ ra PNG lớn để phóng to trong scene vẫn nét
  if (/\.svg$/i.test(path)) return (await window.laila.media.saveRaster(path, await rasterizeSvg(path))).path
  if (/\.(pdf|ai)$/i.test(path)) return (await window.laila.media.saveRaster(path, await rasterizePdf(path))).path
  throw new Error(`${baseName(path)}: chỉ nhận ảnh hoặc vector (PNG, JPG, SVG, PDF, AI)`)
}

/** File kéo vào có phải file từ máy không */
export const hasFiles = (e: { dataTransfer: DataTransfer | null }) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files')

// ---------- thông báo lỗi nhập file ----------
type Listener = (msgs: string[]) => void
const listeners = new Set<Listener>()
export function onImportErrors(fn: Listener) {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
export function reportErrors(msgs: string[]) {
  if (msgs.length) listeners.forEach((l) => l(msgs))
}

/** Tên brand element từ tên file: "Logo Chợ Chời.svg" -> "logo_cho_choi" */
export function elementNameFromFile(path: string): string {
  const base = baseName(path).replace(/\.[^.]+$/, '')
  const n = base
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return (/^[a-z]/.test(n) ? n : 'img_' + n).slice(0, 32) || 'image'
}

/** Thêm ảnh/vector kéo vào thành brand element; trả về các element mới */
export async function addBrandImages(files: File[]) {
  const st = useStore.getState()
  const added = []
  const errors: string[] = []
  const others: string[] = []
  for (const p of await pathsOf(files)) {
    if (!/\.(png|jpe?g|webp|gif|bmp|svg|pdf|ai)$/i.test(p)) {
      others.push(p)
      continue
    }
    try {
      const value = await brandImagePath(p)
      const el = st.addElement('image', value)
      const taken = new Set(useStore.getState().project.elements.filter((e) => e.id !== el.id).map((e) => e.name))
      let name = elementNameFromFile(p)
      for (let i = 2; taken.has(name); i++) name = `${elementNameFromFile(p)}_${i}`
      st.updateElement(el.id, { name })
      added.push({ ...el, name })
    } catch (e) {
      errors.push(`${baseName(p)}: ${(e as Error).message}`)
    }
  }
  reportErrors(errors)
  // video / âm thanh thả nhầm vào brand kit: đưa vào Media
  if (others.length) await importPaths(others)
  return added
}
