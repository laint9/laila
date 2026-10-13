// Danh sách font cài trong máy (Local Font Access API). Tự nạp lại khi cài/xoá font.
import { create } from 'zustand'
import { mediaUrl } from './media'

export interface FontFamily {
  family: string
  styles: string[]
}

interface FontState {
  families: FontFamily[]
  loading: boolean
  /** true = đọc được font hệ thống; false = đang dùng danh sách dự phòng */
  system: boolean
  updatedAt: number
  refresh: () => Promise<void>
}

const FALLBACK = [
  'SF Pro Display',
  'SF Pro Rounded',
  'Helvetica Neue',
  'Avenir Next',
  'Futura',
  'Gill Sans',
  'Optima',
  'Didot',
  'Baskerville',
  'Georgia',
  'American Typewriter',
  'Menlo'
]

type LocalFont = { family: string; style: string; fullName: string; postscriptName: string }

export const useFonts = create<FontState>((set, get) => ({
  families: FALLBACK.map((family) => ({ family, styles: [] })),
  loading: false,
  system: false,
  updatedAt: 0,
  refresh: async () => {
    if (get().loading) return
    const q = (window as unknown as { queryLocalFonts?: () => Promise<LocalFont[]> }).queryLocalFonts
    set({ loading: true })
    try {
      const map = new Map<string, Set<string>>()
      const add = (family: string, style: string) => {
        // bỏ font ẩn của hệ thống (tên bắt đầu bằng dấu chấm)
        if (!family || family.startsWith('.')) return
        if (!map.has(family)) map.set(family, new Set())
        map.get(family)!.add(style)
      }
      let fromSystem = false
      if (q) {
        try {
          for (const f of await q()) add(f.family, f.style)
          fromSystem = map.size > 0
        } catch {
          /* không có quyền: dùng kết quả quét thư mục */
        }
      }
      // Chromium chỉ liệt kê font 1 lần mỗi phiên -> font vừa cài được đọc thẳng từ file
      const scanned = await window.laila.fonts.scan().catch(() => [])
      for (const f of scanned) {
        if (!map.has(f.family)) registerFile(f.family, f.path)
        add(f.family, f.style)
      }
      const families = [...map.entries()]
        .map(([family, styles]) => ({ family, styles: [...styles] }))
        .sort((a, b) => a.family.localeCompare(b.family))
      if (families.length) set({ families, system: fromSystem || scanned.length > 0, updatedAt: Date.now() })
    } finally {
      set({ loading: false })
    }
  }
}))

const registered = new Set<string>()
/** Nạp font từ file để vẽ được ngay cả khi hệ thống chưa nhận */
function registerFile(family: string, path: string) {
  const key = family + '|' + path
  if (registered.has(key)) return
  registered.add(key)
  const face = new FontFace(family, `url("${mediaUrl(path)}")`)
  face
    .load()
    .then((f) => document.fonts.add(f))
    .catch(() => registered.delete(key))
}

let started = false
/** Gọi 1 lần khi app mở: nạp font, nạp lại khi thư mục font đổi hoặc khi quay lại app */
export function startFontWatch() {
  if (started) return
  started = true
  const { refresh } = useFonts.getState()
  refresh()
  window.laila.fonts.onChanged(() => refresh())
  let last = 0
  window.addEventListener('focus', () => {
    if (Date.now() - last > 5000) {
      last = Date.now()
      refresh()
    }
  })
}
