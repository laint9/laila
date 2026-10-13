// State của Motion Editor (một composition đang mở), có undo riêng.
import { create } from 'zustand'
import type { Ease, Layer, MotionScene } from '../engine/types'
import { getProp, KEY_EPS, setKeyEase, updateLayer, withProp, type PropPath } from '../engine/edit'

export type Tool = 'select' | 'text' | 'rect' | 'ellipse' | 'line'

export interface KeyRef {
  layerId: string
  path: PropPath
  t: number
}

interface Snapshot {
  scene: MotionScene
  duration: number
}

interface EditorState {
  sceneId: string | null
  scene: MotionScene
  duration: number
  time: number
  playing: boolean
  loop: boolean
  tool: Tool
  selected: string | null
  keys: KeyRef[]
  expanded: Record<string, boolean>
  onlyAnimated: boolean
  showSafe: boolean
  showGrid: boolean
  snapping: boolean
  past: Snapshot[]
  future: Snapshot[]
  dirty: boolean
  /** xem thử hiệu ứng khi rê chuột: vẽ scene tạm, lặp thời gian from..to */
  preview: { scene: MotionScene; from: number; to: number } | null
  setPreview: (p: { scene: MotionScene; from: number; to: number } | null) => void

  open: (sceneId: string, scene: MotionScene, duration: number) => void
  /** đổi scene, ghi lịch sử (mặc định) */
  edit: (fn: (s: MotionScene) => MotionScene, opts?: { history?: boolean }) => void
  /** chụp lịch sử 1 lần trước khi kéo chuột liên tục */
  checkpoint: () => void
  editLayer: (id: string, fn: (l: Layer) => Layer, opts?: { history?: boolean }) => void
  setDuration: (d: number) => void
  undo: () => void
  redo: () => void
  setTime: (t: number) => void
  setPlaying: (p: boolean) => void
  setTool: (t: Tool) => void
  select: (id: string | null) => void
  selectKeys: (keys: KeyRef[]) => void
  toggleExpanded: (id: string) => void
  setFlag: (k: 'onlyAnimated' | 'showSafe' | 'showGrid' | 'snapping' | 'loop', v: boolean) => void
  /** áp ease cho các keyframe đang chọn (F9 = Easy Ease) */
  easeSelectedKeys: (ease: Ease) => void
}

const clampTime = (t: number, d: number) => Math.max(0, Math.min(d, t))

export const useEditor = create<EditorState>((set, get) => ({
  sceneId: null,
  scene: { background: null, layers: [] },
  duration: 4,
  time: 0,
  playing: false,
  loop: true,
  tool: 'select',
  selected: null,
  keys: [],
  expanded: {},
  onlyAnimated: false,
  showSafe: false,
  showGrid: false,
  snapping: true,
  past: [],
  future: [],
  dirty: false,
  preview: null,
  setPreview: (preview) => set({ preview }),

  open: (sceneId, scene, duration) =>
    set({
      sceneId,
      scene,
      duration,
      time: Math.min(duration, 1),
      playing: false,
      tool: 'select',
      selected: scene.layers[0]?.id ?? null,
      keys: [],
      expanded: {},
      past: [],
      future: [],
      dirty: false
    }),
  edit: (fn, opts) =>
    set((s) => ({
      past: opts?.history === false ? s.past : [...s.past.slice(-199), { scene: s.scene, duration: s.duration }],
      future: opts?.history === false ? s.future : [],
      scene: fn(s.scene),
      dirty: true
    })),
  checkpoint: () => set((s) => ({ past: [...s.past.slice(-199), { scene: s.scene, duration: s.duration }], future: [] })),
  editLayer: (id, fn, opts) => get().edit((sc) => updateLayer(sc, id, fn), opts),
  setDuration: (d) =>
    set((s) => ({
      past: [...s.past, { scene: s.scene, duration: s.duration }],
      future: [],
      duration: Math.max(0.5, Math.min(60, d)),
      time: clampTime(s.time, d),
      dirty: true
    })),
  undo: () =>
    set((s) => {
      const prev = s.past[s.past.length - 1]
      if (!prev) return {}
      return { ...prev, past: s.past.slice(0, -1), future: [{ scene: s.scene, duration: s.duration }, ...s.future], dirty: true }
    }),
  redo: () =>
    set((s) => {
      const next = s.future[0]
      if (!next) return {}
      return { ...next, future: s.future.slice(1), past: [...s.past, { scene: s.scene, duration: s.duration }], dirty: true }
    }),
  setTime: (t) => set((s) => ({ time: clampTime(t, s.duration) })),
  setPlaying: (playing) => set({ playing }),
  setTool: (tool) => set({ tool }),
  select: (selected) => set({ selected, keys: [] }),
  selectKeys: (keys) => set({ keys }),
  toggleExpanded: (id) => set((s) => ({ expanded: { ...s.expanded, [id]: !s.expanded[id] } })),
  setFlag: (k, v) => set({ [k]: v } as Partial<EditorState>),
  easeSelectedKeys: (ease) => {
    const { keys } = get()
    if (!keys.length) return
    get().edit((sc) => {
      let out = sc
      for (const k of keys) out = updateLayer(out, k.layerId, (l) => withProp(l, k.path, (p) => setKeyEase(p, k.t, ease)))
      return out
    })
  }
}))

export const selectedLayer = (s: EditorState) => s.scene.layers.find((l) => l.id === s.selected) ?? null

export function keyIsSelected(keys: KeyRef[], layerId: string, path: PropPath, t: number) {
  return keys.some((k) => k.layerId === layerId && k.path === path && Math.abs(k.t - t) < KEY_EPS)
}

export function propOf(scene: MotionScene, ref: Pick<KeyRef, 'layerId' | 'path'>) {
  const l = scene.layers.find((x) => x.id === ref.layerId)
  return l ? getProp(l, ref.path) : null
}
