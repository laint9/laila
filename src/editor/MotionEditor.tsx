// Motion Editor: mở 1 scene như một composition trong After Effects.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../components/Icon'
import { duplicateLayer, KEY_EPS, newCodeLayer, newImageLayer, nextKeyTime, setPropAt, splitLayer, toggleKeyAt, getProp, withProp } from '../engine/edit'
import { SceneRunner } from '../engine/player'
import { valueAt } from '../engine/ease'
import { cleanError, elementsFor, motionOf, rerenderScene, reviseMotion } from '../lib/pipeline'
import { useStore } from '../lib/store'
import { EditorContext } from './context'
import { Inspector } from './Inspector'
import { LayerTimeline } from './LayerTimeline'
import { LeftPanels } from './LeftPanels'
import { selectedLayer, useEditor, type Tool } from './state'
import { Viewer } from './Viewer'
import { Splitter } from '../components/Splitter'
import { useLayout } from '../lib/layout'

export function MotionEditor({ sceneId, onClose }: { sceneId: string; onClose: () => void }) {
  const scene0 = useStore((s) => s.project.scenes.find((x) => x.id === sceneId))
  const settings = useStore((s) => s.project.settings)
  const elementsAll = useStore((s) => s.project.elements)
  const elements = useMemo(() => (scene0 ? elementsFor(scene0) : []), [scene0?.elementIds, elementsAll])
  const runner = useMemo(() => new SceneRunner(settings, elements), [settings, elements])
  useEffect(() => () => runner.dispose(), [runner])

  const scene = useEditor((s) => s.scene)
  const duration = useEditor((s) => s.duration)
  const playing = useEditor((s) => s.playing)
  const loop = useEditor((s) => s.loop)
  const tool = useEditor((s) => s.tool)
  const canUndo = useEditor((s) => s.past.length > 0)
  const canRedo = useEditor((s) => s.future.length > 0)
  const ed = useEditor.getState
  const [ask, setAsk] = useState('')
  const [asking, setAsking] = useState(false)
  const [askError, setAskError] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const opened = useRef(false)
  const sizes = useLayout((s) => s.sizes)

  // mở composition
  useEffect(() => {
    if (!scene0) return
    const m = motionOf(scene0) ?? { background: '#000000', layers: [] }
    ed().open(sceneId, m, scene0.duration)
    opened.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneId])

  // lưu ngược về project (debounce) — clip cần render lại
  useEffect(() => {
    if (!opened.current || !ed().dirty) return
    const h = setTimeout(() => useStore.getState().updateScene(sceneId, { motion: scene, duration, dirty: true, code: undefined }), 300)
    return () => clearTimeout(h)
  }, [scene, duration, sceneId])

  // phát
  useEffect(() => {
    if (!playing) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const s = ed()
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      let t = s.time + dt
      if (t >= s.duration) {
        if (!s.loop) {
          s.setTime(s.duration)
          s.setPlaying(false)
          return
        }
        t = 0
      }
      s.setTime(t)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing])

  // xem thử hiệu ứng khi rê chuột: chạy lặp from..to, thôi rê thì trả playhead về chỗ cũ
  const previewing = useEditor((s) => s.preview)
  useEffect(() => {
    if (!previewing) return
    const saved = ed().time
    const wasPlaying = ed().playing
    ed().setPlaying(false)
    const { from, to } = previewing
    let raf = 0
    let t0 = performance.now()
    const tick = (now: number) => {
      let t = from + (now - t0) / 1000
      if (t > to + 0.4) {
        t0 = now
        t = from
      }
      useEditor.setState({ time: Math.min(t, to) })
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      useEditor.setState({ time: saved })
      if (wasPlaying) ed().setPlaying(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewing?.from, previewing?.to, previewing?.scene])

  const finish = (render: boolean) => {
    const s = ed()
    useStore.getState().updateScene(sceneId, { motion: s.scene, duration: s.duration, code: undefined, ...(s.dirty ? { dirty: true } : {}) })
    s.setPlaying(false)
    onClose()
    if (render) rerenderScene(sceneId)
  }

  const askClaude = async () => {
    if (!ask.trim() || !scene0) return
    setAsking(true)
    setAskError(null)
    try {
      const r = await reviseMotion(scene0, ed().scene, ed().duration, ask.trim())
      ed().edit(() => r.scene)
      if (Math.abs(r.duration - ed().duration) > 0.01) ed().setDuration(r.duration)
      setAsk('')
    } catch (e) {
      setAskError(cleanError((e as Error).message))
    } finally {
      setAsking(false)
    }
  }

  // phím tắt kiểu AE
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA' || el?.tagName === 'SELECT') return
      const s = ed()
      const mod = e.metaKey || e.ctrlKey
      const frame = 1 / settings.fps
      const sel = selectedLayer(s)
      const k = e.key.toLowerCase()
      if (e.code === 'Space') {
        e.preventDefault()
        s.setPlaying(!s.playing)
      } else if (mod && k === 'z') {
        e.preventDefault()
        e.shiftKey ? s.redo() : s.undo()
      } else if (mod && e.shiftKey && k === 'd') {
        e.preventDefault()
        if (sel) s.edit((sc) => splitLayer(sc, sel.id, s.time))
      } else if (mod && k === 'd') {
        e.preventDefault()
        if (sel) s.edit((sc) => duplicateLayer(sc, sel.id))
      } else if (e.key === 'Escape') {
        if (s.tool !== 'select') s.setTool('select')
        else s.select(null)
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (s.keys.length) {
          s.edit((sc) => {
            let out = sc
            for (const r of s.keys) out = { ...out, layers: out.layers.map((l) => (l.id === r.layerId ? withProp(l, r.path, (p) => (p.keys?.some((x) => Math.abs(x.t - r.t) < KEY_EPS) ? toggleKeyAt(p, r.t) : p)) : l)) }
            return out
          })
          s.selectKeys([])
        } else if (sel) {
          s.edit((sc) => ({ ...sc, layers: sc.layers.filter((l) => l.id !== sel.id).map((l) => (l.parent === sel.id ? { ...l, parent: null } : l)) }))
          s.select(null)
        }
      } else if (e.key === 'F9') {
        e.preventDefault()
        s.easeSelectedKeys('easyEase')
      } else if (!mod && k === 'v') s.setTool('select')
      else if (!mod && k === 't') s.setTool('text')
      else if (!mod && k === 'q') s.setTool(s.tool === 'rect' ? 'ellipse' : s.tool === 'ellipse' ? 'line' : 'rect')
      else if (!mod && k === 'u') s.setFlag('onlyAnimated', !s.onlyAnimated)
      else if (!mod && (k === 'j' || k === 'k')) {
        const props = sel ? (['transform.x', 'transform.y', 'transform.scale', 'transform.rotation', 'transform.opacity', 'transform.blur', 'text.tracking', 'shape.width', 'shape.height', 'shape.trimEnd'] as const).map((p) => getProp(sel, p)).filter((p): p is NonNullable<typeof p> => !!p) : s.scene.layers.flatMap((l) => Object.values(l.transform))
        const t = nextKeyTime(props, s.time, k === 'k' ? 1 : -1)
        if (t !== null) s.setTime(t)
      } else if (e.altKey && (e.key === '[' || e.key === '“')) {
        if (sel) s.editLayer(sel.id, (l) => ({ ...l, in: Math.min(s.time, l.out - frame) }))
      } else if (e.altKey && (e.key === ']' || e.key === '‘')) {
        if (sel) s.editLayer(sel.id, (l) => ({ ...l, out: Math.max(s.time, l.in + frame) }))
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        if (sel && !e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown' || mod)) {
          // dịch layer 1px (Shift: 10px)
          e.preventDefault()
          const step = e.shiftKey ? 10 : 1
          const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
          const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
          s.editLayer(sel.id, (l) => ({
            ...l,
            transform: {
              ...l.transform,
              x: setPropAt(l.transform.x, s.time, valueAt(l.transform.x, s.time) + dx),
              y: setPropAt(l.transform.y, s.time, valueAt(l.transform.y, s.time) + dy)
            }
          }))
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault()
          s.setTime(s.time + (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 10 * frame : frame))
        }
      } else if (k === 'home') s.setTime(0)
      else if (k === 'end') s.setTime(s.duration)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [settings.fps])

  if (!scene0) return null
  const accent = elements.find((e) => e.kind === 'color')?.value ?? '#0A84FF'
  const tools: { id: Tool; icon: string; label: string; key: string }[] = [
    { id: 'select', icon: 'pointer', label: 'Chọn & di chuyển', key: 'V' },
    { id: 'text', icon: 'text', label: 'Chữ', key: 'T' },
    { id: 'rect', icon: 'rect', label: 'Hình chữ nhật', key: 'Q' },
    { id: 'ellipse', icon: 'ellipse', label: 'Hình elip', key: 'Q' },
    { id: 'line', icon: 'line', label: 'Đường thẳng', key: 'Q' }
  ]

  return (
    <EditorContext.Provider value={{ runner, W: settings.width, H: settings.height, elements }}>
      <div className="motion-editor" style={{ gridTemplateRows: `52px minmax(0, 1fr) ${sizes.edTimeline}px` }}>
        <header className="me-toolbar">
          <button className="btn" onClick={() => finish(false)} title="Lưu và quay lại">
            <Icon name="back" /> Studio
          </button>
          <div className="me-title">
            <b>{scene0.title}</b>
            <span className="muted small">Motion Editor</span>
          </div>
          <div className="tool-group">
            {tools.map((t) => (
              <button key={t.id} className={'tbtn ' + (tool === t.id ? 'on' : '')} title={`${t.label} (${t.key})`} onClick={() => ed().setTool(t.id)}>
                <Icon name={t.icon} />
              </button>
            ))}
            <div className="menu-wrap">
              <button className="tbtn" title="Thêm layer" onClick={() => setAddOpen(!addOpen)}>
                <Icon name="plus" />
              </button>
              {addOpen && (
                <div className="menu" onMouseLeave={() => setAddOpen(false)}>
                  {elements
                    .filter((e) => e.kind === 'image' && e.value)
                    .map((e) => (
                      <button
                        key={e.id}
                        onClick={() => {
                          const l = newImageLayer(settings.width, settings.height, duration, e.name)
                          ed().edit((sc) => ({ ...sc, layers: [l, ...sc.layers] }))
                          ed().select(l.id)
                          setAddOpen(false)
                        }}
                      >
                        <Icon name="image" size={14} /> Ảnh “{e.name}”
                      </button>
                    ))}
                  <button
                    onClick={() => {
                      const l = newCodeLayer(settings.width, settings.height, duration)
                      ed().edit((sc) => ({ ...sc, layers: [...sc.layers, l] }))
                      ed().select(l.id)
                      setAddOpen(false)
                    }}
                  >
                    <Icon name="code" size={14} /> Layer code (nền / hạt)
                  </button>
                </div>
              )}
            </div>
          </div>
          <div className="tool-group">
            <button className="tbtn" disabled={!canUndo} title="Hoàn tác (⌘Z)" onClick={() => ed().undo()}>
              <Icon name="undo" />
            </button>
            <button className="tbtn" disabled={!canRedo} title="Làm lại (⇧⌘Z)" onClick={() => ed().redo()}>
              <Icon name="redo" />
            </button>
          </div>
          <div className="tool-group">
            <button className="tbtn" title="Phát / dừng (Space)" onClick={() => ed().setPlaying(!playing)}>
              <Icon name={playing ? 'pause' : 'play'} />
            </button>
            <button className={'tbtn ' + (loop ? 'on' : '')} title="Lặp lại" onClick={() => ed().setFlag('loop', !loop)}>
              <Icon name="loop" />
            </button>
          </div>
          <div className="ask-claude">
            <Icon name="sparkles" />
            <input
              placeholder="Nhờ Claude sửa: “cho logo vào sau tiêu đề 0.3s, đổi nền trắng…”"
              value={ask}
              disabled={asking}
              onChange={(e) => setAsk(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && askClaude()}
            />
            <button className="btn" disabled={asking || !ask.trim()} onClick={askClaude}>
              {asking ? 'Đang sửa…' : 'Gửi'}
            </button>
          </div>
          <button className="btn primary" onClick={() => finish(true)}>
            Xong & Render
          </button>
        </header>
        {askError && (
          <div className="me-error">
            {askError}
            <button className="tiny" onClick={() => setAskError(null)}>
              <Icon name="close" size={11} />
            </button>
          </div>
        )}
        <div className="me-main" style={{ gridTemplateColumns: `${sizes.edLeft}px minmax(0, 1fr) ${sizes.edRight}px` }}>
          <Splitter k="edLeft" dir="right" className="at-x" style={{ left: sizes.edLeft - 4 }} />
          <Splitter k="edRight" dir="left" className="at-x" style={{ right: sizes.edRight - 4 }} />
          <aside className="me-left">
            <LeftPanels />
          </aside>
          <Viewer runner={runner} width={settings.width} height={settings.height} accent={accent} />
          <aside className="me-right">
            <Inspector />
          </aside>
        </div>
        <div className="timeline-wrap">
          <Splitter k="edTimeline" dir="up" className="edge-top" />
          <LayerTimeline fps={settings.fps} />
        </div>
      </div>
    </EditorContext.Provider>
  )
}
