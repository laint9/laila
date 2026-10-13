// Timeline layer kiểu After Effects: thanh layer (in/out), keyframe theo từng thuộc tính, kéo để chỉnh.
import { useLayoutEffect, useRef, useState } from 'react'
import { Icon } from '../components/Icon'
import { isAnimated, valueAt } from '../engine/ease'
import { animatedPaths, getProp, KEY_EPS, moveKey, toggleStopwatch, withProp, type PropPath } from '../engine/edit'
import type { Keyframe, Layer } from '../engine/types'
import { keyIsSelected, useEditor, type KeyRef } from './state'

const LEFT = 280

const PROP_LABEL: Record<PropPath, string> = {
  'transform.x': 'Vị trí X',
  'transform.y': 'Vị trí Y',
  'transform.scale': 'Tỉ lệ',
  'transform.rotation': 'Xoay',
  'transform.opacity': 'Độ mờ',
  'transform.blur': 'Blur',
  'text.tracking': 'Giãn chữ',
  'shape.width': 'Rộng',
  'shape.height': 'Cao',
  'shape.trimEnd': 'Trim Paths'
}

function allPaths(l: Layer): PropPath[] {
  const base: PropPath[] = ['transform.x', 'transform.y', 'transform.scale', 'transform.rotation', 'transform.opacity', 'transform.blur']
  if (l.type === 'text') base.push('text.tracking')
  if (l.type === 'shape') base.push('shape.width', 'shape.height', 'shape.trimEnd')
  return base
}

const TYPE_ICON: Record<Layer['type'], string> = { text: 'text', shape: 'rect', image: 'image', code: 'code' }

export function LayerTimeline({ fps }: { fps: number }) {
  const scene = useEditor((s) => s.scene)
  const duration = useEditor((s) => s.duration)
  const time = useEditor((s) => s.time)
  const selected = useEditor((s) => s.selected)
  const keys = useEditor((s) => s.keys)
  const expanded = useEditor((s) => s.expanded)
  const onlyAnimated = useEditor((s) => s.onlyAnimated)
  const ed = useEditor.getState
  const scroller = useRef<HTMLDivElement>(null)
  const [avail, setAvail] = useState(600)
  const [zoom, setZoom] = useState(1)
  const [dragOver, setDragOver] = useState<number | null>(null)

  useLayoutEffect(() => {
    const el = scroller.current!
    const ro = new ResizeObserver(() => setAvail(Math.max(200, el.clientWidth - LEFT - 24)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const pps = (avail / Math.max(0.5, duration)) * zoom
  const X = (t: number) => t * pps
  const snapT = (t: number) => Math.round(t * fps) / fps

  const timeFromEvent = (clientX: number) => {
    const el = scroller.current!
    const r = el.getBoundingClientRect()
    return Math.max(0, Math.min(duration, (clientX - r.left - LEFT + el.scrollLeft) / pps))
  }

  const scrub = (e: React.PointerEvent) => {
    ed().setPlaying(false)
    ed().setTime(snapT(timeFromEvent(e.clientX)))
    const move = (ev: PointerEvent) => ed().setTime(snapT(timeFromEvent(ev.clientX)))
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  /** kéo thanh layer: body = dời cả layer + keyframe; mép = trim */
  const dragBar = (e: React.PointerEvent, l: Layer, mode: 'move' | 'in' | 'out') => {
    e.stopPropagation()
    if (l.locked) return
    ed().select(l.id)
    ed().checkpoint()
    const t0 = timeFromEvent(e.clientX)
    const orig = l
    const move = (ev: PointerEvent) => {
      const dt = snapT(timeFromEvent(ev.clientX) - t0)
      ed().editLayer(
        l.id,
        () => {
          if (mode === 'in') return { ...orig, in: Math.max(0, Math.min(orig.out - 1 / fps, orig.in + dt)) }
          if (mode === 'out') return { ...orig, out: Math.max(orig.in + 1 / fps, orig.out + dt) }
          const d = Math.max(-orig.in, dt)
          return shiftLayer(orig, d)
        },
        { history: false }
      )
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  /** bấm/kéo keyframe */
  const dragKey = (e: React.PointerEvent, ref: KeyRef) => {
    e.stopPropagation()
    const s = ed()
    let sel = s.keys
    if (e.shiftKey) {
      sel = keyIsSelected(sel, ref.layerId, ref.path, ref.t) ? sel.filter((k) => !(k.layerId === ref.layerId && k.path === ref.path && Math.abs(k.t - ref.t) < KEY_EPS)) : [...sel, ref]
    } else if (!keyIsSelected(sel, ref.layerId, ref.path, ref.t)) sel = [ref]
    s.selectKeys(sel)
    if (s.selected !== ref.layerId) useEditor.setState({ selected: ref.layerId })
    s.setTime(ref.t)
    const t0 = timeFromEvent(e.clientX)
    const startScene = s.scene
    const startSel = sel
    let moved = false
    const move = (ev: PointerEvent) => {
      const dt = snapT(timeFromEvent(ev.clientX) - t0)
      if (!moved && dt === 0) return
      if (!moved) ed().checkpoint()
      moved = true
      const minT = Math.min(...startSel.map((k) => k.t))
      const d = Math.max(-minT, dt)
      let sc = startScene
      // dời theo thứ tự để không đè lên nhau
      const order = startSel.slice().sort((a, b) => (d > 0 ? b.t - a.t : a.t - b.t))
      for (const k of order) {
        sc = { ...sc, layers: sc.layers.map((l) => (l.id === k.layerId ? withProp(l, k.path, (p) => moveKey(p, k.t, k.t + d)) : l)) }
      }
      ed().edit(() => sc, { history: false })
      useEditor.setState({ keys: startSel.map((k) => ({ ...k, t: k.t + d })), time: ref.t + d })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const step = pps > 300 ? 0.1 : pps > 120 ? 0.25 : pps > 50 ? 0.5 : pps > 20 ? 1 : 2
  const ticks: number[] = []
  for (let t = 0; t <= duration + 1e-6; t += step) ticks.push(Math.round(t * 1000) / 1000)
  const width = X(duration) + 24

  return (
    <div className="layer-timeline">
      <div className="lt-toolbar">
        <span className="tc big">{fmt(time, fps)}</span>
        <span className="muted small">/ {fmt(duration, fps)}</span>
        <div className="spacer" />
        <button className={'tbtn text ' + (onlyAnimated ? 'on' : '')} title="Chỉ hiện thuộc tính có keyframe (U)" onClick={() => ed().setFlag('onlyAnimated', !onlyAnimated)}>
          U · có keyframe
        </button>
        <label className="zoom">
          <Icon name="ellipse" size={10} />
          <input type="range" min={1} max={8} step={0.1} value={zoom} onChange={(e) => setZoom(+e.target.value)} />
          <Icon name="ellipse" size={14} />
        </label>
      </div>
      <div className="lt-scroll" ref={scroller}>
        <div className="lt-content" style={{ width: LEFT + width }}>
          <div className="lt-row ruler-row">
            <div className="lt-left">Layer</div>
            <div className="lt-right ruler" style={{ width }} onPointerDown={scrub}>
              {ticks.map((t) => (
                <div key={t} className="tick" style={{ left: X(t) }}>
                  {+t.toFixed(2)}s
                </div>
              ))}
              <div className="lt-head" style={{ left: X(time) }} />
            </div>
          </div>

          {scene.layers.map((l, i) => {
            const isSel = l.id === selected
            const paths = expanded[l.id] ? (onlyAnimated ? animatedPaths(l) : allPaths(l)) : []
            const allKeys = (onlyAnimated || !expanded[l.id] ? allPaths(l) : []).flatMap((p) => (getProp(l, p)?.keys ?? []).map((k) => ({ ...k, path: p })))
            return (
              <div key={l.id} className={'lt-layer ' + (isSel ? 'selected' : '') + (dragOver === i ? ' drop-target' : '')}>
                <div className="lt-row">
                  <div
                    className="lt-left"
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData('text/laila-layer', l.id)}
                    onDragOver={(e) => {
                      e.preventDefault()
                      setDragOver(i)
                    }}
                    onDragLeave={() => setDragOver(null)}
                    onDrop={(e) => {
                      e.preventDefault()
                      setDragOver(null)
                      const id = e.dataTransfer.getData('text/laila-layer')
                      if (id && id !== l.id) ed().edit((sc) => reorder(sc, id, i))
                    }}
                    onPointerDown={() => ed().select(l.id)}
                  >
                    <button className="twirl" onClick={() => ed().toggleExpanded(l.id)} title="Mở thuộc tính">
                      <Icon name={expanded[l.id] ? 'chevronD' : 'chevronR'} size={11} />
                    </button>
                    <button className="tiny" title="Ẩn/hiện" onClick={() => ed().editLayer(l.id, (x) => ({ ...x, visible: !x.visible }))}>
                      <Icon name={l.visible ? 'eye' : 'eyeOff'} size={13} />
                    </button>
                    <button className="tiny" title="Khoá" onClick={() => ed().editLayer(l.id, (x) => ({ ...x, locked: !x.locked }))}>
                      <Icon name={l.locked ? 'lock' : 'unlock'} size={13} />
                    </button>
                    <span className={'type-dot t-' + l.type}>
                      <Icon name={TYPE_ICON[l.type]} size={12} />
                    </span>
                    <span className="lt-name" title={l.name}>
                      {l.name}
                    </span>
                    {l.parent && <span className="parent-tag" title="Có layer cha">↳</span>}
                  </div>
                  <div className="lt-right" style={{ width }} onPointerDown={scrub}>
                    <div
                      className={'lt-bar t-' + l.type + (l.visible ? '' : ' hidden')}
                      style={{ left: X(l.in), width: Math.max(4, X(l.out) - X(l.in)) }}
                      onPointerDown={(e) => dragBar(e, l, 'move')}
                    >
                      <div className="bar-edge in" onPointerDown={(e) => dragBar(e, l, 'in')} />
                      <span className="bar-name">{l.name}</span>
                      <div className="bar-edge out" onPointerDown={(e) => dragBar(e, l, 'out')} />
                    </div>
                    {allKeys.map((k, j) => (
                      <Diamond key={j} k={k} x={X(k.t)} selected={keyIsSelected(keys, l.id, k.path, k.t)} onPointerDown={(e) => dragKey(e, { layerId: l.id, path: k.path, t: k.t })} />
                    ))}
                  </div>
                </div>
                {paths.map((p) => {
                  const pr = getProp(l, p)!
                  return (
                    <div key={p} className="lt-row prop">
                      <div className="lt-left">
                        <button className={'sw ' + (isAnimated(pr) ? 'on' : '')} title="Stopwatch" onClick={() => ed().editLayer(l.id, (x) => withProp(x, p, (pp) => toggleStopwatch(pp, time)))}>
                          <Icon name="stopwatch" size={12} />
                        </button>
                        <span className="prop-name">{PROP_LABEL[p]}</span>
                        <span className="prop-val">{Math.round(valueAt(pr, time) * 10) / 10}</span>
                      </div>
                      <div className="lt-right" style={{ width }} onPointerDown={scrub}>
                        {pr.wiggle && <div className="wiggle-band" style={{ left: X(l.in), width: X(l.out) - X(l.in) }} />}
                        {(pr.keys ?? []).map((k, j) => (
                          <Diamond key={j} k={k} x={X(k.t)} selected={keyIsSelected(keys, l.id, p, k.t)} onPointerDown={(e) => dragKey(e, { layerId: l.id, path: p, t: k.t })} />
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })}
          <div className="lt-playhead" style={{ left: LEFT + X(time) }} />
        </div>
        {scene.layers.length === 0 && <div className="empty">Chưa có layer. Dùng công cụ Text / Hình ở thanh trên, hoặc nhờ Claude.</div>}
      </div>
    </div>
  )
}

function Diamond({ k, x, selected, onPointerDown }: { k: Keyframe; x: number; selected: boolean; onPointerDown: (e: React.PointerEvent) => void }) {
  // hình dạng keyframe như AE: linear = kim cương, hold = vuông, ease = tròn
  const shape = k.ease === 'linear' ? 'lin' : k.ease === 'hold' ? 'hold' : 'ease'
  return <div className={'kf ' + shape + (selected ? ' sel' : '')} style={{ left: x }} onPointerDown={onPointerDown} title={`${k.t.toFixed(2)}s = ${Math.round(k.v * 10) / 10}`} />
}

function shiftLayer(l: Layer, d: number): Layer {
  const sh = (p: { v: number; keys?: Keyframe[] }) => (p.keys ? { ...p, keys: p.keys.map((k) => ({ ...k, t: k.t + d })) } : p)
  const transform = { ...l.transform }
  for (const k of Object.keys(transform) as (keyof typeof transform)[]) transform[k] = sh(transform[k]) as any
  const out: Layer = { ...l, in: l.in + d, out: l.out + d, transform }
  if (out.type === 'text') out.text = { ...out.text, tracking: sh(out.text.tracking) as any }
  if (out.type === 'shape') out.shape = { ...out.shape, width: sh(out.shape.width) as any, height: sh(out.shape.height) as any, trimEnd: sh(out.shape.trimEnd) as any }
  return out
}

function reorder<T extends { layers: Layer[] }>(sc: T, id: string, toIndex: number): T {
  const from = sc.layers.findIndex((l) => l.id === id)
  if (from < 0) return sc
  const layers = sc.layers.slice()
  const [l] = layers.splice(from, 1)
  layers.splice(toIndex, 0, l)
  return { ...sc, layers }
}

function fmt(t: number, fps: number) {
  const s = Math.floor(t)
  const f = Math.round((t - s) * fps)
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}:${String(Math.min(fps - 1, f)).padStart(2, '0')}`
}
