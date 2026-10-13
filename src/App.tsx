import { useEffect, useRef, useState } from 'react'
import { useStore } from './lib/store'
import { TopBar } from './components/TopBar'
import { ElementsPanel } from './components/ElementsPanel'
import { MediaBin } from './components/MediaBin'
import { Studio } from './components/Studio'
import { Preview } from './components/Preview'
import { Timeline } from './components/Timeline'
import { SettingsModal } from './components/SettingsModal'
import { ExportModal } from './components/ExportModal'
import { MotionEditor } from './editor/MotionEditor'
import { applyTheme } from './lib/theme'
import type { AppSettings } from '../shared/types'

applyTheme()

export function App() {
  const project = useStore((s) => s.project)
  const [leftTab, setLeftTab] = useState<'elements' | 'media'>('elements')
  const [showSettings, setShowSettings] = useState(false)
  const [showExport, setShowExport] = useState(false)
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const editingRef = useRef<string | null>(null)
  editingRef.current = editing
  const loaded = useRef(false)

  // Mở lại phiên làm việc trước
  useEffect(() => {
    window.laila.project.loadAutosave().then((p) => {
      if (p) {
        // scene đang chạy dở khi tắt app thì đưa về trạng thái hợp lệ
        p.scenes = p.scenes.map((s) =>
          s.status === 'generating' || s.status === 'rendering'
            ? { ...s, status: s.mediaId ? 'ready' : 'idle', progress: undefined }
            : s
        )
        useStore.getState().setProject(p)
      }
      loaded.current = true
    })
    window.laila.settings.get().then((s) => {
      setAppSettings(s)
      if (!s.hasApiKey) setShowSettings(true)
    })
  }, [])

  // Autosave (debounce)
  useEffect(() => {
    if (!loaded.current) return
    const t = setTimeout(() => window.laila.project.autosave(project), 600)
    return () => clearTimeout(t)
  }, [project])

  // Phím tắt kiểu CapCut
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editingRef.current) return // Motion Editor có phím tắt riêng
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target as HTMLElement)?.isContentEditable) return
      const s = useStore.getState()
      const mod = e.metaKey || e.ctrlKey
      const frame = 1 / s.project.settings.fps
      if (e.code === 'Space') {
        e.preventDefault()
        s.setPlaying(!s.playing)
      } else if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        e.shiftKey ? s.redo() : s.undo()
      } else if (mod && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        s.splitAtPlayhead()
      } else if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        s.duplicateSelected()
      } else if (!mod && e.key.toLowerCase() === 's') {
        s.splitAtPlayhead()
      } else if (!mod && e.key.toLowerCase() === 'q') {
        s.trimLeft()
      } else if (!mod && e.key.toLowerCase() === 'w') {
        s.trimRight()
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        s.deleteSelected()
      } else if (e.key === 'ArrowLeft') {
        s.setPlayhead(s.playhead - (e.shiftKey ? 1 : frame))
      } else if (e.key === 'ArrowRight') {
        s.setPlayhead(s.playhead + (e.shiftKey ? 1 : frame))
      } else if (e.key === 'Home') {
        s.setPlayhead(0)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="app">
      <TopBar
        onSettings={() => setShowSettings(true)}
        onExport={() => setShowExport(true)}
        apiReady={!!appSettings?.hasApiKey}
      />
      <div className="workspace">
        <aside className="sidebar">
          <div className="tabs">
            <div className="segmented full">
              <button className={leftTab === 'elements' ? 'on' : ''} onClick={() => setLeftTab('elements')}>
                Brand kit
              </button>
              <button className={leftTab === 'media' ? 'on' : ''} onClick={() => setLeftTab('media')}>
                Media <span className="count">{project.media.length}</span>
              </button>
            </div>
          </div>
          {leftTab === 'elements' ? <ElementsPanel /> : <MediaBin />}
        </aside>
        <main className="content">
          <Studio onNeedKey={() => setShowSettings(true)} apiReady={!!appSettings?.hasApiKey} onEdit={setEditing} />
        </main>
        <section className="inspector-pane">
          <Preview />
        </section>
      </div>
      <Timeline />
      {showSettings && appSettings && (
        <SettingsModal settings={appSettings} onChange={setAppSettings} onClose={() => setShowSettings(false)} />
      )}
      {showExport && <ExportModal onClose={() => setShowExport(false)} />}
      {editing && <MotionEditor sceneId={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}
