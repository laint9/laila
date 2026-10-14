// Nhận file từ máy (kéo thả hoặc hộp thoại chọn): phân loại video / âm thanh / ảnh / vector.
import { randomUUID } from 'node:crypto'
import { open } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import type { ImportedFile, MediaItem } from '../shared/types'
import { probe } from './ffmpeg'

export const VIDEO_EXT = ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi']
export const AUDIO_EXT = ['mp3', 'm4a', 'wav', 'aac', 'aiff', 'aif', 'flac', 'ogg']
export const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp']
export const VECTOR_EXT = ['svg', 'pdf', 'ai']
export const ALL_EXT = [...VIDEO_EXT, ...AUDIO_EXT, ...IMAGE_EXT, ...VECTOR_EXT]

/** Thời lượng mặc định của ảnh khi đặt lên timeline (giây) */
export const IMAGE_DEFAULT = 5

export type FileClass = 'video' | 'audio' | 'image' | 'svg' | 'pdf' | 'unsupported'

export function classify(path: string): { cls: FileClass; reason?: string } {
  const ext = extname(path).slice(1).toLowerCase()
  if (VIDEO_EXT.includes(ext)) return { cls: 'video' }
  if (AUDIO_EXT.includes(ext)) return { cls: 'audio' }
  if (IMAGE_EXT.includes(ext)) return { cls: 'image' }
  if (ext === 'svg') return { cls: 'svg' }
  // file .ai lưu từ Illustrator mặc định có kèm bản PDF bên trong
  if (ext === 'pdf' || ext === 'ai') return { cls: 'pdf' }
  if (ext === 'eps') return { cls: 'unsupported', reason: 'EPS chưa hỗ trợ — xuất lại từ Illustrator dạng SVG hoặc PDF' }
  if (ext === 'heic' || ext === 'heif') return { cls: 'unsupported', reason: 'HEIC chưa hỗ trợ — đổi sang JPG/PNG trước' }
  if (ext === 'psd') return { cls: 'unsupported', reason: 'PSD chưa hỗ trợ — xuất PNG từ Photoshop' }
  return { cls: 'unsupported', reason: 'Định dạng chưa hỗ trợ' }
}

/** PNG có kênh alpha hoặc màu trong suốt (tRNS) không */
export function pngHasAlpha(head: Buffer): boolean {
  if (head.length < 33 || head.readUInt32BE(0) !== 0x89504e47) return false
  const colorType = head[25]
  if (colorType === 4 || colorType === 6) return true
  return head.includes(Buffer.from('tRNS'))
}

async function readHead(path: string, n = 4096): Promise<Buffer> {
  const fh = await open(path, 'r')
  try {
    const buf = Buffer.alloc(n)
    const { bytesRead } = await fh.read(buf, 0, n, 0)
    return buf.subarray(0, bytesRead)
  } finally {
    await fh.close()
  }
}

/** Đọc thông tin 1 file. Vector trả về `vector` để renderer vẽ ra PNG rồi gọi lại makeImageItem. */
export async function importPath(path: string): Promise<ImportedFile> {
  const { cls, reason } = classify(path)
  if (cls === 'unsupported') return { path, error: `${basename(path)}: ${reason}` }
  if (cls === 'svg' || cls === 'pdf') return { path, vector: cls }
  try {
    if (cls === 'image') return { path, item: await makeImageItem(path) }
    const info = await probe(path)
    if (cls === 'video' && !info.width) return { path, error: `${basename(path)}: không đọc được hình` }
    const item: MediaItem = {
      id: randomUUID(),
      kind: cls,
      name: basename(path),
      path,
      duration: info.duration,
      hasAudio: info.hasAudio,
      width: info.width,
      height: info.height
    }
    if (!item.duration) return { path, error: `${basename(path)}: không đọc được thời lượng` }
    return { path, item }
  } catch (e) {
    return { path, error: `${basename(path)}: ${(e as Error).message}` }
  }
}

/** Media ảnh tĩnh (từ file ảnh, hoặc PNG đã vẽ từ vector — `source` là file gốc) */
export async function makeImageItem(path: string, source?: string): Promise<MediaItem> {
  const info = await probe(path)
  const ext = extname(path).slice(1).toLowerCase()
  const alpha = ext === 'png' ? pngHasAlpha(await readHead(path)) : ext === 'webp' || ext === 'gif' ? undefined : false
  return {
    id: randomUUID(),
    kind: 'image',
    name: basename(source ?? path),
    path,
    duration: IMAGE_DEFAULT,
    hasAudio: false,
    width: info.width,
    height: info.height,
    ...(alpha ? { alpha: true } : {}),
    ...(source ? { source } : {})
  }
}
