import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppSettings,
  ExportRequest,
  GenerateRequest,
  GenerateResult,
  ReferenceRequest,
  ReferenceResult,
  SoundDesignRequest,
  SoundDesignResult,
  MediaItem,
  Project,
  StoryboardRequest,
  StoryboardScene
} from '../shared/types'

const api = {
  settings: {
    get: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
    setKey: (key: string): Promise<AppSettings> => ipcRenderer.invoke('settings:setKey', key),
    setModel: (model: string): Promise<AppSettings> => ipcRenderer.invoke('settings:setModel', model)
  },
  claude: {
    generate: (reqId: string, req: GenerateRequest): Promise<GenerateResult> =>
      ipcRenderer.invoke('claude:generate', reqId, req),
    storyboard: (reqId: string, req: StoryboardRequest): Promise<StoryboardScene[]> =>
      ipcRenderer.invoke('claude:storyboard', reqId, req),
    sound: (reqId: string, req: SoundDesignRequest): Promise<SoundDesignResult> => ipcRenderer.invoke('claude:sound', reqId, req),
    cancel: (reqId: string): Promise<void> => ipcRenderer.invoke('claude:cancel', reqId)
  },
  audio: {
    save: (name: string, data: Uint8Array): Promise<MediaItem> => ipcRenderer.invoke('audio:save', name, data)
  },
  reference: {
    pick: (): Promise<string | null> => ipcRenderer.invoke('reference:pick'),
    analyze: (reqId: string, req: ReferenceRequest): Promise<ReferenceResult> => ipcRenderer.invoke('reference:analyze', reqId, req)
  },
  render: {
    start: (jobId: string, fps: number, label: string, alpha = false): Promise<string> =>
      ipcRenderer.invoke('render:start', jobId, fps, label, alpha),
    frame: (jobId: string, frame: Uint8Array): Promise<void> => ipcRenderer.invoke('render:frame', jobId, frame),
    finish: (
      jobId: string
    ): Promise<{ path: string; duration: number; hasAudio: boolean; width?: number; height?: number }> =>
      ipcRenderer.invoke('render:finish', jobId),
    abort: (jobId: string): Promise<void> => ipcRenderer.invoke('render:abort', jobId)
  },
  media: {
    import: (kind: 'video' | 'audio'): Promise<MediaItem[]> => ipcRenderer.invoke('media:import', kind),
    filmstrip: (path: string, duration: number): Promise<string | null> => ipcRenderer.invoke('media:filmstrip', path, duration),
    waveform: (path: string): Promise<string | null> => ipcRenderer.invoke('media:waveform', path)
  },
  file: {
    pickImage: (): Promise<string | null> => ipcRenderer.invoke('file:pickImage'),
    exists: (p: string): Promise<boolean> => ipcRenderer.invoke('file:exists', p),
    reveal: (p: string): Promise<void> => ipcRenderer.invoke('shell:reveal', p)
  },
  exporter: {
    pick: (name: string): Promise<string | null> => ipcRenderer.invoke('export:pick', name),
    run: (req: ExportRequest): Promise<void> => ipcRenderer.invoke('export:run', req),
    cancel: (): Promise<void> => ipcRenderer.invoke('export:cancel'),
    onProgress: (cb: (p: number) => void) => {
      const h = (_e: unknown, p: number) => cb(p)
      ipcRenderer.on('export:progress', h)
      return () => {
        ipcRenderer.removeListener('export:progress', h)
      }
    }
  },
  fonts: {
    scan: (): Promise<{ family: string; style: string; path: string }[]> => ipcRenderer.invoke('fonts:scan'),
    onChanged: (cb: () => void) => {
      const h = () => cb()
      ipcRenderer.on('fonts:changed', h)
      return () => {
        ipcRenderer.removeListener('fonts:changed', h)
      }
    }
  },
  project: {
    autosave: (p: Project): Promise<void> => ipcRenderer.invoke('project:autosave', p),
    loadAutosave: (): Promise<Project | null> => ipcRenderer.invoke('project:loadAutosave'),
    saveAs: (p: Project): Promise<string | null> => ipcRenderer.invoke('project:saveAs', p),
    open: (): Promise<Project | null> => ipcRenderer.invoke('project:open')
  }
}

export type LailaApi = typeof api

contextBridge.exposeInMainWorld('laila', api)
