import { useRef, useState } from 'react'
import { useStore } from '../lib/store'
import { fmtTime } from '../lib/media'
import { clipLength, clipStarts, totalDuration } from '../lib/timeline'

const HEAD_PAD = 16 // px lề trái của track

export function Timeline() {
  const project = useStore((s) => s.project)
  const playhead = useStore((s) => s.playhead)
  const zoom = useStore((s) => s.zoom)
  const selectedId = useStore((s) => s.selectedClipId)
  const s = useStore.getState
  const scroller = useRef<HTMLDivElement>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)

  const clips = project.timeline
  const starts = clipStarts(clips)
  const total = totalDuration(clips)
  const width = Math.max(total + 10, 30) * zoom + HEAD_PAD * 2
  const selected = clips.find((c) => c.id === selectedId)
  const music = project.music
  const musicMedia = music && project.media.find((m) => m.id === music.mediaId)

  const timeAt = (clientX: number) => {
    const el = scroller.current!
    const x = clientX - el.getBoundingClientRect().left + el.scrollLeft - HEAD_PAD
    return Math.max(0, x / zoom)
  }

  // kéo playhead trên thước
  const scrubStart = (e: React.MouseEvent) => {
    s().setPlaying(false)
    s().setPlayhead(timeAt(e.clientX))
    const move = (ev: MouseEvent) => s().setPlayhead(timeAt(ev.clientX))
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  // kéo mép clip để trim
  const trimStart = (e: React.MouseEvent, id: string, edge: 'in' | 'out') => {
    e.stopPropagation()
    e.preventDefault()
    const clip = clips.find((c) => c.id === id)!
    const x0 = e.clientX
    const v0 = edge === 'in' ? clip.in : clip.out
    s().beginTrim()
    s().select(id)
    const move = (ev: MouseEvent) => s().trim(id, edge, v0 + (ev.clientX - x0) / zoom)
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  // vị trí chèn khi thả: trước clip có điểm giữa nằm bên phải con trỏ
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

  // vạch thước
  const step = zoom >= 120 ? 0.5 : zoom >= 50 ? 1 : zoom >= 20 ? 5 : 10
  const ticks: number[] = []
  for (let t = 0; t <= width / zoom; t += step) ticks.push(t)

  return (
    <div className="timeline panel">
      <div className="tl-toolbar">
        <button title="Cắt tại playhead (S / ⌘B)" onClick={() => s().splitAtPlayhead()} disabled={!clips.length}>
          ✂ Cắt
        </button>
        <button title="Xoá clip (Delete)" onClick={() => s().deleteSelected()} disabled={!selected}>
          Xoá
        </button>
        <button title="Nhân bản (⌘D)" onClick={() => s().duplicateSelected()} disabled={!selected}>
          Nhân bản
        </button>
        <button title="Undo (⌘Z)" onClick={() => s().undo()}>
          ↶
        </button>
        <button title="Redo (⇧⌘Z)" onClick={() => s().redo()}>
          ↷
        </button>
        {selected && (
          <span className="tl-selected">
            {fmtTime(selected.in)} → {fmtTime(selected.out)} · vol
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={selected.volume}
              onChange={(e) => s().setClipVolume(selected.id, +e.target.value)}
            />
          </span>
        )}
        <div className="spacer" />
        <span className="tc">
          {fmtTime(playhead)} / {fmtTime(total)}
        </span>
        <label className="zoom">
          Zoom
          <input type="range" min={10} max={400} value={zoom} onChange={(e) => s().setZoom(+e.target.value)} />
        </label>
      </div>

      <div className="tl-scroll" ref={scroller}>
        <div className="tl-inner" style={{ width }}>
          <div className="ruler" onMouseDown={scrubStart}>
            {ticks.map((t) => (
              <div key={t} className="tick" style={{ left: HEAD_PAD + t * zoom }}>
                {Number.isInteger(t) && (step >= 1 || t % 1 === 0) ? fmtTime(t).replace(/\.0$/, '') : ''}
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
              const m = project.media.find((x) => x.id === c.mediaId)
              return (
                <div
                  key={c.id}
                  className={'clip kind-' + (m?.kind ?? 'video') + (c.id === selectedId ? ' selected' : '')}
                  style={{ left: HEAD_PAD + starts[i] * zoom, width: Math.max(4, clipLength(c) * zoom) }}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData('text/laila-clip', c.id)}
                  onMouseDown={(e) => {
                    e.stopPropagation()
                    s().select(c.id)
                  }}
                  onDoubleClick={() => s().setPlayhead(starts[i])}
                >
                  <div className="handle in" onMouseDown={(e) => trimStart(e, c.id, 'in')} />
                  <div className="clip-label">
                    {m?.name ?? 'missing'}
                    <small>{clipLength(c).toFixed(1)}s</small>
                  </div>
                  <div className="handle out" onMouseDown={(e) => trimStart(e, c.id, 'out')} />
                </div>
              )
            })}
            {dropIndex !== null && (
              <div
                className="drop-marker"
                style={{ left: HEAD_PAD + (dropIndex < clips.length ? starts[dropIndex] : total) * zoom }}
              />
            )}
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
              <div
                className="clip kind-audio"
                style={{ left: HEAD_PAD, width: Math.max(20, Math.min(musicMedia.duration - music.in, total || 10) * zoom) }}
              >
                <div className="clip-label">
                  ♪ {musicMedia.name}
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
                  <button className="icon" onClick={() => s().setMusic(undefined)}>
                    ×
                  </button>
                </div>
              </div>
            ) : (
              <div className="track-empty">Nhạc nền: kéo file audio từ Media vào đây</div>
            )}
          </div>

          <div className="playhead" style={{ left: HEAD_PAD + playhead * zoom }} />
        </div>
      </div>
    </div>
  )
}
