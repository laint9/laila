import { useEffect, useRef, useState } from 'react'
import type { MediaItem, TimelineClip, Track, TrackClip } from '../../shared/types'
import { findTrackClip, useStore } from '../lib/store'
import { fmtTime, mediaUrl } from '../lib/media'
import {
  clipLength,
  clipStarts,
  projectDuration,
  snapPoints,
  speedOf,
  tEnd,
  tLength,
  tSpeed,
  totalDuration,
  transitionAfter
} from '../lib/timeline'
import { TRANSITIONS, transitionStyles } from '../lib/transitions'
import { useLoopProgress } from '../lib/ticker'
import { Icon } from './Icon'
import { hasFiles, importDropped } from '../lib/importer'

const HEAD_W = 132 // cột tên track
const PAD = 12 // lề trái trong lane
const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4]

// ---------- ảnh nền clip (filmstrip / sóng âm), cache theo đường dẫn ----------
const thumbCache = new Map<string, string | null>()
function useClipThumb(m: MediaItem | undefined) {
  const key = m ? (m.kind === 'audio' ? 'w:' : 'f:') + m.path : ''
  const [url, setUrl] = useState<string | null>(thumbCache.get(key) ?? null)
  useEffect(() => {
    if (!m) return
    // ảnh tĩnh: lặp lại chính ảnh đó dọc theo clip
    if (m.kind === 'image') return setUrl(mediaUrl(m.path))
    if (thumbCache.has(key)) return setUrl(thumbCache.get(key)!)
    let alive = true
    const job = m.kind === 'audio' ? window.laila.media.waveform(m.path) : window.laila.media.filmstrip(m.path, m.duration)
    job.then((p) => {
      const u = p ? mediaUrl(p) : null
      thumbCache.set(key, u)
      if (alive) setUrl(u)
    })
    return () => {
      alive = false
    }
  }, [key])
  return url
}

const stripStyle = (m: MediaItem | undefined, url: string, full: number, offset: number): React.CSSProperties =>
  m?.kind === 'image'
    ? { backgroundImage: `url("${url}")`, backgroundSize: 'auto 100%', backgroundRepeat: 'repeat-x', backgroundPosition: '0 0' }
    : { backgroundImage: `url("${url}")`, backgroundSize: `${full}px 100%`, backgroundPosition: `${-offset}px 0` }

export function Timeline() {
  const project = useStore((s) => s.project)
  const playhead = useStore((s) => s.playhead)
  const playing = useStore((s) => s.playing)
  const zoom = useStore((s) => s.zoom)
  const selectedId = useStore((s) => s.selectedClipId)
  const s = useStore.getState
  const scroller = useRef<HTMLDivElement>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const [dropTrack, setDropTrack] = useState<string | null>(null)
  const [transFor, setTransFor] = useState<string | null>(null)

  const clips = project.timeline
  const tracks = project.tracks ?? []
  const videoTracks = tracks.filter((t) => t.kind === 'video')
  const audioTracks = tracks.filter((t) => t.kind === 'audio')
  const starts = clipStarts(clips)
  const mainTotal = totalDuration(clips)
  const total = projectDuration(project)
  const width = Math.max(total + 10, 30) * zoom + PAD * 2
  const selMain = clips.find((c) => c.id === selectedId)
  const selTrack = findTrackClip(project, selectedId)
  const mediaOf = (id: string) => project.media.find((m) => m.id === id)

  useEffect(() => {
    const el = scroller.current
    if (!el || !playing) return
    const x = PAD + playhead * zoom
    const view = el.clientWidth - HEAD_W
    if (x > el.scrollLeft + view - 60 || x < el.scrollLeft) el.scrollLeft = Math.max(0, x - 80)
  }, [playhead, playing, zoom])

  useEffect(() => {
    const el = scroller.current!
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      s().setZoom(s().zoom * (e.deltaY < 0 ? 1.1 : 0.9))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const timeAt = (clientX: number) => {
    const el = scroller.current!
    const x = clientX - el.getBoundingClientRect().left + el.scrollLeft - HEAD_W - PAD
    return Math.max(0, x / zoom)
  }
  /** điểm hít: playhead, mép clip chính, mép clip track */
  const snapList = (ignoreId?: string) => [
    s().playhead,
    ...snapPoints(clips),
    ...tracks.flatMap((t) => t.clips.filter((c) => c.id !== ignoreId).flatMap((c) => [c.start, tEnd(c)]))
  ]
  const snapTime = (t: number, ignoreId?: string) => {
    const th = 8 / zoom
    let best = t,
      bd = th
    for (const p of snapList(ignoreId)) if (Math.abs(p - t) < bd) (best = p), (bd = Math.abs(p - t))
    return best
  }

  const scrubStart = (e: React.MouseEvent) => {
    s().setPlaying(false)
    s().setPlayhead(snapTime(timeAt(e.clientX)))
    const move = (ev: MouseEvent) => s().setPlayhead(snapTime(timeAt(ev.clientX)))
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const drag = (onMove: (ev: MouseEvent) => void) => {
    const up = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', up)
  }

  // ----- track chính -----
  const trimMain = (e: React.MouseEvent, c: TimelineClip, edge: 'in' | 'out') => {
    e.stopPropagation()
    e.preventDefault()
    const x0 = e.clientX
    const v0 = edge === 'in' ? c.in : c.out
    s().beginTrim()
    s().select(c.id)
    drag((ev) => s().trim(c.id, edge, v0 + ((ev.clientX - x0) / zoom) * speedOf(c)))
  }
  const indexAt = (clientX: number) => {
    const t = timeAt(clientX)
    for (let i = 0; i < clips.length; i++) if (t < starts[i] + clipLength(clips[i]) / 2) return i
    return clips.length
  }
  // kéo file từ Finder thẳng vào timeline: nhập vào Media rồi đặt đúng chỗ thả
  const dropFiles = (e: React.DragEvent, place: (m: MediaItem, i: number, t: number) => number) => {
    if (!hasFiles(e)) return false
    e.preventDefault()
    e.stopPropagation()
    let t = snapTime(timeAt(e.clientX))
    importDropped([...e.dataTransfer.files]).then(({ items }) => items.forEach((m, i) => (t = place(m, i, t))))
    return true
  }
  const toTrackAt = (m: MediaItem, t: number, trackId?: string) => {
    s().addToTrack(m.id, t, trackId)
    return t + m.duration
  }

  const onDropMain = (e: React.DragEvent) => {
    e.preventDefault()
    const idx = indexAt(e.clientX)
    setDropIndex(null)
    if (dropFiles(e, (m, i, t) => (m.kind === 'audio' || m.alpha ? toTrackAt(m, t) : (s().appendToTimeline(m.id, idx + i), t)))) return
    const mediaId = e.dataTransfer.getData('text/laila-media')
    const clipId = e.dataTransfer.getData('text/laila-clip')
    if (mediaId) {
      const m = mediaOf(mediaId)
      if (m?.kind === 'audio') s().addToTrack(mediaId, snapTime(timeAt(e.clientX)))
      else s().appendToTimeline(mediaId, idx)
    } else if (clipId) s().move(clipId, idx)
  }

  // ----- track phụ -----
  const moveTrackClipStart = (e: React.MouseEvent, c: TrackClip, track: Track) => {
    e.stopPropagation()
    if (e.button !== 0) return
    s().select(c.id)
    const t0 = timeAt(e.clientX)
    const start0 = c.start
    const len = tLength(c)
    let moved = false
    drag((ev) => {
      const dt = timeAt(ev.clientX) - t0
      if (!moved && Math.abs(dt * zoom) < 3) return
      if (!moved) s().beginTrim()
      moved = true
      // hít mép trái hoặc mép phải
      let ns = start0 + dt
      const a = snapTime(ns, c.id)
      const b = snapTime(ns + len, c.id) - len
      ns = Math.abs(a - ns) <= Math.abs(b - ns) ? a : b
      // kéo lên/xuống sang track cùng loại
      const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-track]') as HTMLElement | null
      const tid = el?.dataset.track
      const target = tid && tid !== track.id && tracks.find((t) => t.id === tid && t.kind === track.kind) ? tid : undefined
      if (!s().moveTrackClip(c.id, ns, target)) s().moveTrackClip(c.id, ns)
    })
  }
  const trimTrackStart = (e: React.MouseEvent, c: TrackClip, edge: 'in' | 'out') => {
    e.stopPropagation()
    e.preventDefault()
    const x0 = e.clientX
    const v0 = edge === 'in' ? c.in : c.out
    s().beginTrim()
    s().select(c.id)
    drag((ev) => s().trimTrack(c.id, edge, v0 + ((ev.clientX - x0) / zoom) * tSpeed(c)))
  }
  const onDropTrack = (e: React.DragEvent, track: Track) => {
    e.preventDefault()
    setDropTrack(null)
    if (dropFiles(e, (m, _i, t) => toTrackAt(m, t, (m.kind === 'audio' ? 'audio' : 'video') === track.kind ? track.id : undefined))) return
    const mediaId = e.dataTransfer.getData('text/laila-media')
    const m = mediaId && mediaOf(mediaId)
    if (!m) return
    const kind = m.kind === 'audio' ? 'audio' : 'video'
    s().addToTrack(mediaId, snapTime(timeAt(e.clientX)), kind === track.kind ? track.id : undefined)
  }

  const step = zoom >= 120 ? 0.5 : zoom >= 50 ? 1 : zoom >= 20 ? 5 : 10
  const ticks: number[] = []
  for (let t = 0; t <= width / zoom; t += step) ticks.push(t)
  const transClip = clips.find((c) => c.id === transFor)
  const sel = selMain ?? selTrack?.clip
  const selIsOverlay = selTrack?.track.kind === 'video'

  const setSel = (patch: Partial<TimelineClip & TrackClip>, history = true) => {
    if (selMain) s().setClip(selMain.id, patch, history)
    else if (selTrack) s().setTrackClip(selTrack.clip.id, patch, history)
  }

  const trackRow = (t: Track) => (
    <div key={t.id} className={'tl-row track-row kind-' + t.kind + (t.hidden || t.muted ? ' dim' : '')}>
      <div className="tl-head">
        <Icon name={t.kind === 'video' ? 'film' : 'music'} size={12} />
        <input className="track-name" value={t.name} onChange={(e) => s().updateTrack(t.id, { name: e.target.value }, false)} />
        {t.kind === 'video' ? (
          <button className="tiny" title={t.hidden ? 'Hiện track' : 'Ẩn track'} onClick={() => s().updateTrack(t.id, { hidden: !t.hidden })}>
            <Icon name={t.hidden ? 'eyeOff' : 'eye'} size={13} />
          </button>
        ) : (
          <button className="tiny" title={t.muted ? 'Bật tiếng' : 'Tắt tiếng'} onClick={() => s().updateTrack(t.id, { muted: !t.muted })}>
            <Icon name="wave" size={13} className={t.muted ? 'muted-icon' : ''} />
          </button>
        )}
        <button className="tiny" title="Xoá track" onClick={() => s().removeTrack(t.id)}>
          <Icon name="close" size={11} />
        </button>
      </div>
      <div
        className={'tl-lane' + (dropTrack === t.id ? ' drop-target' : '')}
        data-track={t.id}
        style={{ width }}
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) {
            s().select(null)
            scrubStart(e)
          }
        }}
        onDragOver={(e) => {
          e.preventDefault()
          setDropTrack(t.id)
        }}
        onDragLeave={() => setDropTrack(null)}
        onDrop={(e) => onDropTrack(e, t)}
      >
        {t.clips.map((c) => (
          <TrackClipBlock
            key={c.id}
            clip={c}
            media={mediaOf(c.mediaId)}
            left={PAD + c.start * zoom}
            width={Math.max(4, tLength(c) * zoom)}
            zoom={zoom}
            selected={c.id === selectedId}
            onMouseDown={(e) => moveTrackClipStart(e, c, t)}
            onTrim={(e, edge) => trimTrackStart(e, c, edge)}
          />
        ))}
        {t.clips.length === 0 && <div className="track-empty">Kéo {t.kind === 'video' ? 'clip (nên dùng scene nền trong suốt)' : 'âm thanh'} từ Media vào đây</div>}
      </div>
    </div>
  )

  return (
    <div className="timeline">
      <div className="tl-toolbar">
        <div className="btn-group">
          <button className="tbtn" title="Hoàn tác (⌘Z)" onClick={() => s().undo()}>
            <Icon name="undo" />
          </button>
          <button className="tbtn" title="Làm lại (⇧⌘Z)" onClick={() => s().redo()}>
            <Icon name="redo" />
          </button>
        </div>
        <div className="divider" />
        <button className="tbtn labeled" title="Tách clip tại playhead (S / ⌘B)" onClick={() => s().splitAtPlayhead()} disabled={!clips.length && !selTrack}>
          <Icon name="scissors" /> Tách
        </button>
        <button className="tbtn labeled" title="Xoá phần bên trái playhead (Q)" onClick={() => s().trimLeft()} disabled={!clips.length && !selTrack}>
          ⟦ Cắt trái
        </button>
        <button className="tbtn labeled" title="Xoá phần bên phải playhead (W)" onClick={() => s().trimRight()} disabled={!clips.length && !selTrack}>
          Cắt phải ⟧
        </button>
        <button className="tbtn" title="Nhân bản (⌘D)" onClick={() => s().duplicateSelected()} disabled={!sel}>
          <Icon name="copy" />
        </button>
        <button className="tbtn" title="Xoá clip (Delete)" onClick={() => s().deleteSelected()} disabled={!sel}>
          <Icon name="trash" />
        </button>
        <div className="divider" />
        <button className="tbtn labeled" title="Thêm track video phủ (lớp trên)" onClick={() => s().addTrack('video')}>
          <Icon name="plus" size={12} /> Track phủ
        </button>
        <button className="tbtn labeled" title="Thêm track âm thanh" onClick={() => s().addTrack('audio')}>
          <Icon name="plus" size={12} /> Track âm thanh
        </button>

        {sel && (
          <>
            <div className="divider" />
            <label className="clip-prop" title="Tốc độ">
              <Icon name="speed" />
              <select value={selMain ? speedOf(selMain) : tSpeed(selTrack!.clip)} onChange={(e) => setSel({ speed: +e.target.value })}>
                {SPEEDS.map((v) => (
                  <option key={v} value={v}>
                    {v}×
                  </option>
                ))}
              </select>
            </label>
            <label className="clip-prop" title="Âm lượng">
              <Icon name="wave" />
              <input type="range" min={0} max={2} step={0.05} value={sel.volume} onChange={(e) => setSel({ volume: +e.target.value }, false)} />
              <span className="small muted">{Math.round(sel.volume * 100)}%</span>
            </label>
            <label className="clip-prop" title="Fade âm thanh vào / ra (giây)">
              Fade
              <input type="number" min={0} max={5} step={0.1} value={sel.audioFadeIn ?? 0} onChange={(e) => setSel({ audioFadeIn: Math.max(0, +e.target.value) })} />
              /
              <input type="number" min={0} max={5} step={0.1} value={sel.audioFadeOut ?? 0} onChange={(e) => setSel({ audioFadeOut: Math.max(0, +e.target.value) })} />
            </label>
            {selIsOverlay && selTrack && (
              <>
                <label className="clip-prop" title="Độ mờ lớp phủ">
                  Mờ
                  <input type="number" min={0} max={100} step={5} value={selTrack.clip.opacity ?? 100} onChange={(e) => setSel({ opacity: Math.min(100, Math.max(0, +e.target.value)) })} />
                </label>
                <label className="clip-prop" title="Tỉ lệ lớp phủ (%)">
                  Tỉ lệ
                  <input type="number" min={5} max={400} step={5} value={selTrack.clip.scale ?? 100} onChange={(e) => setSel({ scale: Math.max(5, +e.target.value) })} />
                </label>
                <label className="clip-prop" title="Lệch ngang / dọc so với tâm (px)">
                  X
                  <input type="number" step={10} value={selTrack.clip.x ?? 0} onChange={(e) => setSel({ x: +e.target.value })} />
                  Y
                  <input type="number" step={10} value={selTrack.clip.y ?? 0} onChange={(e) => setSel({ y: +e.target.value })} />
                </label>
              </>
            )}
          </>
        )}
        <div className="spacer" />
        <span className="tc">
          {fmtTime(playhead)} / {fmtTime(total)}
        </span>
        <button className="tbtn labeled" title="Vừa khung" disabled={!total} onClick={() => scroller.current && s().setZoom((scroller.current.clientWidth - HEAD_W - 60) / Math.max(1, total))}>
          Vừa khung
        </button>
        <label className="zoom" title="Zoom timeline (⌘ + cuộn)">
          <Icon name="ellipse" size={10} />
          <input type="range" min={10} max={400} value={zoom} onChange={(e) => s().setZoom(+e.target.value)} />
          <Icon name="ellipse" size={14} />
        </label>
      </div>

      <div className="tl-scroll" ref={scroller}>
        <div className="tl-inner" style={{ width: HEAD_W + width }}>
          <div className="tl-row tl-ruler-row">
            <div className="tl-head corner" />
            <div className="ruler" style={{ width }} onMouseDown={scrubStart}>
              {ticks.map((t) => (
                <div key={t} className="tick" style={{ left: PAD + t * zoom }}>
                  {Number.isInteger(t) ? fmtTime(t).replace(/\.0$/, '') : ''}
                </div>
              ))}
            </div>
          </div>

          {videoTracks.map(trackRow)}

          <div className="tl-row main-row">
            <div className="tl-head main">
              <Icon name="film" size={12} /> Chính
            </div>
            <div
              className="tl-lane main-lane"
              style={{ width }}
              onMouseDown={(e) => {
                if (e.target === e.currentTarget) {
                  s().select(null)
                  scrubStart(e)
                }
              }}
              onDragOver={(e) => {
                e.preventDefault()
                setDropIndex(indexAt(e.clientX))
              }}
              onDragLeave={() => setDropIndex(null)}
              onDrop={onDropMain}
            >
              {clips.map((c, i) => {
                const cutIn = i > 0 ? transitionAfter(clips, i - 1) / 2 : 0
                const cutOut = transitionAfter(clips, i) / 2
                return (
                  <ClipBlock
                    key={c.id}
                    clip={c}
                    media={mediaOf(c.mediaId)}
                    left={PAD + (starts[i] + cutIn) * zoom}
                    width={Math.max(4, (clipLength(c) - cutIn - cutOut) * zoom)}
                    zoom={zoom}
                    localOffset={cutIn}
                    selected={c.id === selectedId}
                    onSelect={() => s().select(c.id)}
                    onTrim={(e, edge) => trimMain(e, c, edge)}
                    onJump={() => s().setPlayhead(starts[i])}
                  />
                )
              })}
              {clips.slice(0, -1).map((c, i) => {
                const td = transitionAfter(clips, i)
                const x = PAD + (starts[i + 1] + td / 2) * zoom
                const has = c.transition && c.transition !== 'none'
                return (
                  <button
                    key={'tr' + c.id}
                    className={'trans-btn ' + (has ? 'on' : '')}
                    style={{ left: x }}
                    title={has ? `Chuyển cảnh: ${TRANSITIONS.find((t) => t.id === c.transition)?.label}` : 'Thêm chuyển cảnh'}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={() => setTransFor(transFor === c.id ? null : c.id)}
                  >
                    <Icon name="transition" size={12} />
                  </button>
                )
              })}
              {dropIndex !== null && <div className="drop-marker" style={{ left: PAD + (dropIndex < clips.length ? starts[dropIndex] : mainTotal) * zoom }} />}
              {clips.length === 0 && <div className="track-empty">Kéo clip từ Media hoặc bấm “Đưa lên timeline”</div>}
            </div>
          </div>

          {audioTracks.map(trackRow)}
          {audioTracks.length === 0 && (
            <div className="tl-row add-row">
              <div className="tl-head" />
              <div
                className={'tl-lane add-lane' + (dropTrack === 'new-audio' ? ' drop-target' : '')}
                style={{ width }}
                onDragOver={(e) => {
                  e.preventDefault()
                  setDropTrack('new-audio')
                }}
                onDragLeave={() => setDropTrack(null)}
                onDrop={(e) => {
                  e.preventDefault()
                  setDropTrack(null)
                  if (dropFiles(e, (m, _i, t) => toTrackAt(m, t))) return
                  const id = e.dataTransfer.getData('text/laila-media')
                  if (mediaOf(id)) s().addToTrack(id, snapTime(timeAt(e.clientX)))
                }}
              >
                <div className="track-empty">
                  <Icon name="music" size={12} /> Kéo nhạc / hiệu ứng âm thanh vào đây để tạo track âm thanh
                </div>
              </div>
            </div>
          )}

          <div className="playhead" style={{ left: HEAD_W + PAD + playhead * zoom }} />
        </div>
      </div>

      {transClip && <TransitionPopover clip={transClip} clips={clips} onClose={() => setTransFor(null)} />}
    </div>
  )
}

function TransitionPopover({ clip, clips, onClose }: { clip: TimelineClip; clips: TimelineClip[]; onClose: () => void }) {
  const s = useStore.getState
  useEffect(() => () => s().setHoverTransition(null), [])
  return (
    <div className="popover trans-pop">
      <div className="pop-title">Chuyển cảnh sang clip tiếp theo</div>
      <p className="hint">Rê chuột lên một kiểu để xem thử lặp lại trên khung preview, bấm để chọn.</p>
      <div className="trans-grid" onMouseLeave={() => s().setHoverTransition(null)}>
        {TRANSITIONS.map((t) => (
          <button
            key={t.id}
            className={(clip.transition ?? 'none') === t.id ? 'on' : ''}
            onMouseEnter={() => t.id !== 'none' && s().setHoverTransition({ clipId: clip.id, kind: t.id })}
            onClick={() => s().setClip(clip.id, { transition: t.id })}
          >
            <TransitionThumb kind={t.id} />
            <span>{t.label}</span>
          </button>
        ))}
      </div>
      <label className="row">
        Thời lượng
        <input type="range" min={0.1} max={2} step={0.05} value={clip.transitionDuration ?? 0.5} onChange={(e) => s().setClip(clip.id, { transitionDuration: +e.target.value }, false)} />
        <span className="small">{(clip.transitionDuration ?? 0.5).toFixed(2)}s</span>
      </label>
      <div className="row">
        <button
          className="btn small"
          onClick={() => {
            for (const c of clips.slice(0, -1)) s().setClip(c.id, { transition: clip.transition, transitionDuration: clip.transitionDuration })
          }}
        >
          Áp cho tất cả
        </button>
        <div className="spacer" />
        <button className="btn small primary" onClick={onClose}>
          Xong
        </button>
      </div>
    </div>
  )
}

/** Hình thu nhỏ tự lặp: khung A chuyển sang khung B bằng kiểu chuyển cảnh */
export function TransitionThumb({ kind }: { kind: TimelineClip['transition'] }) {
  const p = useLoopProgress(1500, 0.3, kind !== 'none')
  const k = kind ?? 'none'
  const st = k === 'none' ? { out: {}, in: { opacity: p >= 0.5 ? 1 : 0 }, overlay: 0, overlayColor: '#000' } : transitionStyles(k, p)
  return (
    <span className="trans-thumb">
      <span className="tt a" style={st.out}>
        A
      </span>
      <span className="tt b" style={{ opacity: 1, ...st.in }}>
        B
      </span>
      <span className="tt-ov" style={{ opacity: st.overlay, background: st.overlayColor }} />
    </span>
  )
}

function ClipBlock(props: {
  clip: TimelineClip
  media: MediaItem | undefined
  left: number
  width: number
  selected: boolean
  onSelect: () => void
  onTrim: (e: React.MouseEvent, edge: 'in' | 'out') => void
  onJump: () => void
  zoom: number
  localOffset: number
}) {
  const { clip: c, media: m } = props
  const strip = useClipThumb(m)
  const speed = speedOf(c)
  const full = m ? (m.duration / speed) * props.zoom : props.width
  const offset = (c.in / speed + props.localOffset) * props.zoom
  return (
    <div
      className={'clip kind-' + (m?.kind ?? 'video') + (props.selected ? ' selected' : '')}
      style={{ left: props.left, width: props.width }}
      draggable
      onDragStart={(e) => e.dataTransfer.setData('text/laila-clip', c.id)}
      onMouseDown={(e) => {
        e.stopPropagation()
        props.onSelect()
      }}
      onDoubleClick={props.onJump}
    >
      {strip && <div className="filmstrip" style={stripStyle(m, strip, full, offset)} />}
      <div className="handle in" onMouseDown={(e) => props.onTrim(e, 'in')} />
      <div className="clip-label">
        <span className="clip-name">{m?.name ?? 'missing'}</span>
        <small>
          {clipLength(c).toFixed(1)}s{speed !== 1 ? ` · ${speed}×` : ''}
        </small>
      </div>
      <div className="handle out" onMouseDown={(e) => props.onTrim(e, 'out')} />
    </div>
  )
}

function TrackClipBlock(props: {
  clip: TrackClip
  media: MediaItem | undefined
  left: number
  width: number
  zoom: number
  selected: boolean
  onMouseDown: (e: React.MouseEvent) => void
  onTrim: (e: React.MouseEvent, edge: 'in' | 'out') => void
}) {
  const { clip: c, media: m } = props
  const thumb = useClipThumb(m)
  const sp = tSpeed(c)
  const full = m ? (m.duration / sp) * props.zoom : props.width
  const offset = (c.in / sp) * props.zoom
  const kind = m?.kind === 'audio' ? 'audio' : m?.alpha ? 'overlay' : m?.kind ?? 'video'
  return (
    <div className={'clip kind-' + kind + (props.selected ? ' selected' : '')} style={{ left: props.left, width: props.width }} onMouseDown={props.onMouseDown}>
      {thumb && (
        <div
          className={m?.kind === 'audio' ? 'waveform' : 'filmstrip'}
          style={stripStyle(m, thumb, full, offset)}
        />
      )}
      <div className="handle in" onMouseDown={(e) => props.onTrim(e, 'in')} />
      <div className="clip-label">
        <span className="clip-name">{m?.name ?? 'missing'}</span>
        <small>
          {tLength(c).toFixed(1)}s{sp !== 1 ? ` · ${sp}×` : ''}
        </small>
      </div>
      <div className="handle out" onMouseDown={(e) => props.onTrim(e, 'out')} />
    </div>
  )
}
