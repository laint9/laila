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
  /** video khác tỉ lệ khung: true = phóng to lấp đầy (cắt viền), false = thu nhỏ vừa khung (viền đen) */
  fill?: boolean
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
  /** render nền trong suốt (webm alpha) để dùng làm lớp phủ */
  alpha?: boolean
  /** scene dạng layer/keyframe (MotionScene trong src/engine/types.ts) */
  motion?: unknown
  /** định dạng cũ (chỉ code) — tự chuyển sang motion khi mở project */
  code?: string
  notes?: string
  error?: string
  /** media id của bản render mới nhất */
  mediaId?: string
  /** đã chỉnh trong Motion Editor nhưng chưa render lại */
  dirty?: boolean
  /** số lần đã generate (phiên bản) */
  version: number
}

export interface MediaItem {
  id: string
  kind: 'motion' | 'video' | 'audio' | 'image'
  name: string
  /** file dùng để phát/xuất (vector đã được chuyển sang PNG) */
  path: string
  /** ảnh: thời lượng mặc định khi đặt lên timeline (kéo dài tuỳ ý) */
  duration: number
  hasAudio: boolean
  width?: number
  height?: number
  sceneId?: string
  /** có kênh trong suốt (webm VP9 alpha, PNG/SVG/PDF nền trong) — dùng làm lớp phủ */
  alpha?: boolean
  /** file gốc khi khác `path` (vd .svg, .pdf, .ai đã chuyển sang PNG) */
  source?: string
}

/** Kết quả phân loại file kéo thả / chọn từ máy */
export interface ImportedFile {
  item?: MediaItem
  /** vector cần renderer vẽ ra PNG (svg/pdf/ai) */
  vector?: 'svg' | 'pdf'
  path: string
  error?: string
}

/** Clip nằm trên track video chính (kiểu magnetic như CapCut). */
export interface TimelineClip {
  id: string
  mediaId: string
  /** điểm vào/ra trong media gốc (giây) */
  in: number
  out: number
  volume: number
  /** tốc độ 0.25 - 4 */
  speed?: number
  /** chuyển cảnh sang clip kế tiếp */
  transition?: TransitionKind
  transitionDuration?: number
  /** fade âm thanh đầu/cuối clip (giây) */
  audioFadeIn?: number
  audioFadeOut?: number
}

/** Clip trên track phụ (đặt tự do theo thời gian, không hút như track chính) */
export interface TrackClip {
  id: string
  mediaId: string
  /** vị trí bắt đầu trên timeline (giây) */
  start: number
  in: number
  out: number
  volume: number
  speed?: number
  audioFadeIn?: number
  audioFadeOut?: number
  /** chỉ cho track video phủ */
  opacity?: number // 0..100
  scale?: number // %
  x?: number // px lệch so với tâm khung
  y?: number
}

export interface Track {
  id: string
  kind: 'video' | 'audio'
  name: string
  muted?: boolean
  hidden?: boolean
  clips: TrackClip[]
}

/** @deprecated dùng track âm thanh; chỉ còn để đọc project cũ */
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
  /** track phụ: video phủ (đứng trước = nằm trên) và âm thanh */
  tracks?: Track[]
  /** vạch beat của nhạc trên timeline (giây) — hiện trên thước và để hít khi chỉnh tay */
  beatMarkers?: number[]
  music?: MusicTrack
}

// ---------- IPC payloads ----------

export interface GenerateRequest {
  scene: Pick<Scene, 'title' | 'prompt' | 'duration'>
  elements: BrandElement[]
  settings: ProjectSettings
  /** Khi refine: scene hiện tại (JSON) + yêu cầu sửa */
  previousScene?: unknown
  instruction?: string
  /** Khi auto-fix: lỗi runtime từ layer code */
  runtimeError?: string
  model?: string
}

export interface GenerateResult {
  title: string
  duration: number
  notes: string
  /** MotionScene thô, renderer sẽ chuẩn hoá */
  scene: unknown
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

export type TransitionKind = 'none' | 'fade' | 'fadeblack' | 'fadewhite' | 'slideleft' | 'slideup' | 'wipeleft' | 'circleopen' | 'zoomin' | 'dissolve'

export interface ExportClip {
  path: string
  in: number
  out: number
  hasAudio: boolean
  volume: number
  speed: number
  /** chuyển cảnh SANG clip kế tiếp */
  transition: TransitionKind
  transitionDuration: number
  fadeIn: number
  fadeOut: number
  /** ảnh tĩnh (lặp 1 khung) */
  image?: boolean
}

export interface ExportRequest {
  outPath: string
  settings: ProjectSettings
  clips: ExportClip[]
  /** clip trên track video phủ, thứ tự vẽ từ dưới lên trên */
  overlays?: ExportOverlay[]
  /** clip trên track âm thanh */
  audios?: ExportAudio[]
  music?: { path: string; in: number; volume: number }
  quality: 'draft' | 'high'
}

export interface ExportAudio {
  path: string
  start: number
  in: number
  out: number
  speed: number
  volume: number
  fadeIn: number
  fadeOut: number
}

export interface ExportOverlay extends ExportAudio {
  hasAudio: boolean
  alpha: boolean
  image?: boolean
  opacity: number
  scale: number
  x: number
  y: number
}

export interface AppSettings {
  hasApiKey: boolean
  keySource: 'stored' | 'env' | 'none'
  model: string
}

// ---------- phân tích reference ----------

export interface ReferenceTechnique {
  name: string
  detail: string
  /** yes = làm lại được trong app; approx = gần giống; no = không làm được */
  replicable: 'yes' | 'approx' | 'no'
}

export interface ReferenceAnalysis {
  summary: string
  feasibility: 'high' | 'partial' | 'low'
  feasibilityReason: string
  techniques: ReferenceTechnique[]
  timing: string
  palette: string[]
  tips: string[]
}

export interface ReferenceRequest {
  path: string
  /** ghi chú của người dùng: muốn lấy phần nào của reference */
  note?: string
  elements: BrandElement[]
  settings: ProjectSettings
  model?: string
}

export interface ReferenceResult {
  analysis: ReferenceAnalysis
  title: string
  duration: number
  notes: string
  /** MotionScene thô để dựng lại hiệu ứng; null nếu không dựng được */
  scene: unknown | null
  frames: number
}

// ---------- âm thanh ----------

export interface SoundDesignRequest {
  prompt: string
  /** 'auto' = để Claude tự chọn hiệu ứng hay nhạc */
  kind: 'auto' | 'sfx' | 'music'
  /** độ dài mong muốn cho nhạc (giây) */
  length: number
  model?: string
}

export interface SoundDesignResult {
  type: 'sfx' | 'music'
  name: string
  /** SfxSpec hoặc MusicSpec thô, renderer chuẩn hoá */
  spec: unknown
  notes: string
}

// ---------- dựng theo nhạc ----------
export interface ShotRatingRequest {
  shots: { id: string; length: number; image: string }[]
  brief?: string
  model?: string
}

export interface ShotRatingResult {
  ratings: { id: string; score: number; tag: string; skip: boolean }[]
  notes: string
}
