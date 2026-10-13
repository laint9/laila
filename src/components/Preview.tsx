import { useEffect, useRef } from 'react'
import { useStore } from '../lib/store'
import { fmtTime, mediaUrl } from '../lib/media'
import { clipStarts, locate, totalDuration } from '../lib/timeline'

export function Preview() {
  const preview = useStore((s) => s.preview)
  const setPreview = useStore((s) => s.setPreview)
  const settings = useStore((s) => s.project.settings)

  return (
    <div className="preview">
      <div className="preview-head">
        <button className={preview.type === 'timeline' ? 'on' : ''} onClick={() => setPreview({ type: 'timeline' })}>
          Timeline
        </button>
        {preview.type === 'media' && <button className="on">Clip</button>}
      </div>
      <div className="screen" style={{ aspectRatio: `${settings.width} / ${settings.height}` }}>
        {preview.type === 'timeline' ? <TimelinePlayer /> : <ClipPlayer mediaId={preview.mediaId} />}
      </div>
    </div>
  )
}

function ClipPlayer({ mediaId }: { mediaId: string }) {
  const m = useStore((s) => s.project.media.find((x) => x.id === mediaId))
  const append = useStore((s) => s.appendToTimeline)
  if (!m) return <div className="screen-empty">Clip không còn</div>
  return (
    <>
      <video key={m.id} src={mediaUrl(m.path)} controls autoPlay loop />
      <div className="screen-actions">
        <span>{m.name}</span>
        <button onClick={() => append(m.id)}>+ Timeline</button>
      </div>
    </>
  )
}

/**
 * Phát timeline: 1 thẻ <video>, đổi src khi qua clip. Nhạc nền là <audio> đồng bộ theo playhead.
 */
function TimelinePlayer() {
  const project = useStore((s) => s.project)
  const playhead = useStore((s) => s.playhead)
  const playing = useStore((s) => s.playing)
  const setPlaying = useStore((s) => s.setPlaying)
  const video = useRef<HTMLVideoElement>(null)
  const audio = useRef<HTMLAudioElement>(null)
  const currentIndex = useRef(-1)
  const internalT = useRef<number | null>(null) // playhead do chính player đặt, không cần seek lại

  const clips = project.timeline
  const total = totalDuration(clips)
  const music = project.music && project.media.find((m) => m.id === project.music!.mediaId)

  // Đưa video về đúng frame của playhead (khi scrub hoặc khi đổi clip)
  const seekTo = (t: number, autoplay: boolean) => {
    const v = video.current
    if (!v) return
    const hit = locate(clips, t)
    if (!hit) {
      v.removeAttribute('src')
      v.load()
      currentIndex.current = -1
      return
    }
    const clip = clips[hit.index]
    const m = project.media.find((x) => x.id === clip.mediaId)
    if (!m) return
    const url = mediaUrl(m.path)
    const target = clip.in + hit.local
    if (currentIndex.current !== hit.index || v.dataset.src !== url) {
      currentIndex.current = hit.index
      v.dataset.src = url
      v.src = url
      v.addEventListener(
        'loadedmetadata',
        () => {
          v.currentTime = target
          if (autoplay) v.play().catch(() => {})
        },
        { once: true }
      )
    } else if (Math.abs(v.currentTime - target) > 0.05) {
      v.currentTime = target
    }
    v.volume = Math.max(0, Math.min(1, clip.volume))
    if (audio.current && project.music) {
      const at = project.music.in + t
      if (Math.abs(audio.current.currentTime - at) > 0.25) audio.current.currentTime = at
      audio.current.volume = project.music.volume
    }
  }

  // playhead thay đổi từ ngoài (scrub, phím tắt, cắt) -> seek
  useEffect(() => {
    if (internalT.current !== null && Math.abs(internalT.current - playhead) < 1e-6) return
    seekTo(playhead, playing)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playhead, clips, project.media])

  // play / pause
  useEffect(() => {
    const v = video.current
    if (!v) return
    if (!playing) {
      v.pause()
      audio.current?.pause()
      return
    }
    if (clips.length === 0) {
      setPlaying(false)
      return
    }
    let start = useStore.getState().playhead
    if (start >= total - 0.02) start = 0
    seekTo(start, true)
    useStore.getState().setPlayhead(start)
    v.play().catch(() => {})
    audio.current?.play().catch(() => {})

    let raf = 0
    const starts = clipStarts(clips)
    const tick = () => {
      const i = currentIndex.current
      if (i >= 0 && i < clips.length && !v.seeking && v.readyState >= 2) {
        const clip = clips[i]
        const t = starts[i] + (v.currentTime - clip.in)
        if (v.currentTime >= clip.out - 0.02 || v.ended) {
          if (i + 1 < clips.length) {
            internalT.current = starts[i + 1]
            useStore.getState().setPlayhead(starts[i + 1])
            seekTo(starts[i + 1], true)
          } else {
            useStore.getState().setPlayhead(total)
            setPlaying(false)
            return
          }
        } else {
          internalT.current = Math.max(0, Math.min(t, total))
          useStore.getState().setPlayhead(t)
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, clips])

  return (
    <>
      {clips.length === 0 && <div className="screen-empty">Timeline trống. Generate scene rồi đưa lên timeline.</div>}
      <video ref={video} playsInline style={{ visibility: clips.length ? 'visible' : 'hidden' }} />
      {music && <audio ref={audio} src={mediaUrl(music.path)} preload="auto" />}
      <div className="transport">
        <button onClick={() => setPlaying(!playing)} disabled={clips.length === 0}>
          {playing ? '❚❚' : '▶'}
        </button>
        <span className="tc">
          {fmtTime(playhead)} / {fmtTime(total)}
        </span>
      </div>
    </>
  )
}
