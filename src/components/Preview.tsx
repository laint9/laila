import { useEffect, useRef } from 'react'
import type { TimelineClip, TransitionKind } from '../../shared/types'
import { useStore, RESOLUTIONS } from '../lib/store'
import { fmtTime, mediaUrl } from '../lib/media'
import { activeClips, clipLength, clipStarts, speedOf, totalDuration, transitionAfter } from '../lib/timeline'
import { Icon } from './Icon'

export function Preview() {
  const preview = useStore((s) => s.preview)
  const setPreview = useStore((s) => s.setPreview)
  const settings = useStore((s) => s.project.settings)
  const setSettings = useStore((s) => s.setSettings)
  const resIndex = RESOLUTIONS.findIndex((r) => r.width === settings.width && r.height === settings.height)

  return (
    <div className="preview">
      <div className="preview-head">
        <div className="segmented">
          <button className={preview.type === 'timeline' ? 'on' : ''} onClick={() => setPreview({ type: 'timeline' })}>
            Timeline
          </button>
          <button className={preview.type === 'media' ? 'on' : ''} disabled={preview.type !== 'media'}>
            Clip
          </button>
        </div>
        <div className="spacer" />
        <select
          className="ratio-select"
          title="Tỉ lệ khung hình"
          value={resIndex}
          onChange={(e) => {
            const r = RESOLUTIONS[+e.target.value]
            if (r) setSettings({ width: r.width, height: r.height })
          }}
        >
          {resIndex < 0 && <option value={-1}>{settings.width}×{settings.height}</option>}
          {RESOLUTIONS.map((r, i) => (
            <option key={r.label} value={i}>
              {r.label}
            </option>
          ))}
        </select>
      </div>
      <div className="screen-wrap">
        <div className="screen" style={{ aspectRatio: `${settings.width} / ${settings.height}` }}>
          {preview.type === 'timeline' ? <TimelinePlayer /> : <ClipPlayer mediaId={preview.mediaId} />}
        </div>
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
        <button className="btn small" onClick={() => append(m.id)}>
          <Icon name="plus" size={12} /> Timeline
        </button>
      </div>
    </>
  )
}

/** Style của 2 clip trong lúc chuyển cảnh (xem trước gần giống bản xuất bằng ffmpeg xfade) */
function transitionStyles(kind: TransitionKind, p: number): { out: React.CSSProperties; in: React.CSSProperties; overlay: number; overlayColor: string } {
  const r = { out: {} as React.CSSProperties, in: {} as React.CSSProperties, overlay: 0, overlayColor: '#000' }
  switch (kind) {
    case 'fade':
    case 'dissolve':
      r.in.opacity = p
      break
    case 'fadeblack':
    case 'fadewhite':
      r.overlayColor = kind === 'fadeblack' ? '#000' : '#fff'
      r.overlay = 1 - Math.abs(2 * p - 1)
      r.in.opacity = p < 0.5 ? 0 : 1
      break
    case 'slideleft':
      r.out.transform = `translateX(${-p * 100}%)`
      r.in.transform = `translateX(${(1 - p) * 100}%)`
      break
    case 'slideup':
      r.out.transform = `translateY(${-p * 100}%)`
      r.in.transform = `translateY(${(1 - p) * 100}%)`
      break
    case 'wipeleft':
      r.in.clipPath = `inset(0 0 0 ${(1 - p) * 100}%)`
      break
    case 'circleopen':
      r.in.clipPath = `circle(${p * 75}% at 50% 50%)`
      break
    case 'zoomin':
      r.out.transform = `scale(${1 + p * 0.6})`
      r.out.opacity = 1 - p
      r.in.opacity = p
      break
  }
  return r
}

/**
 * Phát timeline bằng 2 thẻ <video> luân phiên (clip chẵn/lẻ), clip kế tiếp luôn được nạp sẵn
 * nên không bị chớp khi cắt, và xem trước được chuyển cảnh. Đồng hồ chính là đồng hồ hệ thống.
 */
function TimelinePlayer() {
  const project = useStore((s) => s.project)
  const playhead = useStore((s) => s.playhead)
  const playing = useStore((s) => s.playing)
  const setPlaying = useStore((s) => s.setPlaying)
  const vids = [useRef<HTMLVideoElement>(null), useRef<HTMLVideoElement>(null)]
  const overlay = useRef<HTMLDivElement>(null)
  const audio = useRef<HTMLAudioElement>(null)
  const slot = useRef<{ index: number; url: string }[]>([
    { index: -1, url: '' },
    { index: -1, url: '' }
  ])

  const clips = project.timeline
  const total = totalDuration(clips)
  const music = project.music && project.media.find((m) => m.id === project.music!.mediaId)

  const urlOf = (c: TimelineClip) => {
    const m = project.media.find((x) => x.id === c.mediaId)
    return m ? mediaUrl(m.path) : ''
  }

  const sync = (t: number, isPlaying: boolean) => {
    const starts = clipStarts(clips)
    const act = activeClips(clips, t)
    let styles: [React.CSSProperties, React.CSSProperties] = [{ opacity: 0 }, { opacity: 0 }]
    let ov = 0,
      ovColor = '#000'
    const gain = [0, 0]

    for (const s of [0, 1]) {
      const v = vids[s].current
      if (!v) continue
      const a = act.find((x) => x.index % 2 === s)
      // clip cần nạp cho slot này: clip đang hiện, hoặc clip sắp tới cùng chẵn/lẻ
      let idx = a?.index ?? -1
      if (idx < 0) {
        for (let i = 0; i < clips.length; i++) if (i % 2 === s && starts[i] > t) { idx = i; break }
      }
      const st = slot.current[s]
      if (idx < 0) {
        if (st.index !== -1) {
          v.pause()
          st.index = -1
        }
        continue
      }
      const c = clips[idx]
      const url = urlOf(c)
      const target = a ? a.source : c.in
      if (st.url !== url) {
        st.url = url
        v.src = url
        v.addEventListener('loadedmetadata', () => (v.currentTime = target), { once: true })
      } else if (st.index !== idx || (!isPlaying && Math.abs(v.currentTime - target) > 0.02) || (isPlaying && a && Math.abs(v.currentTime - target) > 0.25)) {
        if (v.readyState >= 1) v.currentTime = target
      }
      st.index = idx
      v.playbackRate = speedOf(c)
      if (a && isPlaying) {
        if (v.paused) v.play().catch(() => {})
      } else if (!v.paused) v.pause()
      if (a) {
        styles[s] = { opacity: 1, zIndex: 1 }
        // fade âm thanh đầu/cuối clip
        const len = clipLength(c)
        let g = c.volume
        if (c.audioFadeIn) g *= Math.min(1, a.local / c.audioFadeIn)
        if (c.audioFadeOut) g *= Math.min(1, (len - a.local) / c.audioFadeOut)
        gain[s] = g
      }
    }

    // đang chuyển cảnh giữa 2 clip
    if (act.length === 2) {
      const [o, n] = act[0].index < act[1].index ? act : [act[1], act[0]]
      const td = transitionAfter(clips, o.index)
      const p = td > 0 ? Math.min(1, Math.max(0, n.local / td)) : 1
      const ts = transitionStyles(clips[o.index].transition ?? 'fade', p)
      styles[o.index % 2] = { opacity: 1, zIndex: 1, ...ts.out }
      styles[n.index % 2] = { opacity: 1, zIndex: 2, ...ts.in }
      ov = ts.overlay
      ovColor = ts.overlayColor
      gain[o.index % 2] *= 1 - p
      gain[n.index % 2] *= p
    }

    vids.forEach((r, s) => {
      const v = r.current
      if (!v) return
      Object.assign(v.style, { opacity: '0', transform: '', clipPath: '', zIndex: '0' }, Object.fromEntries(Object.entries(styles[s]).map(([k, val]) => [k, String(val)])))
      v.volume = Math.max(0, Math.min(1, gain[s]))
    })
    if (overlay.current) {
      overlay.current.style.opacity = String(ov)
      overlay.current.style.background = ovColor
    }
    if (audio.current && project.music) {
      const at = project.music.in + t
      audio.current.volume = project.music.volume
      if (isPlaying) {
        if (Math.abs(audio.current.currentTime - at) > 0.25) audio.current.currentTime = at
        if (audio.current.paused) audio.current.play().catch(() => {})
      } else {
        audio.current.pause()
        if (Math.abs(audio.current.currentTime - at) > 0.05) audio.current.currentTime = at
      }
    }
  }

  // tua khi dừng
  useEffect(() => {
    if (!playing) sync(playhead, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playhead, clips, project.media, playing])

  // phát: đồng hồ hệ thống điều khiển playhead
  useEffect(() => {
    if (!playing) return
    if (!clips.length) {
      setPlaying(false)
      return
    }
    let t0 = useStore.getState().playhead
    if (t0 >= total - 0.02) t0 = 0
    const startAt = performance.now()
    let raf = 0
    const tick = () => {
      const t = t0 + (performance.now() - startAt) / 1000
      if (t >= total) {
        useStore.getState().setPlayhead(total)
        sync(total - 0.001, false)
        setPlaying(false)
        return
      }
      useStore.getState().setPlayhead(t)
      sync(t, true)
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, clips])

  return (
    <>
      {clips.length === 0 && <div className="screen-empty">Timeline trống. Generate scene rồi đưa lên timeline.</div>}
      <video ref={vids[0]} playsInline preload="auto" />
      <video ref={vids[1]} playsInline preload="auto" />
      <div ref={overlay} className="screen-overlay" />
      {music && <audio ref={audio} src={mediaUrl(music.path)} preload="auto" />}
      <div className="transport">
        <button className="round" onClick={() => setPlaying(!playing)} disabled={clips.length === 0} title="Phát / dừng (Space)">
          <Icon name={playing ? 'pause' : 'play'} size={14} />
        </button>
        <span className="tc">
          {fmtTime(playhead)} / {fmtTime(total)}
        </span>
      </div>
    </>
  )
}
