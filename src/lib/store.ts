import { create } from 'zustand'
import type {
  BrandElement,
  ElementKind,
  MediaItem,
  Project,
  ProjectSettings,
  Scene,
  TimelineClip,
  Track,
  TrackClip,
  TransitionKind
} from '../../shared/types'
import { uid } from './media'
import {
  freeStart,
  migrateProject,
  moveClip,
  projectDuration,
  splitAt,
  splitTrackClip,
  tEnd,
  tLength,
  totalDuration,
  trimClip,
  trimLeftAt,
  trimRightAt,
  trimTrackClip,
  tSpeed,
  mediaLimit
} from './timeline'

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

type Snapshot = Pick<Project, 'timeline' | 'tracks'>

interface State {
  project: Project
  // UI
  playhead: number
  playing: boolean
  selectedClipId: string | null
  preview: PreviewTarget
  zoom: number // pixel / giây
  /** đang rê chuột lên 1 kiểu chuyển cảnh: preview lặp đoạn nối */
  hoverTransition: { clipId: string; kind: TransitionKind } | null
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
  // track phụ
  addTrack: (kind: 'video' | 'audio') => string
  updateTrack: (id: string, patch: Partial<Track>, history?: boolean) => void
  removeTrack: (id: string) => void
  /** thêm media vào track (không truyền trackId: tự chọn/ tạo track phù hợp) tại thời điểm start */
  addToTrack: (mediaId: string, start: number, trackId?: string) => void
  setTrackClip: (id: string, patch: Partial<TrackClip>, history?: boolean) => void
  /** dời clip sang thời điểm / track khác (không ghi lịch sử, gọi beginTrim trước) */
  moveTrackClip: (id: string, start: number, trackId?: string) => boolean
  trimTrack: (id: string, edge: 'in' | 'out', value: number) => void
  undo: () => void
  redo: () => void

  setPlayhead: (t: number) => void
  setPlaying: (p: boolean) => void
  select: (id: string | null) => void
  setPreview: (p: PreviewTarget) => void
  setZoom: (z: number) => void
  setHoverTransition: (h: { clipId: string; kind: TransitionKind } | null) => void
}

const snap = (p: Project): Snapshot => ({ timeline: p.timeline, tracks: p.tracks })

/** Tìm clip theo id trên track phụ */
export function findTrackClip(p: Project, id: string | null): { track: Track; clip: TrackClip } | null {
  if (!id) return null
  for (const t of p.tracks ?? []) {
    const c = t.clips.find((x) => x.id === id)
    if (c) return { track: t, clip: c }
  }
  return null
}

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
    hoverTransition: null,
    past: [],
    future: [],

    setProject: (p) =>
      set({
        project: migrateProject(p, uid, (id) => p.media.find((m) => m.id === id)?.duration ?? 0),
        past: [],
        future: [],
        playhead: 0,
        playing: false,
        selectedClipId: null,
        preview: { type: 'timeline' }
      }),
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
          tracks: (s.project.tracks ?? []).map((t) => ({ ...t, clips: t.clips.filter((c) => c.mediaId !== id) })),
          scenes: s.project.scenes.map((sc) => (sc.mediaId === id ? { ...sc, mediaId: undefined, status: 'idle' } : sc))
        }
      })),

    appendToTimeline: (mediaId, index) => {
      const m = get().project.media.find((x) => x.id === mediaId)
      if (!m) return
      // âm thanh -> track âm thanh; clip nền trong suốt -> track video phủ (tại playhead)
      if (m.kind === 'audio' || m.alpha) {
        get().addToTrack(mediaId, get().playhead)
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
      const { project, playhead, selectedClipId } = get()
      const tc = findTrackClip(project, selectedClipId)
      if (tc) {
        const t2 = splitTrackClip(tc.track, tc.clip.id, playhead, uid)
        if (t2 !== tc.track) commit((p) => ({ tracks: (p.tracks ?? []).map((t) => (t.id === t2.id ? t2 : t)) }))
        return
      }
      const next = splitAt(project.timeline, playhead, uid)
      if (next !== project.timeline) commit(() => ({ timeline: next }))
    },
    trimLeft: () => {
      const { project, playhead, selectedClipId } = get()
      const tc = findTrackClip(project, selectedClipId)
      if (tc && playhead > tc.clip.start && playhead < tEnd(tc.clip)) {
        const m = project.media.find((x) => x.id === tc.clip.mediaId)
        return get().setTrackClip(tc.clip.id, trimTrackClip(tc.clip, 'in', tc.clip.in + (playhead - tc.clip.start) * tSpeed(tc.clip), m ? mediaLimit(m) : 1e9))
      }
      const next = trimLeftAt(project.timeline, playhead)
      if (next !== project.timeline) commit(() => ({ timeline: next }))
    },
    trimRight: () => {
      const { project, playhead, selectedClipId } = get()
      const tc = findTrackClip(project, selectedClipId)
      if (tc && playhead > tc.clip.start && playhead < tEnd(tc.clip)) {
        const m = project.media.find((x) => x.id === tc.clip.mediaId)
        return get().setTrackClip(tc.clip.id, trimTrackClip(tc.clip, 'out', tc.clip.in + (playhead - tc.clip.start) * tSpeed(tc.clip), m ? mediaLimit(m) : 1e9))
      }
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
      commit((p) => ({
        timeline: p.timeline.filter((c) => c.id !== id),
        tracks: (p.tracks ?? []).map((t) => ({ ...t, clips: t.clips.filter((c) => c.id !== id) }))
      }))
      const total = projectDuration(get().project)
      set((s) => ({ selectedClipId: null, playhead: Math.min(s.playhead, total) }))
    },
    duplicateSelected: () => {
      const id = get().selectedClipId
      if (!id) return
      const tc = findTrackClip(get().project, id)
      if (tc) {
        const len = tLength(tc.clip)
        const copy = { ...tc.clip, id: uid(), start: freeStart(tc.track.clips, tEnd(tc.clip), len) }
        commit((p) => ({ tracks: (p.tracks ?? []).map((t) => (t.id === tc.track.id ? { ...t, clips: [...t.clips, copy] } : t)) }))
        set({ selectedClipId: copy.id })
        return
      }
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
      patchProject((p) => ({ timeline: trimClip(p.timeline, id, edge, value, mediaLimit(m)) }))
    },
    move: (id, toIndex) => commit((p) => ({ timeline: moveClip(p.timeline, id, toIndex) })),
    setClipVolume: (id, v) =>
      patchProject((p) => ({ timeline: p.timeline.map((c) => (c.id === id ? { ...c, volume: v } : c)) })),
    addTrack: (kind) => {
      const tracks = get().project.tracks ?? []
      const n = tracks.filter((t) => t.kind === kind).length + 1
      const track: Track = { id: uid(), kind, name: kind === 'video' ? `Lớp phủ ${n}` : `Âm thanh ${n}`, clips: [] }
      // track video mới nằm trên cùng; track âm thanh thêm xuống dưới
      commit((p) => ({ tracks: kind === 'video' ? [track, ...(p.tracks ?? [])] : [...(p.tracks ?? []), track] }))
      return track.id
    },
    updateTrack: (id, patch, history = true) => {
      const fn = (p: Project) => ({ tracks: (p.tracks ?? []).map((t) => (t.id === id ? { ...t, ...patch } : t)) })
      history ? commit(fn) : patchProject(fn)
    },
    removeTrack: (id) => commit((p) => ({ tracks: (p.tracks ?? []).filter((t) => t.id !== id) })),
    addToTrack: (mediaId, start, trackId) => {
      const m = get().project.media.find((x) => x.id === mediaId)
      if (!m) return
      const kind = m.kind === 'audio' ? 'audio' : 'video'
      const clip: TrackClip = { id: uid(), mediaId, start: 0, in: 0, out: m.duration, volume: kind === 'audio' ? 0.8 : 1, speed: 1 }
      const len = tLength(clip)
      let tracks = get().project.tracks ?? []
      let target = tracks.find((t) => t.id === trackId && t.kind === kind)
      // track được chỉ định bị chiếm -> vẫn đặt vào, lùi ra sau clip đang chiếm
      if (!target) target = tracks.find((t) => t.kind === kind && freeStart(t.clips, start, len) === Math.max(0, start))
      if (!target) {
        get().addTrack(kind)
        tracks = get().project.tracks ?? []
        target = kind === 'video' ? tracks[0] : tracks[tracks.length - 1]
        // gộp vào lịch sử của lần thêm track
        set((s) => ({ past: s.past.slice(0, -1) }))
      }
      clip.start = freeStart(target.clips, start, len)
      const tid = target.id
      commit((p) => ({ tracks: (p.tracks ?? []).map((t) => (t.id === tid ? { ...t, clips: [...t.clips, clip] } : t)) }))
      set({ selectedClipId: clip.id, preview: { type: 'timeline' } })
    },
    setTrackClip: (id, patch, history = true) => {
      const fn = (p: Project) => ({ tracks: (p.tracks ?? []).map((t) => ({ ...t, clips: t.clips.map((c) => (c.id === id ? { ...c, ...patch } : c)) })) })
      history ? commit(fn) : patchProject(fn)
    },
    moveTrackClip: (id, start, trackId) => {
      const p = get().project
      const tc = findTrackClip(p, id)
      if (!tc) return false
      const dest = (trackId && (p.tracks ?? []).find((t) => t.id === trackId && t.kind === tc.track.kind)) || tc.track
      const len = tLength(tc.clip)
      const s0 = Math.max(0, start)
      const free = dest.clips.every((c) => c.id === id || s0 >= tEnd(c) - 1e-6 || s0 + len <= c.start + 1e-6)
      if (!free) return false
      const moved = { ...tc.clip, start: s0 }
      patchProject((pp) => ({
        tracks: (pp.tracks ?? []).map((t) => {
          let clips = t.clips.filter((c) => c.id !== id)
          if (t.id === dest.id) clips = [...clips, moved]
          return { ...t, clips }
        })
      }))
      return true
    },
    trimTrack: (id, edge, value) => {
      const p = get().project
      const tc = findTrackClip(p, id)
      const m = tc && p.media.find((x) => x.id === tc.clip.mediaId)
      if (!tc || !m) return
      const next = trimTrackClip(tc.clip, edge, value, mediaLimit(m))
      // không cho đè clip bên cạnh
      const others = tc.track.clips.filter((c) => c.id !== id)
      if (others.some((c) => next.start < tEnd(c) - 1e-6 && c.start < tEnd(next) - 1e-6)) return
      get().setTrackClip(id, next, false)
    },
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

    setPlayhead: (t) => set({ playhead: Math.max(0, Math.min(t, projectDuration(get().project))) }),
    setPlaying: (playing) => set({ playing }),
    select: (selectedClipId) => set({ selectedClipId }),
    setPreview: (preview) => set({ preview, playing: false }),
    setZoom: (zoom) => set({ zoom: Math.max(10, Math.min(400, zoom)) }),
    setHoverTransition: (hoverTransition) => set({ hoverTransition })
  }
})

export const mediaById = (id: string | undefined) => useStore.getState().project.media.find((m) => m.id === id)
