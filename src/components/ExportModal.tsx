import { useEffect, useState } from 'react'
import { useStore } from '../lib/store'
import { projectDuration } from '../lib/timeline'
import { fmtTime } from '../lib/media'
import { cleanError } from '../lib/pipeline'
import { Icon } from './Icon'

const SIZES = [
  { id: 0.5, label: '50% (nháp)' },
  { id: 1, label: 'Gốc' },
  { id: 2, label: '200% (2K/4K)' }
]

export function ExportModal(props: { onClose: () => void }) {
  const project = useStore((s) => s.project)
  const [quality, setQuality] = useState<'draft' | 'high'>('high')
  const [scale, setScale] = useState(1)
  const [fps, setFps] = useState(project.settings.fps)
  const [progress, setProgress] = useState<number | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => window.laila.exporter.onProgress(setProgress), [])

  const W = Math.round((project.settings.width * scale) / 2) * 2
  const H = Math.round((project.settings.height * scale) / 2) * 2
  const stale = project.scenes.filter((s) => s.dirty).length

  const run = async () => {
    const outPath = await window.laila.exporter.pick(project.name)
    if (!outPath) return
    setError(null)
    setDone(null)
    setProgress(0)
    const byId = new Map(project.media.map((m) => [m.id, m]))
    try {
      await window.laila.exporter.run({
        outPath,
        settings: { width: W, height: H, fps },
        quality,
        clips: project.timeline
          .filter((c) => byId.has(c.mediaId))
          .map((c) => {
            const m = byId.get(c.mediaId)!
            return {
              path: m.path,
              in: c.in,
              out: c.out,
              hasAudio: m.hasAudio,
              volume: c.volume,
              speed: c.speed ?? 1,
              transition: c.transition ?? 'none',
              transitionDuration: c.transitionDuration ?? 0.5,
              fadeIn: c.audioFadeIn ?? 0,
              fadeOut: c.audioFadeOut ?? 0
            }
          }),
        overlays: (project.tracks ?? [])
          .filter((t) => t.kind === 'video' && !t.hidden)
          .reverse() // track đứng đầu danh sách nằm trên cùng -> vẽ sau cùng
          .flatMap((t) =>
            t.clips
              .filter((c) => byId.has(c.mediaId))
              .map((c) => {
                const m = byId.get(c.mediaId)!
                return {
                  path: m.path,
                  alpha: !!m.alpha,
                  hasAudio: m.hasAudio,
                  start: c.start,
                  in: c.in,
                  out: c.out,
                  speed: c.speed ?? 1,
                  volume: c.volume,
                  fadeIn: c.audioFadeIn ?? 0,
                  fadeOut: c.audioFadeOut ?? 0,
                  opacity: c.opacity ?? 100,
                  scale: c.scale ?? 100,
                  x: c.x ?? 0,
                  y: c.y ?? 0
                }
              })
          ),
        audios: (project.tracks ?? [])
          .filter((t) => t.kind === 'audio' && !t.muted)
          .flatMap((t) =>
            t.clips
              .filter((c) => byId.has(c.mediaId))
              .map((c) => ({
                path: byId.get(c.mediaId)!.path,
                start: c.start,
                in: c.in,
                out: c.out,
                speed: c.speed ?? 1,
                volume: c.volume,
                fadeIn: c.audioFadeIn ?? 0,
                fadeOut: c.audioFadeOut ?? 0
              }))
          )
      })
      setDone(outPath)
    } catch (e) {
      setError(cleanError((e as Error).message))
    } finally {
      setProgress(null)
    }
  }

  const running = progress !== null

  return (
    <div className="modal-back" onMouseDown={() => !running && props.onClose()}>
      <div className="modal export" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Xuất video</h3>
          <div className="spacer" />
          {!running && (
            <button className="tiny" onClick={props.onClose}>
              <Icon name="close" />
            </button>
          )}
        </div>
        <div className="form-grid">
          <span className="muted">Nội dung</span>
          <span>
            {project.timeline.length} clip · {fmtTime(projectDuration(project))}
            {(project.tracks ?? []).length ? ` · ${(project.tracks ?? []).length} track phụ` : ''}
          </span>
          <span className="muted">Kích thước</span>
          <span className="row">
            <select value={scale} onChange={(e) => setScale(+e.target.value)}>
              {SIZES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
            <span className="muted">
              {W}×{H}
            </span>
          </span>
          <span className="muted">Khung hình/giây</span>
          <select value={fps} onChange={(e) => setFps(+e.target.value)}>
            {[24, 25, 30, 50, 60].map((f) => (
              <option key={f} value={f}>
                {f} fps
              </option>
            ))}
          </select>
          <span className="muted">Chất lượng</span>
          <div className="segmented">
            <button className={quality === 'high' ? 'on' : ''} onClick={() => setQuality('high')}>
              Cao
            </button>
            <button className={quality === 'draft' ? 'on' : ''} onClick={() => setQuality('draft')}>
              Nháp (nhanh)
            </button>
          </div>
          <span className="muted">Định dạng</span>
          <span>MP4 · H.264 + AAC</span>
        </div>
        {stale > 0 && <p className="warn-text">{stale} scene đã chỉnh nhưng chưa render lại. Bản xuất sẽ dùng clip cũ.</p>}
        {running && (
          <div className="bar big">
            <div style={{ width: `${Math.round(progress! * 100)}%` }} />
          </div>
        )}
        {error && <pre className="error">{error}</pre>}
        {done && (
          <p className="ok">
            Đã xuất xong.{' '}
            <button className="btn small" onClick={() => window.laila.file.reveal(done)}>
              Mở trong Finder
            </button>
          </p>
        )}
        <div className="modal-foot">
          <div className="spacer" />
          {running ? (
            <button className="btn" onClick={() => window.laila.exporter.cancel()}>
              Huỷ
            </button>
          ) : (
            <>
              <button className="btn" onClick={props.onClose}>
                Đóng
              </button>
              <button className="btn primary" onClick={run} disabled={projectDuration(project) === 0}>
                Chọn nơi lưu và xuất
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
