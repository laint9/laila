// Quét thư mục font và đọc tên family/style từ bảng `name` (TTF/OTF/TTC).
// Dùng bù cho queryLocalFonts: Chromium chỉ liệt kê font một lần mỗi phiên,
// nên font cài thêm khi app đang mở phải tự đọc từ file.
import { readdir, readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'

export interface FontFileInfo {
  family: string
  style: string
  path: string
}

const EXT = new Set(['.ttf', '.otf', '.ttc'])

function decodeName(buf: Buffer, platform: number, off: number, len: number): string {
  const b = buf.subarray(off, off + len)
  if (platform === 0 || platform === 3) {
    let s = ''
    for (let i = 0; i + 1 < b.length; i += 2) s += String.fromCharCode(b.readUInt16BE(i))
    return s
  }
  return b.toString('latin1')
}

/** Đọc family + style của 1 font (offset = vị trí bảng offset của font trong file) */
function readFace(buf: Buffer, at: number): { family: string; style: string } | null {
  if (at + 12 > buf.length) return null
  const numTables = buf.readUInt16BE(at + 4)
  for (let i = 0; i < numTables; i++) {
    const rec = at + 12 + i * 16
    if (rec + 16 > buf.length) return null
    if (buf.toString('latin1', rec, rec + 4) !== 'name') continue
    const t = buf.readUInt32BE(rec + 8)
    if (t + 6 > buf.length) return null
    const count = buf.readUInt16BE(t + 2)
    const strings = t + buf.readUInt16BE(t + 4)
    // ưu tiên tên tiếng Anh (Windows 0x409 / Mac 0), id 16/17 (typographic) rồi 1/2
    const names: Record<number, { score: number; v: string }> = {}
    for (let j = 0; j < count; j++) {
      const r = t + 6 + j * 12
      if (r + 12 > buf.length) break
      const platform = buf.readUInt16BE(r)
      const lang = buf.readUInt16BE(r + 4)
      const id = buf.readUInt16BE(r + 6)
      if (![1, 2, 16, 17].includes(id)) continue
      const len = buf.readUInt16BE(r + 8)
      const off = strings + buf.readUInt16BE(r + 10)
      if (off + len > buf.length) continue
      const score = (platform === 3 && lang === 0x409 ? 3 : platform === 1 && lang === 0 ? 2 : platform === 0 ? 1 : 0)
      if (!names[id] || score > names[id].score) names[id] = { score, v: decodeName(buf, platform, off, len).trim() }
    }
    const family = names[16]?.v || names[1]?.v
    if (!family) return null
    return { family, style: names[17]?.v || names[2]?.v || 'Regular' }
  }
  return null
}

/** Đọc mọi face trong 1 file font */
export function parseFontFile(buf: Buffer): { family: string; style: string }[] {
  if (buf.length < 12) return []
  const tag = buf.toString('latin1', 0, 4)
  const offsets: number[] = []
  if (tag === 'ttcf') {
    const n = Math.min(64, buf.readUInt32BE(8))
    for (let i = 0; i < n && 12 + i * 4 + 4 <= buf.length; i++) offsets.push(buf.readUInt32BE(12 + i * 4))
  } else if (tag === 'OTTO' || tag === 'true' || buf.readUInt32BE(0) === 0x00010000) offsets.push(0)
  const out: { family: string; style: string }[] = []
  for (const o of offsets) {
    const f = readFace(buf, o)
    if (f) out.push(f)
  }
  return out
}

/** Quét các thư mục font (đệ quy, giới hạn độ sâu) */
export async function scanFontDirs(dirs: string[], maxDepth = 4): Promise<FontFileInfo[]> {
  const out: FontFileInfo[] = []
  const walk = async (d: string, depth: number) => {
    let entries
    try {
      entries = await readdir(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const p = join(d, e.name)
      if (e.isDirectory()) {
        if (depth < maxDepth) await walk(p, depth + 1)
      } else if (EXT.has(extname(e.name).toLowerCase())) {
        try {
          for (const f of parseFontFile(await readFile(p))) if (!f.family.startsWith('.')) out.push({ ...f, path: p })
        } catch {
          /* file hỏng: bỏ qua */
        }
      }
    }
  }
  for (const d of dirs) await walk(d, 0)
  return out
}
