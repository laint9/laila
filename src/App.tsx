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
import { ReferenceModal } from './components/ReferenceModal'
import { SoundPanel } from './components/SoundPanel'
import { AutoEditModal } from './components/AutoEditModal'
import { Splitter } from './components/Splitter'
import { useLayout } from './lib/layout'
import { applyTheme } from './lib/theme'
import { startFontWatch } from './lib/fonts'
import { hasFiles, importDropped, onImportErrors } from './lib/importer'
import type { AppSettings } from '../shared/types'

applyTheme()

export function App() {
  const project = useStore((s) => s.project)
  const [leftTab, setLeftTab] = useState<'elements' | 'media' | 'sound'>('elements')
  const [showSettings, setShowSettings] = useState(false)
  const [showExport, setShowExport] = useState(false)
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [showReference, setShowReference] = useState(false)
  const [showAutoEdit, setShowAutoEdit] = useState(false)
  const sizes = useLayout((s) => s.sizes)
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
    startFontWatch()
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

  // Kéo file từ Finder vào bất kỳ đâu: nhập vào Media. Vùng riêng (timeline, brand kit, editor) tự xử lý trước.
  const [fileDrag, setFileDrag] = useState(false)
  const [importErrors, setImportErrors] = useState<string[]>([])
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const offErr = onImportErrors((msgs) => {
      setImportErrors(msgs)
      clearTimeout(timer)
      timer = setTimeout(() => setImportErrors([]), 8000)
    })
    const over = (e: DragEvent) => {
      if (!hasFiles(e)) return
      // chặn Electron mở file thay cho app
      e.preventDefault()
      setFileDrag(true)
    }
    const leave = (e: DragEvent) => {
      if (!e.relatedTarget) setFileDrag(false)
    }
    const end = () => setFileDrag(false)
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      if (editingRef.current) return // Motion Editor chỉ nhận ảnh thả vào khung hình
      const files = [...e.dataTransfer!.files]
      if (!files.length) return
      setLeftTab('media')
      importDropped(files)
    }
    window.addEventListener('dragover', over)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', end, true)
    window.addEventListener('dragend', end)
    window.addEventListener('drop', drop)
    return () => {
      offErr()
      clearTimeout(timer)
      window.removeEventListener('dragover', over)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', end, true)
      window.removeEventListener('dragend', end)
      window.removeEventListener('drop', drop)
    }
  }, [])

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
    <div className={'app' + (fileDrag ? ' file-dragging' : '')} style={{ gridTemplateRows: `52px minmax(0, 1fr) ${sizes.timeline}px` }}>
      <TopBar
        onSettings={() => setShowSettings(true)}
        onExport={() => setShowExport(true)}
        apiReady={!!appSettings?.hasApiKey}
      />
      <div className="workspace" style={{ gridTemplateColumns: `${sizes.left}px minmax(0, 1fr) ${sizes.right}px` }}>
        <aside className="sidebar">
          <div className="tabs">
            <div className="segmented full">
              <button className={leftTab === 'elements' ? 'on' : ''} onClick={() => setLeftTab('elements')}>
                Brand kit
              </button>
              <button className={leftTab === 'media' ? 'on' : ''} onClick={() => setLeftTab('media')}>
                Media <span className="count">{project.media.length}</span>
              </button>
              <button className={leftTab === 'sound' ? 'on' : ''} onClick={() => setLeftTab('sound')}>
                Âm thanh
              </button>
            </div>
          </div>
          {leftTab === 'elements' ? (
            <ElementsPanel />
          ) : leftTab === 'media' ? (
            <MediaBin />
          ) : (
            <SoundPanel apiReady={!!appSettings?.hasApiKey} onNeedKey={() => setShowSettings(true)} />
          )}
          <Splitter k="left" dir="right" className="edge-right" />
        </aside>
        <main className="content">
          <Studio onNeedKey={() => setShowSettings(true)} apiReady={!!appSettings?.hasApiKey} onEdit={setEditing} onReference={() => setShowReference(true)} onAutoEdit={() => setShowAutoEdit(true)} />
        </main>
        <section className="inspector-pane">
          <Splitter k="right" dir="left" className="edge-left" />
          <Preview />
        </section>
      </div>
      <div className="timeline-wrap">
        <Splitter k="timeline" dir="up" className="edge-top" />
        <Timeline />
      </div>
      {showSettings && appSettings && (
        <SettingsModal settings={appSettings} onChange={setAppSettings} onClose={() => setShowSettings(false)} />
      )}
      {showExport && <ExportModal onClose={() => setShowExport(false)} />}
      {showReference && <ReferenceModal onClose={() => setShowReference(false)} onEdit={setEditing} />}
      {showAutoEdit && <AutoEditModal apiReady={!!appSettings?.hasApiKey} onClose={() => setShowAutoEdit(false)} />}
      {editing && <MotionEditor sceneId={editing} onClose={() => setEditing(null)} />}
      {fileDrag && (
        <div className="drop-hint">
          {editing ? 'Thả ảnh / vector vào khung hình để thêm layer' : 'Thả để nhập vào Media · thả xuống timeline để đặt đúng vị trí'}
        </div>
      )}
      {importErrors.length > 0 && (
        <div className="import-errors" onClick={() => setImportErrors([])}>
          <b>Không nhập được {importErrors.length} file</b>
          {importErrors.map((m) => (
            <div key={m}>{m}</div>
          ))}
        </div>
      )}
    </div>
  )
}
