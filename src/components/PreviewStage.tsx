// Tương tác trực tiếp trên khung xem: vẽ clip chữ/hình, chọn – kéo – phóng to lớp phủ, thả element vào đúng chỗ.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { MediaItem, TrackClip } from '../../shared/types'
import { SceneRunner } from '../engine/player'
import { layerCorners } from '../engine/render'
import type { Layer } from '../engine/types'
import { graphicScene } from '../lib/graphics'
import { brandImagePath, hasFiles, importDropped, importPaths, reportErrors } from '../lib/importer'
import { useStore } from '../lib/store'
import { tLength } from '../lib/timeline'
import { useUi } from '../lib/ui'
import { addGraphicFromDrag, DRAG_GRAPHIC, type GraphicDrag } from './TextPanel'

export const DRAG_ELEMENT = 'text/laila-element'

/** Runner dùng chung để vẽ clip chữ/hình (đổi khi đổi khung hình hoặc brand kit) */
export function useGraphicsRunner() {
  const settings = useStore((s) => s.project.settings)
  const elements = useStore((s) => s.project.elements)
  const runner = useMemo(() => new SceneRunner(settings, elements), [settings, elements])
  useEffect(() => () => runner.dispose(), [runner])
  return runner
}

/** Vẽ clip chữ/hình lên canvas tại thời điểm timeline `t` */
export function drawGraphic(runner: SceneRunner, canvas: HTMLCanvasElement, c: TrackClip, t: number, W: number, H: number) {
  if (canvas.width !== W || canvas.height !== H) {
    canvas.width = W
    canvas.height = H
  }
  const ctx = canvas.getContext('2d')!
  const scene = graphicScene(c.graphic!, c.out, H)
  const local = Math.max(0, t - c.start) + c.in
  if (runner.assets) runner.draw(ctx, scene, local)
  else runner.prepare(scene).then(() => runner.draw(ctx, scene, local))
}

interface Box {
  clip: TrackClip
  trackId: string
  x: number
  y: number
  w: number
  h: number
  cx: number
  cy: number
  graphic: boolean
}

let measureCtx: CanvasRenderingContext2D | null = null

/** Hộp bao (toạ độ khung hình) của clip phủ đang hiện */
function boxOf(c: TrackClip, trackId: string, media: MediaItem | undefined, t: number, W: number, H: number, runner: SceneRunner): Box | null {
  if (c.graphic) {
    if (!runner.assets) return null
    measureCtx ??= document.createElement('canvas').getContext('2d')
    const scene = graphicScene(c.graphic, c.out, H)
    const l = scene.layers[0] as Layer
    const { pts } = layerCorners(measureCtx!, scene, l, Math.min(l.out - 0.001, Math.max(0, t - c.start) + c.in), runner.assets)
    const xs = pts.map((p) => p.x),
      ys = pts.map((p) => p.y)
    const x = Math.min(...xs),
      y = Math.min(...ys)
    const w = Math.max(...xs) - x,
      h = Math.max(...ys) - y
    return { clip: c, trackId, x, y, w, h, cx: l.transform.x.v, cy: l.transform.y.v, graphic: true }
  }
  if (!media) return null
  // giống preview / xuất: vừa khung (contain), phóng theo tỉ lệ, lệch x/y từ tâm
  const ar = media.width && media.height ? media.width / media.height : W / H
  let fw = W,
    fh = W / ar
  if (fh > H) {
    fh = H
    fw = H * ar
  }
  const sc = (c.scale ?? 100) / 100
  const w = fw * sc,
    h = fh * sc
  const cx = W / 2 + (c.x ?? 0),
    cy = H / 2 + (c.y ?? 0)
  return { clip: c, trackId, x: cx - w / 2, y: cy - h / 2, w, h, cx, cy, graphic: false }
}

/** Lớp tương tác phủ lên khung xem */
export function Stage({ runner, tick }: { runner: SceneRunner; tick: number }) {
  const project = useStore((s) => s.project)
  const playhead = useStore((s) => s.playhead)
  const playing = useStore((s) => s.playing)
  const selectedId = useStore((s) => s.selectedClipId)
  const ref = useRef<HTMLDivElement>(null)
  const [guides, setGuides] = useState<{ v: boolean; h: boolean }>({ v: false, h: false })
  const { width: W, height: H } = project.settings
  void tick

  const boxes: Box[] = []
  for (const tr of project.tracks ?? []) {
    if (tr.kind !== 'video' || tr.hidden) continue
    for (const c of tr.clips) {
      if (playhead < c.start - 1e-6 || playhead >= c.start + tLength(c)) continue
      const b = boxOf(c, tr.id, project.media.find((m) => m.id === c.mediaId), playhead, W, H, runner)
      if (b) boxes.push(b)
    }
  }
  // clip được chọn vẽ sau cùng (nằm trên) để luôn bấm được
  boxes.sort((a, b) => Number(a.clip.id === selectedId) - Number(b.clip.id === selectedId))

  const toComp = (e: { clientX: number; clientY: number }) => {
    const r = ref.current!.getBoundingClientRect()
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H }
  }

  const st = useStore.getState
  const moveTo = (b: Box, cx: number, cy: number) => {
    if (b.graphic)
      st().updateGraphic(
        b.clip.id,
        (g) => {
          const l = g.layer as unknown as Layer
          return { ...g, layer: { ...l, transform: { ...l.transform, x: { v: Math.round(cx) }, y: { v: Math.round(cy) } } } as unknown as Record<string, unknown> }
        },
        false
      )
    else st().setTrackClip(b.clip.id, { x: Math.round(cx - W / 2), y: Math.round(cy - H / 2) }, false)
  }
  const scaleTo = (b: Box, k: number) => {
    if (b.graphic)
      st().updateGraphic(
        b.clip.id,
        (g) => {
          const l = g.layer as unknown as Layer
          return { ...g, layer: { ...l, transform: { ...l.transform, scale: { v: Math.max(5, Math.round(k)) } } } as unknown as Record<string, unknown> }
        },
        false
      )
    else st().setTrackClip(b.clip.id, { scale: Math.max(5, Math.round(k)) }, false)
  }

  const drag = (e: React.PointerEvent, b: Box, mode: 'move' | 'scale') => {
    e.stopPropagation()
    e.preventDefault()
    st().select(b.clip.id)
    const p0 = toComp(e)
    const s0 = b.graphic ? (b.clip.graphic!.layer as unknown as Layer).transform.scale.v : b.clip.scale ?? 100
    const d0 = Math.hypot(p0.x - b.cx, p0.y - b.cy) || 1
    let started = false
    const snapPx = 10 * (W / (ref.current?.getBoundingClientRect().width || W))
    const move = (ev: PointerEvent) => {
      const p = toComp(ev)
      if (!started) {
        if (Math.hypot(p.x - p0.x, p.y - p0.y) < 2) return
        st().beginTrim()
        started = true
      }
      if (mode === 'move') {
        let cx = b.cx + p.x - p0.x
        let cy = b.cy + p.y - p0.y
        // hít vào đường giữa khung
        const v = Math.abs(cx - W / 2) < snapPx
        const h = Math.abs(cy - H / 2) < snapPx
        if (v) cx = W / 2
        if (h) cy = H / 2
        setGuides({ v, h })
        moveTo(b, cx, cy)
      } else scaleTo(b, (s0 * Math.hypot(p.x - b.cx, p.y - b.cy)) / d0)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setGuides({ v: false, h: false })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const pct = (v: number, of: number) => `${(v / of) * 100}%`
  return (
    <div ref={ref} className={'stage' + (playing ? ' playing' : '')}>
      {guides.v && <div className="guide v" />}
      {guides.h && <div className="guide h" />}
      {!playing &&
        boxes.map((b) => (
          <div
            key={b.clip.id}
            className={'stage-box' + (b.clip.id === selectedId ? ' selected' : '') + (b.graphic ? ' graphic' : '')}
            style={{ left: pct(b.x, W), top: pct(b.y, H), width: pct(b.w, W), height: pct(b.h, H) }}
            onPointerDown={(e) => drag(e, b, 'move')}
            onDoubleClick={() => {
              if (!b.graphic) return
              useUi.getState().setLeftTab('text')
              setTimeout(() => (document.querySelector('.graphic-insp .text-content') as HTMLTextAreaElement | null)?.focus(), 50)
            }}
            title={b.graphic ? 'Kéo để di chuyển · nhấp đúp để sửa chữ' : 'Kéo để di chuyển'}
          >
            {b.clip.id === selectedId && <div className="stage-handle" onPointerDown={(e) => drag(e, b, 'scale')} title="Kéo để phóng to / thu nhỏ" />}
          </div>
        ))}
    </div>
  )
}

/** Thả element / media / file / mẫu chữ lên khung xem: đặt đúng vị trí, tại playhead */
export function useScreenDrop(screen: React.RefObject<HTMLDivElement | null>) {
  const [over, setOver] = useState(false)
  const accepts = (e: React.DragEvent) => {
    const t = [...e.dataTransfer.types]
    return hasFiles(e) || t.includes(DRAG_GRAPHIC) || t.includes(DRAG_ELEMENT) || t.includes('text/laila-media')
  }
  const at = (e: React.DragEvent) => {
    const { width: W, height: H } = useStore.getState().project.settings
    const r = screen.current!.getBoundingClientRect()
    return {
      x: Math.round(Math.min(W, Math.max(0, ((e.clientX - r.left) / r.width) * W))),
      y: Math.round(Math.min(H, Math.max(0, ((e.clientY - r.top) / r.height) * H)))
    }
  }
  const placeMedia = (m: MediaItem, pos: { x: number; y: number }) => {
    const st = useStore.getState()
    if (m.kind === 'audio') st.addToTrack(m.id, st.playhead)
    else st.addOverlayAt(m.id, st.playhead, pos)
  }
  const onDrop = async (e: React.DragEvent) => {
    if (!accepts(e)) return
    e.preventDefault()
    e.stopPropagation()
    setOver(false)
    const pos = at(e)
    const st = useStore.getState()
    const gd = e.dataTransfer.getData(DRAG_GRAPHIC)
    const mid = e.dataTransfer.getData('text/laila-media')
    const eid = e.dataTransfer.getData(DRAG_ELEMENT)
    try {
      if (gd) {
        addGraphicFromDrag(JSON.parse(gd) as GraphicDrag, pos)
        useUi.getState().setLeftTab('text')
      } else if (mid) {
        const m = st.project.media.find((x) => x.id === mid)
        if (m) placeMedia(m, pos)
      } else if (eid) {
        const el = st.project.elements.find((x) => x.id === eid)
        if (!el) return
        if (el.kind === 'text' || el.kind === 'note') {
          addGraphicFromDrag({ kind: 'text', id: 'title', content: el.value }, pos)
          useUi.getState().setLeftTab('text')
        } else if (el.kind === 'color') addGraphicFromDrag({ kind: 'shape', id: 'rect', color: el.value }, pos)
        else if (el.kind === 'image' && el.value) {
          const path = await brandImagePath(el.value)
          const known = st.project.media.find((m) => m.path === path && m.kind === 'image')
          const m = known ?? (await importPaths([path])).items[0]
          if (m) placeMedia(m, pos)
        }
      } else if (hasFiles(e)) {
        const { items } = await importDropped([...e.dataTransfer.files])
        items.forEach((m, i) => placeMedia(m, { x: pos.x + i * 24, y: pos.y + i * 24 }))
      }
    } catch (err) {
      reportErrors([(err as Error).message])
    }
  }
  return {
    over,
    props: {
      onDragOver: (e: React.DragEvent) => {
        if (!accepts(e)) return
        e.preventDefault()
        e.stopPropagation()
        e.dataTransfer.dropEffect = 'copy'
        setOver(true)
      },
      onDragLeave: (e: React.DragEvent) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false)
      },
      onDrop
    }
  }
}
