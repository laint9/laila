// Kích thước các khung (kéo để co giãn), lưu theo máy trong localStorage.
import { create } from 'zustand'

export const LAYOUT_DEFAULTS = {
  left: 280, // sidebar Brand kit / Media / Âm thanh
  right: 440, // khung preview
  timeline: 300, // chiều cao timeline chính
  edLeft: 240, // Motion Editor: panel hiệu ứng
  edRight: 320, // Motion Editor: Properties
  edTimeline: 300 // Motion Editor: timeline layer
}
export type LayoutKey = keyof typeof LAYOUT_DEFAULTS

export const LAYOUT_LIMITS: Record<LayoutKey, [number, number]> = {
  left: [200, 560],
  right: [280, 900],
  timeline: [160, 700],
  edLeft: [180, 460],
  edRight: [240, 560],
  edTimeline: [160, 700]
}

function load(): typeof LAYOUT_DEFAULTS {
  try {
    const raw = JSON.parse(localStorage.getItem('cc.layout') || '{}')
    const out = { ...LAYOUT_DEFAULTS }
    for (const k of Object.keys(out) as LayoutKey[]) if (typeof raw[k] === 'number') out[k] = raw[k]
    return out
  } catch {
    return { ...LAYOUT_DEFAULTS }
  }
}

interface LayoutState {
  sizes: typeof LAYOUT_DEFAULTS
  set: (k: LayoutKey, v: number) => void
  reset: (k: LayoutKey) => void
}

export const useLayout = create<LayoutState>((set, get) => ({
  sizes: load(),
  set: (k, v) => {
    const [lo, hi] = LAYOUT_LIMITS[k]
    const sizes = { ...get().sizes, [k]: Math.round(Math.min(hi, Math.max(lo, v))) }
    set({ sizes })
    try {
      localStorage.setItem('cc.layout', JSON.stringify(sizes))
    } catch {
      /* bỏ qua */
    }
  },
  reset: (k) => get().set(k, LAYOUT_DEFAULTS[k])
}))
