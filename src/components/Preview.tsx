import { useEffect, useRef } from 'react'
import type { TimelineClip } from '../../shared/types'
import { useStore, RESOLUTIONS } from '../lib/store'
import { fmtTime, mediaUrl } from '../lib/media'
import { activeClips, clipLength, clipStarts, projectDuration, speedOf, tLength, trackClipAt, transitionAfter, tSpeed } from '../lib/timeline'
import { Icon } from './Icon'
import { transitionStyles } from '../lib/transitions'

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
        <button
          className={'btn small fill-toggle' + (settings.fill ? ' tinted' : '')}
          title="Video khác tỉ lệ khung: lấp đầy (cắt viền) hoặc vừa khung (viền đen)"
          onClick={() => setSettings({ fill: !settings.fill })}
        >
          {settings.fill ? 'Lấp đầy' : 'Vừa khung'}
        </button>
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
        <div className={'screen' + (settings.fill ? ' fill' : '')} style={{ aspectRatio: `${settings.width} / ${settings.height}` }}>
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
      {m.kind === 'image' ? <img key={m.id} className="screen-img" src={mediaUrl(m.path)} alt="" /> : <video key={m.id} src={mediaUrl(m.path)} controls autoPlay loop />}
      <div className="screen-actions">
        <span>{m.name}</span>
        <button className="btn small" onClick={() => append(m.id)}>
          <Icon name="plus" size={12} /> Timeline
        </button>
      </div>
    </>
  )
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
  // ảnh tĩnh trên track chính dùng thẻ <img> riêng cho từng slot
  const imgs = [useRef<HTMLImageElement>(null), useRef<HTMLImageElement>(null)]
  const isImg = useRef([false, false])
  const trackImgs = useRef(new Map<string, HTMLImageElement>())
  const overlay = useRef<HTMLDivElement>(null)
  // phần tử phát cho track phụ (video phủ / âm thanh), theo id track
  const trackEls = useRef(new Map<string, HTMLVideoElement | HTMLAudioElement>())
  const trackUrl = useRef(new Map<string, string>())
  const hover = useStore((s) => s.hoverTransition)
  const slot = useRef<{ index: number; url: string }[]>([
    { index: -1, url: '' },
    { index: -1, url: '' }
  ])

  const tracks = project.tracks ?? []
  const videoTracks = tracks.filter((t) => t.kind === 'video')
  // đang rê chuột lên 1 kiểu chuyển cảnh: dùng tạm kiểu đó để xem thử
  const clips = hover
    ? project.timeline.map((c) => (c.id === hover.clipId ? { ...c, transition: hover.kind, transitionDuration: c.transitionDuration ?? 0.5 } : c))
    : project.timeline
  const total = projectDuration(project)
  const { width: W, height: H } = project.settings

  const mediaOf = (c: TimelineClip) => project.media.find((x) => x.id === c.mediaId)
  const urlOf = (c: TimelineClip) => {
    const m = mediaOf(c)
    return m ? mediaUrl(m.path) : ''
  }
  const setSrc = (el: HTMLImageElement | null | undefined, url: string) => {
    if (el && el.dataset.src !== url) {
      el.dataset.src = url
      el.src = url
    }
  }

  const syncTracks = (t: number, isPlaying: boolean) => {
    for (const tr of tracks) {
      const el = trackEls.current.get(tr.id)
      if (!el) continue
      const c = trackClipAt(tr, t)
      const off = !c || (tr.kind === 'video' && tr.hidden)
      if (off) {
        if (!el.paused) el.pause()
        if (tr.kind === 'video') el.style.opacity = '0'
        const im = trackImgs.current.get(tr.id)
        if (im) im.style.opacity = '0'
        continue
      }
      const m = project.media.find((x) => x.id === c.mediaId)
      if (!m) continue
      const url = mediaUrl(m.path)
      const im = trackImgs.current.get(tr.id)
      if (im) im.style.opacity = '0'
      if (m.kind === 'image' && im && tr.kind === 'video') {
        if (!el.paused) el.pause()
        el.style.opacity = '0'
        setSrc(im, url)
        const z = 10 + videoTracks.length - videoTracks.indexOf(tr)
        Object.assign(im.style, {
          opacity: String((c.opacity ?? 100) / 100),
          zIndex: String(z),
          transform: `translate(${((c.x ?? 0) / W) * 100}%, ${((c.y ?? 0) / H) * 100}%) scale(${(c.scale ?? 100) / 100})`
        })
        continue
      }
      const target = c.in + (t - c.start) * tSpeed(c)
      if (trackUrl.current.get(tr.id) !== url) {
        trackUrl.current.set(tr.id, url)
        el.src = url
        el.addEventListener('loadedmetadata', () => (el.currentTime = target), { once: true })
      } else if (el.readyState >= 1 && Math.abs(el.currentTime - target) > (isPlaying ? 0.25 : 0.02)) el.currentTime = target
      el.playbackRate = tSpeed(c)
      if (isPlaying) {
        if (el.paused) el.play().catch(() => {})
      } else if (!el.paused) el.pause()
      const local = t - c.start
      const len = tLength(c)
      let g = tr.muted ? 0 : c.volume
      if (c.audioFadeIn) g *= Math.min(1, local / c.audioFadeIn)
      if (c.audioFadeOut) g *= Math.min(1, (len - local) / c.audioFadeOut)
      el.volume = Math.max(0, Math.min(1, g))
      if (tr.kind === 'video') {
        const z = 10 + videoTracks.length - videoTracks.indexOf(tr)
        Object.assign(el.style, {
          opacity: String((c.opacity ?? 100) / 100),
          zIndex: String(z),
          transform: `translate(${((c.x ?? 0) / W) * 100}%, ${((c.y ?? 0) / H) * 100}%) scale(${(c.scale ?? 100) / 100})`
        })
      }
    }
  }

  const sync = (t: number, isPlaying: boolean) => {
    syncTracks(t, isPlaying)
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
      isImg.current[s] = mediaOf(c)?.kind === 'image'
      if (isImg.current[s]) {
        setSrc(imgs[s].current, url)
        if (!v.paused) v.pause()
        st.index = idx
        if (a) styles[s] = { opacity: 1, zIndex: 1 }
        continue
      }
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
      const im = imgs[s].current
      if (!v) return
      const shown = isImg.current[s] && im ? im : v
      const hidden = shown === v ? im : v
      Object.assign(shown.style, { opacity: '0', transform: '', clipPath: '', zIndex: '0' }, Object.fromEntries(Object.entries(styles[s]).map(([k, val]) => [k, String(val)])))
      if (hidden) Object.assign(hidden.style, { opacity: '0', zIndex: '0' })
      v.volume = shown === v ? Math.max(0, Math.min(1, gain[s])) : 0
    })
    if (overlay.current) {
      overlay.current.style.opacity = String(ov)
      overlay.current.style.background = ovColor
    }
  }

  // tua khi dừng
  useEffect(() => {
    if (!playing && !hover) sync(playhead, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playhead, project.timeline, project.tracks, project.media, playing, hover])

  // rê chuột lên kiểu chuyển cảnh: phát lặp đoạn nối giữa 2 clip
  useEffect(() => {
    if (!hover || playing) return
    const i = clips.findIndex((c) => c.id === hover.clipId)
    if (i < 0 || i >= clips.length - 1) return
    const starts = clipStarts(clips)
    const td = transitionAfter(clips, i)
    const from = Math.max(0, starts[i + 1] - 0.7)
    const to = starts[i + 1] + td + 0.7
    let raf = 0
    let t0 = performance.now()
    const tick = (now: number) => {
      let t = from + (now - t0) / 1000
      if (t > to) {
        t0 = now
        t = from
      }
      sync(t, true)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      sync(useStore.getState().playhead, false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hover, playing])

  // phát: đồng hồ hệ thống điều khiển playhead
  useEffect(() => {
    if (!playing) return
    if (!total) {
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
  }, [playing, project.timeline, project.tracks])

  return (
    <>
      {total === 0 && <div className="screen-empty">Timeline trống. Generate scene rồi đưa lên timeline.</div>}
      <video ref={vids[0]} playsInline preload="auto" />
      <video ref={vids[1]} playsInline preload="auto" />
      <img ref={imgs[0]} className="screen-img" alt="" style={{ opacity: 0 }} />
      <img ref={imgs[1]} className="screen-img" alt="" style={{ opacity: 0 }} />
      <div ref={overlay} className="screen-overlay" />
      {tracks.map((tr) =>
        tr.kind === 'video' ? (
          <span key={tr.id} style={{ display: 'contents' }}>
            <video
              className="overlay-video"
              playsInline
              preload="auto"
              ref={(el) => {
                if (el) trackEls.current.set(tr.id, el)
                else trackEls.current.delete(tr.id)
              }}
            />
            <img
              className="screen-img overlay-img"
              alt=""
              style={{ opacity: 0 }}
              ref={(el) => {
                if (el) trackImgs.current.set(tr.id, el)
                else trackImgs.current.delete(tr.id)
              }}
            />
          </span>
        ) : (
          <audio
            key={tr.id}
            preload="auto"
            ref={(el) => {
              if (el) trackEls.current.set(tr.id, el)
              else trackEls.current.delete(tr.id)
            }}
          />
        )
      )}
      <div className="transport">
        <button className="round" onClick={() => setPlaying(!playing)} disabled={total === 0} title="Phát / dừng (Space)">
          <Icon name={playing ? 'pause' : 'play'} size={14} />
        </button>
        <span className="tc">
          {fmtTime(playhead)} / {fmtTime(total)}
        </span>
      </div>
    </>
  )
}
