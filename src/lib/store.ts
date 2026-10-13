import { create } from 'zustand'
import type {
  BrandElement,
  ElementKind,
  MediaItem,
  MusicTrack,
  Project,
  ProjectSettings,
  Scene,
  TimelineClip
} from '../../shared/types'
import { uid } from './media'
import { moveClip, splitAt, totalDuration, trimClip, trimLeftAt, trimRightAt } from './timeline'

export const RESOLUTIONS: { label: string; width: number; height: number }[] = [
  { label: '16:9 · 1920×1080', width: 1920, height: 1080 },
  { label: '9:16 · 1080×1920 (Reels/TikTok)', width: 1080, height: 1920 },
  { label: '1:1 · 1080×1080', width: 1080, height: 1080 },
  { label: '4:5 · 1080×1350', width: 1080, height: 1350 },
  { label: '16:9 · 1280×720 (nháp nhanh)', width: 1280, height: 720 }
]

export function emptyProject(): Project {
  return {
    version: 1,
    name: 'Untitled',
    settings: { width: 1920, height: 1080, fps: 30 },
    elements: [
      { id: uid(), kind: 'text', name: 'headline', value: 'Your brand headline' },
      { id: uid(), kind: 'color', name: 'primary', value: '#FF5A1F' },
      { id: uid(), kind: 'color', name: 'background', value: '#0F0F12' }
    ],
    scenes: [],
    media: [],
    timeline: []
  }
}

export type PreviewTarget = { type: 'timeline' } | { type: 'media'; mediaId: string }

type Snapshot = Pick<Project, 'timeline' | 'music'>

interface State {
  project: Project
  // UI
  playhead: number
  playing: boolean
  selectedClipId: string | null
  preview: PreviewTarget
  zoom: number // pixel / giây
  past: Snapshot[]
  future: Snapshot[]

  setProject: (p: Project) => void
  rename: (name: string) => void
  setSettings: (s: Partial<ProjectSettings>) => void

  addElement: (kind: ElementKind, value?: string) => BrandElement
  updateElement: (id: string, patch: Partial<BrandElement>) => void
  removeElement: (id: string) => void

  addScene: (s?: Partial<Scene>) => Scene
  updateScene: (id: string, patch: Partial<Scene>) => void
  removeScene: (id: string) => void
  moveScene: (id: string, dir: -1 | 1) => void

  addMedia: (items: MediaItem[]) => void
  removeMedia: (id: string) => void

  // timeline (có undo)
  appendToTimeline: (mediaId: string, index?: number) => void
  splitAtPlayhead: () => void
  trimLeft: () => void
  trimRight: () => void
  setClip: (id: string, patch: Partial<TimelineClip>, history?: boolean) => void
  deleteSelected: () => void
  duplicateSelected: () => void
  trim: (id: string, edge: 'in' | 'out', value: number) => void
  beginTrim: () => void
  move: (id: string, toIndex: number) => void
  setClipVolume: (id: string, v: number) => void
  setMusic: (m: MusicTrack | undefined) => void
  undo: () => void
  redo: () => void

  setPlayhead: (t: number) => void
  setPlaying: (p: boolean) => void
  select: (id: string | null) => void
  setPreview: (p: PreviewTarget) => void
  setZoom: (z: number) => void
}

const snap = (p: Project): Snapshot => ({ timeline: p.timeline, music: p.music })

export const useStore = create<State>((set, get) => {
  /** Ghi lịch sử rồi đổi timeline */
  const commit = (fn: (p: Project) => Partial<Project>) =>
    set((s) => ({
      past: [...s.past.slice(-99), snap(s.project)],
      future: [],
      project: { ...s.project, ...fn(s.project) }
    }))
  const patchProject = (fn: (p: Project) => Partial<Project>) =>
    set((s) => ({ project: { ...s.project, ...fn(s.project) } }))

  return {
    project: emptyProject(),
    playhead: 0,
    playing: false,
    selectedClipId: null,
    preview: { type: 'timeline' },
    zoom: 60,
    past: [],
    future: [],

    setProject: (p) =>
      set({ project: p, past: [], future: [], playhead: 0, playing: false, selectedClipId: null, preview: { type: 'timeline' } }),
    rename: (name) => patchProject(() => ({ name })),
    setSettings: (s) => patchProject((p) => ({ settings: { ...p.settings, ...s } })),

    addElement: (kind, value) => {
      const names = new Set(get().project.elements.map((e) => e.name))
      let i = 1
      while (names.has(`${kind}${i}`)) i++
      const defaults: Record<ElementKind, string> = {
        text: 'New text',
        color: '#FFFFFF',
        image: '',
        font: 'SF Pro Display',
        note: 'Tone: tối giản, cao cấp, nhịp nhanh'
      }
      const el: BrandElement = { id: uid(), kind, name: `${kind}${i}`, value: value ?? defaults[kind] }
      patchProject((p) => ({
        elements: [...p.elements, el],
        // scene đang dùng "tất cả" thì tự thêm element mới
        scenes: p.scenes.map((s) =>
          s.elementIds.length === p.elements.length ? { ...s, elementIds: [...s.elementIds, el.id] } : s
        )
      }))
      return el
    },
    updateElement: (id, patch) => {
      if (patch.name !== undefined) patch = { ...patch, name: patch.name.replace(/[^\w]/g, '_') }
      patchProject((p) => ({ elements: p.elements.map((e) => (e.id === id ? { ...e, ...patch } : e)) }))
    },
    removeElement: (id) =>
      patchProject((p) => ({
        elements: p.elements.filter((e) => e.id !== id),
        scenes: p.scenes.map((s) => ({ ...s, elementIds: s.elementIds.filter((x) => x !== id) }))
      })),

    addScene: (partial) => {
      const p = get().project
      const scene: Scene = {
        id: uid(),
        title: `Scene ${p.scenes.length + 1}`,
        prompt: '',
        duration: 4,
        elementIds: p.elements.map((e) => e.id),
        status: 'idle',
        version: 0,
        ...partial
      }
      patchProject((p) => ({ scenes: [...p.scenes, scene] }))
      return scene
    },
    updateScene: (id, patch) =>
      patchProject((p) => ({ scenes: p.scenes.map((s) => (s.id === id ? { ...s, ...patch } : s)) })),
    removeScene: (id) => patchProject((p) => ({ scenes: p.scenes.filter((s) => s.id !== id) })),
    moveScene: (id, dir) =>
      patchProject((p) => {
        const i = p.scenes.findIndex((s) => s.id === id)
        const j = i + dir
        if (i < 0 || j < 0 || j >= p.scenes.length) return {}
        const scenes = p.scenes.slice()
        ;[scenes[i], scenes[j]] = [scenes[j], scenes[i]]
        return { scenes }
      }),

    addMedia: (items) => patchProject((p) => ({ media: [...p.media, ...items] })),
    // Xoá media không undo được (lịch sử timeline có thể còn trỏ tới nó) nên xoá luôn lịch sử
    removeMedia: (id) =>
      set((s) => ({
        past: [],
        future: [],
        selectedClipId: null,
        project: {
          ...s.project,
          media: s.project.media.filter((m) => m.id !== id),
          timeline: s.project.timeline.filter((c) => c.mediaId !== id),
          music: s.project.music?.mediaId === id ? undefined : s.project.music,
          scenes: s.project.scenes.map((sc) => (sc.mediaId === id ? { ...sc, mediaId: undefined, status: 'idle' } : sc))
        }
      })),

    appendToTimeline: (mediaId, index) => {
      const m = get().project.media.find((x) => x.id === mediaId)
      if (!m) return
      if (m.kind === 'audio') {
        get().setMusic({ mediaId, volume: 0.6, in: 0 })
        return
      }
      const clip: TimelineClip = { id: uid(), mediaId, in: 0, out: m.duration, volume: 1, speed: 1, transition: 'none', transitionDuration: 0.5 }
      commit((p) => {
        const tl = p.timeline.slice()
        tl.splice(index ?? tl.length, 0, clip)
        return { timeline: tl }
      })
      set({ selectedClipId: clip.id, preview: { type: 'timeline' } })
      // timeline ngắn thì phóng to cho dễ nhìn (kiểu CapCut tự vừa khung)
      const total = totalDuration(get().project.timeline)
      if (total > 0 && total * get().zoom < 500) set({ zoom: Math.min(200, 900 / total) })
    },
    splitAtPlayhead: () => {
      const { project, playhead } = get()
      const next = splitAt(project.timeline, playhead, uid)
      if (next !== project.timeline) commit(() => ({ timeline: next }))
    },
    trimLeft: () => {
      const { project, playhead } = get()
      const next = trimLeftAt(project.timeline, playhead)
      if (next !== project.timeline) commit(() => ({ timeline: next }))
    },
    trimRight: () => {
      const { project, playhead } = get()
      const next = trimRightAt(project.timeline, playhead)
      if (next !== project.timeline) commit(() => ({ timeline: next }))
    },
    setClip: (id, patch, history = true) => {
      const fn = (p: Project) => ({ timeline: p.timeline.map((c) => (c.id === id ? { ...c, ...patch } : c)) })
      history ? commit(fn) : patchProject(fn)
    },
    deleteSelected: () => {
      const id = get().selectedClipId
      if (!id) return
      commit((p) => ({ timeline: p.timeline.filter((c) => c.id !== id) }))
      const total = totalDuration(get().project.timeline)
      set((s) => ({ selectedClipId: null, playhead: Math.min(s.playhead, total) }))
    },
    duplicateSelected: () => {
      const id = get().selectedClipId
      if (!id) return
      commit((p) => {
        const i = p.timeline.findIndex((c) => c.id === id)
        if (i < 0) return {}
        const tl = p.timeline.slice()
        tl.splice(i + 1, 0, { ...tl[i], id: uid() })
        return { timeline: tl }
      })
    },
    // Kéo trim: chụp lịch sử 1 lần lúc bắt đầu kéo, các bước kéo sau không ghi lịch sử
    beginTrim: () => set((s) => ({ past: [...s.past.slice(-99), snap(s.project)], future: [] })),
    trim: (id, edge, value) => {
      const p = get().project
      const clip = p.timeline.find((c) => c.id === id)
      const m = clip && p.media.find((x) => x.id === clip.mediaId)
      if (!m) return
      patchProject((p) => ({ timeline: trimClip(p.timeline, id, edge, value, m.duration) }))
    },
    move: (id, toIndex) => commit((p) => ({ timeline: moveClip(p.timeline, id, toIndex) })),
    setClipVolume: (id, v) =>
      patchProject((p) => ({ timeline: p.timeline.map((c) => (c.id === id ? { ...c, volume: v } : c)) })),
    setMusic: (m) => commit(() => ({ music: m })),
    undo: () =>
      set((s) => {
        const prev = s.past[s.past.length - 1]
        if (!prev) return {}
        return { past: s.past.slice(0, -1), future: [snap(s.project), ...s.future], project: { ...s.project, ...prev } }
      }),
    redo: () =>
      set((s) => {
        const next = s.future[0]
        if (!next) return {}
        return { future: s.future.slice(1), past: [...s.past, snap(s.project)], project: { ...s.project, ...next } }
      }),

    setPlayhead: (t) => set({ playhead: Math.max(0, Math.min(t, totalDuration(get().project.timeline))) }),
    setPlaying: (playing) => set({ playing }),
    select: (selectedClipId) => set({ selectedClipId }),
    setPreview: (preview) => set({ preview, playing: false }),
    setZoom: (zoom) => set({ zoom: Math.max(10, Math.min(400, zoom)) })
  }
})

export const mediaById = (id: string | undefined) => useStore.getState().project.media.find((m) => m.id === id)
