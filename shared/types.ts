// Kiểu dữ liệu dùng chung giữa main process và renderer.

export type ElementKind = 'text' | 'color' | 'image' | 'font' | 'note'

/** Một "brand element" anh đưa vào để Claude dựng motion graphic. */
export interface BrandElement {
  id: string
  kind: ElementKind
  /** Tên ngắn, Claude dùng để tham chiếu: api.el.<name> / api.img.<name> */
  name: string
  /** text/note: nội dung; color: #hex; font: tên font hệ thống; image: đường dẫn file */
  value: string
}

export interface ProjectSettings {
  width: number
  height: number
  fps: number
}

export type SceneStatus = 'idle' | 'generating' | 'rendering' | 'ready' | 'error'

/** Một clip motion graphic nhỏ do Claude generate. */
export interface Scene {
  id: string
  title: string
  prompt: string
  duration: number
  elementIds: string[]
  status: SceneStatus
  progress?: number
  code?: string
  notes?: string
  error?: string
  /** media id của bản render mới nhất */
  mediaId?: string
  /** số lần đã generate (phiên bản) */
  version: number
}

export interface MediaItem {
  id: string
  kind: 'motion' | 'video' | 'audio'
  name: string
  path: string
  duration: number
  hasAudio: boolean
  width?: number
  height?: number
  sceneId?: string
}

/** Clip nằm trên track video chính (kiểu magnetic như CapCut). */
export interface TimelineClip {
  id: string
  mediaId: string
  /** điểm vào/ra trong media gốc (giây) */
  in: number
  out: number
  volume: number
}

export interface MusicTrack {
  mediaId: string
  volume: number
  /** offset trong file nhạc (giây) */
  in: number
}

export interface Project {
  version: 1
  name: string
  settings: ProjectSettings
  elements: BrandElement[]
  scenes: Scene[]
  media: MediaItem[]
  timeline: TimelineClip[]
  music?: MusicTrack
}

// ---------- IPC payloads ----------

export interface GenerateRequest {
  scene: Pick<Scene, 'title' | 'prompt' | 'duration'>
  elements: BrandElement[]
  settings: ProjectSettings
  /** Khi refine: code hiện tại + yêu cầu sửa */
  previousCode?: string
  instruction?: string
  /** Khi auto-fix: lỗi runtime từ sandbox */
  runtimeError?: string
  model?: string
}

export interface GenerateResult {
  title: string
  duration: number
  code: string
  notes: string
}

export interface StoryboardRequest {
  brief: string
  sceneCount: number
  totalDuration: number
  elements: BrandElement[]
  settings: ProjectSettings
  model?: string
}

export interface StoryboardScene {
  title: string
  prompt: string
  duration: number
  elementNames: string[]
}

export interface ExportRequest {
  outPath: string
  settings: ProjectSettings
  clips: { path: string; in: number; out: number; hasAudio: boolean; volume: number }[]
  music?: { path: string; in: number; volume: number }
  quality: 'draft' | 'high'
}

export interface AppSettings {
  hasApiKey: boolean
  keySource: 'stored' | 'env' | 'none'
  model: string
}
