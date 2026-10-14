// Composition viewer: xem frame hiện tại, chọn/kéo/scale/xoay layer trực tiếp, vẽ text/shape mới.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { valueAt } from '../engine/ease'
import { newShapeLayer, newTextLayer, setPropAt } from '../engine/edit'
import { hitTest, layerCorners, parentSpace, tv } from '../engine/render'
import type { SceneRunner } from '../engine/player'
import type { Layer } from '../engine/types'
import { useEditor } from './state'
import { Icon } from '../components/Icon'
import { hasFiles } from '../lib/importer'

interface Props {
  runner: SceneRunner
  width: number
  height: number
  accent: string
  /** thả ảnh / vector từ Finder vào khung hình (toạ độ composition) */
  onDropFiles?: (files: File[], at: { x: number; y: number }) => void
}

type Drag =
  | { kind: 'move'; id: string; p0: DOMPoint; x0: number; y0: number; inv: DOMMatrix; a0: DOMPoint }
  | { kind: 'scale'; id: string; p0: DOMPoint; s0: number; a0: DOMPoint }
  | { kind: 'rotate'; id: string; p0: DOMPoint; r0: number; a0: DOMPoint }
  | { kind: 'draw'; id: string; p0: DOMPoint; shape: 'rect' | 'ellipse' | 'line' }

export function Viewer({ runner, width: W, height: H, accent, onDropFiles }: Props) {
  const scene = useEditor((s) => s.scene)
  const previewScene = useEditor((s) => s.preview?.scene)
  const time = useEditor((s) => s.time)
  const selected = useEditor((s) => s.selected)
  const tool = useEditor((s) => s.tool)
  const showSafe = useEditor((s) => s.showSafe)
  const showGrid = useEditor((s) => s.showGrid)
  const snapping = useEditor((s) => s.snapping)
  const ed = useEditor.getState

  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [scale, setScale] = useState(0.4)
  const [fileOver, setFileOver] = useState(false)
  const [guides, setGuides] = useState<{ x: number[]; y: number[] }>({ x: [], y: [] })
  const [, force] = useState(0)
  const drag = useRef<Drag | null>(null)
  const drawing = useRef({ busy: false, again: false })

  // vừa khung
  useLayoutEffect(() => {
    const el = wrap.current!
    const fit = () => {
      const r = el.getBoundingClientRect()
      setScale(Math.max(0.05, Math.min((r.width - 32) / W, (r.height - 32) / H)))
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [W, H])

  // vẽ frame (gộp các yêu cầu dồn dập)
  useEffect(() => {
    const ctx = canvas.current!.getContext('2d')!
    const run = async () => {
      if (drawing.current.busy) {
        drawing.current.again = true
        return
      }
      drawing.current.busy = true
      try {
        do {
          drawing.current.again = false
          const s = useEditor.getState()
          const sc = s.preview?.scene ?? s.scene
          await runner.prepare(sc)
          await runner.draw(ctx, sc, s.time)
        } while (drawing.current.again)
      } finally {
        drawing.current.busy = false
        force((n) => n + 1) // cập nhật khung chọn sau khi asset nạp xong
      }
    }
    run()
  }, [scene, previewScene, time, runner])

  const ctx2d = () => canvas.current!.getContext('2d')!
  const assets = runner.assets
  const toComp = (e: { clientX: number; clientY: number }) => {
    const r = canvas.current!.getBoundingClientRect()
    return new DOMPoint(((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H)
  }
  const layerById = (id: string) => scene.layers.find((l) => l.id === id)

  const sel = selected ? layerById(selected) : null
  const box = sel && assets && sel.visible && time >= sel.in && time < sel.out && sel.type !== 'code' ? layerCorners(ctx2d(), scene, sel, time, assets) : null

  const snap = (pt: { x: number; y: number }) => {
    if (!snapping) return { dx: 0, dy: 0, gx: [] as number[], gy: [] as number[] }
    const th = 8 / scale
    const xs = [0, W / 2, W, W * 0.05, W * 0.95]
    const ys = [0, H / 2, H, H * 0.05, H * 0.95]
    let dx = 0,
      dy = 0
    const gx: number[] = [],
      gy: number[] = []
    const bx = xs.find((x) => Math.abs(pt.x - x) < th)
    if (bx !== undefined) {
      dx = bx - pt.x
      gx.push(bx)
    }
    const by = ys.find((y) => Math.abs(pt.y - y) < th)
    if (by !== undefined) {
      dy = by - pt.y
      gy.push(by)
    }
    return { dx, dy, gx, gy }
  }

  const setXY = (l: Layer, x: number, y: number) => ({
    ...l,
    transform: { ...l.transform, x: setPropAt(l.transform.x, time, x), y: setPropAt(l.transform.y, time, y) }
  })

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || !assets) return
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    const p = toComp(e)
    const s = ed()

    if (tool === 'text') {
      const l = newTextLayer(W, H, s.duration, 'Nhập chữ', Object.keys(assets.fonts)[0] ?? '')
      l.transform.x = { v: p.x }
      l.transform.y = { v: p.y }
      l.in = 0
      s.edit((sc) => ({ ...sc, layers: [l, ...sc.layers] }))
      s.select(l.id)
      s.setTool('select')
      requestAnimationFrame(() => requestAnimationFrame(() => window.dispatchEvent(new CustomEvent('laila:focus-text'))))
      return
    }
    if (tool === 'rect' || tool === 'ellipse' || tool === 'line') {
      const l = newShapeLayer(W, H, s.duration, tool, accent)
      l.transform.x = { v: p.x }
      l.transform.y = { v: p.y }
      s.edit((sc) => ({ ...sc, layers: [l, ...sc.layers] }))
      s.select(l.id)
      drag.current = { kind: 'draw', id: l.id, p0: p, shape: tool }
      return
    }

    const handle = (e.target as Element).getAttribute?.('data-handle')
    if (handle && sel && box) {
      s.checkpoint()
      if (handle === 'rotate') drag.current = { kind: 'rotate', id: sel.id, p0: p, r0: valueAt(sel.transform.rotation, time), a0: box.anchor }
      else drag.current = { kind: 'scale', id: sel.id, p0: p, s0: valueAt(sel.transform.scale, time), a0: box.anchor }
      return
    }

    const hit = hitTest(ctx2d(), scene, time, assets, p.x, p.y)
    s.select(hit?.id ?? null)
    if (hit) {
      s.checkpoint()
      const c = layerCorners(ctx2d(), scene, hit, time, assets)
      drag.current = {
        kind: 'move',
        id: hit.id,
        p0: p,
        x0: tv(hit, 'x', time),
        y0: tv(hit, 'y', time),
        inv: parentSpace(scene, hit, time).inverse(),
        a0: c.anchor
      }
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const p = toComp(e)
    const s = ed()
    if (d.kind === 'move') {
      let dxw = p.x - d.p0.x,
        dyw = p.y - d.p0.y
      if (e.shiftKey) Math.abs(dxw) > Math.abs(dyw) ? (dyw = 0) : (dxw = 0)
      const sn = snap({ x: d.a0.x + dxw, y: d.a0.y + dyw })
      dxw += sn.dx
      dyw += sn.dy
      setGuides({ x: sn.gx, y: sn.gy })
      // đổi vector dịch chuyển sang hệ toạ độ của layer cha
      const a = d.inv.transformPoint(new DOMPoint(0, 0))
      const b = d.inv.transformPoint(new DOMPoint(dxw, dyw))
      s.editLayer(d.id, (l) => setXY(l, d.x0 + (b.x - a.x), d.y0 + (b.y - a.y)), { history: false })
    } else if (d.kind === 'scale') {
      const d0 = Math.hypot(d.p0.x - d.a0.x, d.p0.y - d.a0.y) || 1
      const d1 = Math.hypot(p.x - d.a0.x, p.y - d.a0.y)
      const v = Math.round(d.s0 * (d1 / d0) * 10) / 10
      s.editLayer(d.id, (l) => ({ ...l, transform: { ...l.transform, scale: setPropAt(l.transform.scale, time, v) } }), { history: false })
    } else if (d.kind === 'rotate') {
      const ang = (q: DOMPoint) => (Math.atan2(q.y - d.a0.y, q.x - d.a0.x) * 180) / Math.PI
      let v = d.r0 + ang(p) - ang(d.p0)
      if (e.shiftKey) v = Math.round(v / 15) * 15
      v = Math.round(v * 10) / 10
      s.editLayer(d.id, (l) => ({ ...l, transform: { ...l.transform, rotation: setPropAt(l.transform.rotation, time, v) } }), { history: false })
    } else if (d.kind === 'draw') {
      const w = Math.abs(p.x - d.p0.x),
        h = Math.abs(p.y - d.p0.y)
      s.editLayer(
        d.id,
        (l) => {
          if (l.type !== 'shape') return l
          if (d.shape === 'line') {
            return {
              ...l,
              transform: {
                ...l.transform,
                x: { v: (p.x + d.p0.x) / 2 },
                y: { v: (p.y + d.p0.y) / 2 },
                rotation: { v: Math.round((Math.atan2(p.y - d.p0.y, p.x - d.p0.x) * 180) / Math.PI) }
              },
              shape: { ...l.shape, width: { v: Math.max(4, Math.hypot(w, h)) } }
            }
          }
          const side = e.shiftKey ? Math.max(w, h) : 0
          return {
            ...l,
            transform: { ...l.transform, x: { v: (p.x + d.p0.x) / 2 }, y: { v: (p.y + d.p0.y) / 2 } },
            shape: { ...l.shape, width: { v: Math.max(4, side || w) }, height: { v: Math.max(4, side || h) } }
          }
        },
        { history: false }
      )
    }
  }

  const onPointerUp = () => {
    if (drag.current?.kind === 'draw') {
      const id = drag.current.id
      const l = layerById(id)
      // bấm mà không kéo -> giữ kích thước mặc định
      if (l?.type === 'shape' && valueAt(l.shape.width, 0) <= 4 && valueAt(l.shape.height, 0) <= 4) {
        ed().editLayer(id, (x) => (x.type === 'shape' ? { ...x, shape: { ...x.shape, width: { v: Math.min(W, H) * 0.3 }, height: { v: x.shape.kind === 'line' ? 0 : Math.min(W, H) * 0.3 } } } : x), { history: false })
      }
      ed().setTool('select')
    }
    drag.current = null
    setGuides({ x: [], y: [] })
  }

  const onDoubleClick = (e: React.MouseEvent) => {
    if (!assets) return
    const p = toComp(e)
    const hit = hitTest(ctx2d(), scene, time, assets, p.x, p.y)
    if (hit?.type === 'text') {
      ed().select(hit.id)
      window.dispatchEvent(new CustomEvent('laila:focus-text'))
    }
  }

  const hs = 7 / scale // kích thước handle theo pixel màn hình
  const rotHandle =
    box &&
    (() => {
      const [a, b] = box.pts
      const mx = (a.x + b.x) / 2,
        my = (a.y + b.y) / 2
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
      // pháp tuyến hướng ra ngoài cạnh trên
      const nx = (b.y - a.y) / len,
        ny = -(b.x - a.x) / len
      return { x: mx + nx * 28 / scale, y: my + ny * 28 / scale, mx, my }
    })()

  return (
    <div
      className={'viewer' + (fileOver ? ' file-over' : '')}
      ref={wrap}
      onDragOver={(e) => {
        if (!onDropFiles || !hasFiles(e)) return
        e.preventDefault()
        e.stopPropagation()
        e.dataTransfer.dropEffect = 'copy'
        setFileOver(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setFileOver(false)
      }}
      onDrop={(e) => {
        if (!onDropFiles || !hasFiles(e)) return
        e.preventDefault()
        e.stopPropagation()
        setFileOver(false)
        const p = toComp(e)
        onDropFiles([...e.dataTransfer.files], { x: Math.min(W, Math.max(0, p.x)), y: Math.min(H, Math.max(0, p.y)) })
      }}
    >
      <div className="viewer-stage" style={{ width: W * scale, height: H * scale }}>
        <canvas ref={canvas} width={W} height={H} className={scene.background ? '' : 'checker'} />
        <svg
          className={'viewer-overlay tool-' + tool}
          viewBox={`0 0 ${W} ${H}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onDoubleClick={onDoubleClick}
        >
          {showGrid &&
            [1, 2].map((i) => (
              <g key={i} className="guide-grid">
                <line x1={(W * i) / 3} y1={0} x2={(W * i) / 3} y2={H} />
                <line x1={0} y1={(H * i) / 3} x2={W} y2={(H * i) / 3} />
              </g>
            ))}
          {showSafe && (
            <g className="guide-safe">
              <rect x={W * 0.05} y={H * 0.05} width={W * 0.9} height={H * 0.9} />
              <rect x={W * 0.1} y={H * 0.1} width={W * 0.8} height={H * 0.8} />
              <line x1={W / 2 - 20 / scale} y1={H / 2} x2={W / 2 + 20 / scale} y2={H / 2} />
              <line x1={W / 2} y1={H / 2 - 20 / scale} x2={W / 2} y2={H / 2 + 20 / scale} />
            </g>
          )}
          {guides.x.map((x) => (
            <line key={'gx' + x} className="snap-guide" x1={x} y1={0} x2={x} y2={H} />
          ))}
          {guides.y.map((y) => (
            <line key={'gy' + y} className="snap-guide" x1={0} y1={y} x2={W} y2={y} />
          ))}
          {box && (
            <g className="sel" style={{ strokeWidth: 1.5 / scale }}>
              <polygon points={box.pts.map((p) => `${p.x},${p.y}`).join(' ')} />
              {rotHandle && <line x1={rotHandle.mx} y1={rotHandle.my} x2={rotHandle.x} y2={rotHandle.y} />}
              {rotHandle && <circle data-handle="rotate" className="handle rot" cx={rotHandle.x} cy={rotHandle.y} r={hs} />}
              {box.pts.map((p, i) => (
                <rect key={i} data-handle="scale" className="handle" x={p.x - hs} y={p.y - hs} width={hs * 2} height={hs * 2} />
              ))}
              <g className="anchor-mark">
                <circle cx={box.anchor.x} cy={box.anchor.y} r={hs * 0.9} />
                <line x1={box.anchor.x - hs * 1.6} y1={box.anchor.y} x2={box.anchor.x + hs * 1.6} y2={box.anchor.y} />
                <line x1={box.anchor.x} y1={box.anchor.y - hs * 1.6} x2={box.anchor.x} y2={box.anchor.y + hs * 1.6} />
              </g>
            </g>
          )}
        </svg>
      </div>
      <div className="viewer-bar">
        <span className="muted">{Math.round(scale * 100)}%</span>
        <span className="muted">
          {W}×{H}
        </span>
        <div className="spacer" />
        <button className={'tbtn ' + (showGrid ? 'on' : '')} title="Lưới 1/3" onClick={() => ed().setFlag('showGrid', !showGrid)}>
          <Icon name="grid" />
        </button>
        <button className={'tbtn ' + (showSafe ? 'on' : '')} title="Vùng an toàn (Title/Action safe)" onClick={() => ed().setFlag('showSafe', !showSafe)}>
          <Icon name="safe" />
        </button>
        <button className={'tbtn ' + (snapping ? 'on' : '')} title="Hít vào tâm/mép (Snapping)" onClick={() => ed().setFlag('snapping', !snapping)}>
          <Icon name="magnet" />
        </button>
      </div>
    </div>
  )
}
