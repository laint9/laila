import { useEffect, useRef, useState } from 'react'
import type { MediaItem, TimelineClip, TransitionKind } from '../../shared/types'
import { useStore } from '../lib/store'
import { fmtTime, mediaUrl } from '../lib/media'
import { clipLength, clipStarts, snapPoints, speedOf, totalDuration, transitionAfter } from '../lib/timeline'
import { Icon } from './Icon'

const HEAD_PAD = 16
const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4]
export const TRANSITIONS: { id: TransitionKind; label: string }[] = [
  { id: 'none', label: 'Không' },
  { id: 'fade', label: 'Mờ dần' },
  { id: 'dissolve', label: 'Hoà tan' },
  { id: 'fadeblack', label: 'Qua màu đen' },
  { id: 'fadewhite', label: 'Qua màu trắng' },
  { id: 'slideleft', label: 'Đẩy sang trái' },
  { id: 'slideup', label: 'Đẩy lên' },
  { id: 'wipeleft', label: 'Quét ngang' },
  { id: 'circleopen', label: 'Mở tròn' },
  { id: 'zoomin', label: 'Phóng to' }
]

// filmstrip: cache theo đường dẫn file
const strips = new Map<string, string | null>()
function useFilmstrip(m: MediaItem | undefined) {
  const [url, setUrl] = useState<string | null>(m ? strips.get(m.path) ?? null : null)
  useEffect(() => {
    if (!m || m.kind === 'audio') return
    if (strips.has(m.path)) return setUrl(strips.get(m.path)!)
    let alive = true
    window.laila.media.filmstrip(m.path, m.duration).then((p) => {
      const u = p ? mediaUrl(p) : null
      strips.set(m.path, u)
      if (alive) setUrl(u)
    })
    return () => {
      alive = false
    }
  }, [m?.path])
  return url
}

export function Timeline() {
  const project = useStore((s) => s.project)
  const playhead = useStore((s) => s.playhead)
  const playing = useStore((s) => s.playing)
  const zoom = useStore((s) => s.zoom)
  const selectedId = useStore((s) => s.selectedClipId)
  const s = useStore.getState
  const scroller = useRef<HTMLDivElement>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const [transFor, setTransFor] = useState<string | null>(null)

  const clips = project.timeline
  const starts = clipStarts(clips)
  const total = totalDuration(clips)
  const width = Math.max(total + 10, 30) * zoom + HEAD_PAD * 2
  const selected = clips.find((c) => c.id === selectedId)
  const music = project.music
  const musicMedia = music && project.media.find((m) => m.id === music.mediaId)

  // giữ playhead trong tầm nhìn khi phát
  useEffect(() => {
    const el = scroller.current
    if (!el || !playing) return
    const x = HEAD_PAD + playhead * zoom
    if (x > el.scrollLeft + el.clientWidth - 60 || x < el.scrollLeft) el.scrollLeft = Math.max(0, x - 80)
  }, [playhead, playing, zoom])

  // ⌘ + cuộn / pinch để zoom
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
    const x = clientX - el.getBoundingClientRect().left + el.scrollLeft - HEAD_PAD
    return Math.max(0, x / zoom)
  }
  const snapTime = (t: number) => {
    const th = 8 / zoom
    const hit = snapPoints(clips).find((p) => Math.abs(p - t) < th)
    return hit ?? t
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

  const trimStart = (e: React.MouseEvent, c: TimelineClip, edge: 'in' | 'out') => {
    e.stopPropagation()
    e.preventDefault()
    const x0 = e.clientX
    const v0 = edge === 'in' ? c.in : c.out
    s().beginTrim()
    s().select(c.id)
    const move = (ev: MouseEvent) => s().trim(c.id, edge, v0 + ((ev.clientX - x0) / zoom) * speedOf(c))
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const indexAt = (clientX: number) => {
    const t = timeAt(clientX)
    for (let i = 0; i < clips.length; i++) if (t < starts[i] + clipLength(clips[i]) / 2) return i
    return clips.length
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const idx = indexAt(e.clientX)
    setDropIndex(null)
    const mediaId = e.dataTransfer.getData('text/laila-media')
    const clipId = e.dataTransfer.getData('text/laila-clip')
    if (mediaId) s().appendToTimeline(mediaId, idx)
    else if (clipId) s().move(clipId, idx)
  }

  const step = zoom >= 120 ? 0.5 : zoom >= 50 ? 1 : zoom >= 20 ? 5 : 10
  const ticks: number[] = []
  for (let t = 0; t <= width / zoom; t += step) ticks.push(t)
  const transClip = clips.find((c) => c.id === transFor)

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
        <button className="tbtn labeled" title="Tách clip tại playhead (⌘B)" onClick={() => s().splitAtPlayhead()} disabled={!clips.length}>
          <Icon name="scissors" /> Tách
        </button>
        <button className="tbtn labeled" title="Xoá phần bên trái playhead (Q)" onClick={() => s().trimLeft()} disabled={!clips.length}>
          ⟦ Cắt trái
        </button>
        <button className="tbtn labeled" title="Xoá phần bên phải playhead (W)" onClick={() => s().trimRight()} disabled={!clips.length}>
          Cắt phải ⟧
        </button>
        <button className="tbtn" title="Nhân bản (⌘D)" onClick={() => s().duplicateSelected()} disabled={!selected}>
          <Icon name="copy" />
        </button>
        <button className="tbtn" title="Xoá clip (Delete)" onClick={() => s().deleteSelected()} disabled={!selected}>
          <Icon name="trash" />
        </button>

        {selected && (
          <>
            <div className="divider" />
            <label className="clip-prop" title="Tốc độ">
              <Icon name="speed" />
              <select value={speedOf(selected)} onChange={(e) => s().setClip(selected.id, { speed: +e.target.value })}>
                {SPEEDS.map((v) => (
                  <option key={v} value={v}>
                    {v}×
                  </option>
                ))}
              </select>
            </label>
            <label className="clip-prop" title="Âm lượng">
              <Icon name="wave" />
              <input type="range" min={0} max={2} step={0.05} value={selected.volume} onChange={(e) => s().setClip(selected.id, { volume: +e.target.value }, false)} />
              <span className="small muted">{Math.round(selected.volume * 100)}%</span>
            </label>
            <label className="clip-prop" title="Fade âm thanh vào / ra (giây)">
              Fade
              <input type="number" min={0} max={5} step={0.1} value={selected.audioFadeIn ?? 0} onChange={(e) => s().setClip(selected.id, { audioFadeIn: Math.max(0, +e.target.value) })} />
              /
              <input type="number" min={0} max={5} step={0.1} value={selected.audioFadeOut ?? 0} onChange={(e) => s().setClip(selected.id, { audioFadeOut: Math.max(0, +e.target.value) })} />
            </label>
          </>
        )}
        <div className="spacer" />
        <span className="tc">
          {fmtTime(playhead)} / {fmtTime(total)}
        </span>
        <button
          className="tbtn labeled"
          title="Vừa khung"
          disabled={!clips.length}
          onClick={() => scroller.current && s().setZoom((scroller.current.clientWidth - 60) / Math.max(1, total))}
        >
          Vừa khung
        </button>
        <label className="zoom" title="Zoom timeline (⌘ + cuộn)">
          <Icon name="ellipse" size={10} />
          <input type="range" min={10} max={400} value={zoom} onChange={(e) => s().setZoom(+e.target.value)} />
          <Icon name="ellipse" size={14} />
        </label>
      </div>

      <div className="tl-scroll" ref={scroller}>
        <div className="tl-inner" style={{ width }}>
          <div className="ruler" onMouseDown={scrubStart}>
            {ticks.map((t) => (
              <div key={t} className="tick" style={{ left: HEAD_PAD + t * zoom }}>
                {Number.isInteger(t) ? fmtTime(t).replace(/\.0$/, '') : ''}
              </div>
            ))}
          </div>

          <div
            className="track video-track"
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
            onDrop={onDrop}
          >
            {clips.map((c, i) => {
              // vùng chuyển cảnh chia đôi cho 2 clip để không đè nhau
              const cutIn = i > 0 ? transitionAfter(clips, i - 1) / 2 : 0
              const cutOut = transitionAfter(clips, i) / 2
              return (
              <ClipBlock
                key={c.id}
                clip={c}
                media={project.media.find((x) => x.id === c.mediaId)}
                left={HEAD_PAD + (starts[i] + cutIn) * zoom}
                width={Math.max(4, (clipLength(c) - cutIn - cutOut) * zoom)}
                zoom={zoom}
                localOffset={cutIn}
                selected={c.id === selectedId}
                onSelect={() => s().select(c.id)}
                onTrim={(e, edge) => trimStart(e, c, edge)}
                onJump={() => s().setPlayhead(starts[i])}
              />
              )
            })}
            {clips.slice(0, -1).map((c, i) => {
              const td = transitionAfter(clips, i)
              const x = HEAD_PAD + (starts[i + 1] + td / 2) * zoom
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
            {dropIndex !== null && <div className="drop-marker" style={{ left: HEAD_PAD + (dropIndex < clips.length ? starts[dropIndex] : total) * zoom }} />}
            {clips.length === 0 && <div className="track-empty">Kéo clip từ Media hoặc bấm “Đưa lên timeline”</div>}
          </div>

          <div
            className="track audio-track"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              const id = e.dataTransfer.getData('text/laila-media')
              const m = project.media.find((x) => x.id === id)
              if (m?.kind === 'audio') s().setMusic({ mediaId: id, volume: 0.6, in: 0 })
            }}
          >
            {music && musicMedia ? (
              <div className="clip kind-audio" style={{ left: HEAD_PAD, width: Math.max(20, Math.min(musicMedia.duration - music.in, total || 10) * zoom) }}>
                <div className="clip-label row">
                  <Icon name="music" size={12} /> {musicMedia.name}
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={music.volume}
                    title="Âm lượng nhạc"
                    onMouseDown={(e) => e.stopPropagation()}
                    onChange={(e) => useStore.setState((st) => ({ project: { ...st.project, music: { ...music, volume: +e.target.value } } }))}
                  />
                  <button className="tiny light" onClick={() => s().setMusic(undefined)} title="Bỏ nhạc">
                    <Icon name="close" size={11} />
                  </button>
                </div>
              </div>
            ) : (
              <div className="track-empty">
                <Icon name="music" size={12} /> Nhạc nền: kéo file audio từ Media vào đây
              </div>
            )}
          </div>

          <div className="playhead" style={{ left: HEAD_PAD + playhead * zoom }} />
        </div>
      </div>

      {transClip && (
        <div className="popover trans-pop">
          <div className="pop-title">Chuyển cảnh sang clip tiếp theo</div>
          <div className="trans-grid">
            {TRANSITIONS.map((t) => (
              <button key={t.id} className={(transClip.transition ?? 'none') === t.id ? 'on' : ''} onClick={() => s().setClip(transClip.id, { transition: t.id })}>
                {t.label}
              </button>
            ))}
          </div>
          <label className="row">
            Thời lượng
            <input type="range" min={0.1} max={2} step={0.05} value={transClip.transitionDuration ?? 0.5} onChange={(e) => s().setClip(transClip.id, { transitionDuration: +e.target.value }, false)} />
            <span className="small">{(transClip.transitionDuration ?? 0.5).toFixed(2)}s</span>
          </label>
          <div className="row">
            <button
              className="btn small"
              onClick={() => {
                for (const c of clips.slice(0, -1)) s().setClip(c.id, { transition: transClip.transition, transitionDuration: transClip.transitionDuration })
              }}
            >
              Áp cho tất cả
            </button>
            <div className="spacer" />
            <button className="btn small primary" onClick={() => setTransFor(null)}>
              Xong
            </button>
          </div>
        </div>
      )}
    </div>
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
  const strip = useFilmstrip(m)
  const speed = speedOf(c)
  // vị trí filmstrip theo đoạn đã trim (dải 12 ô cho cả file)
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
      {strip && <div className="filmstrip" style={{ backgroundImage: `url("${strip}")`, backgroundSize: `${full}px 100%`, backgroundPosition: `${-offset}px 0` }} />}
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
