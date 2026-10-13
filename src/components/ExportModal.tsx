import { useEffect, useState } from 'react'
import { useStore } from '../lib/store'
import { totalDuration } from '../lib/timeline'
import { fmtTime } from '../lib/media'

export function ExportModal(props: { onClose: () => void }) {
  const project = useStore((s) => s.project)
  const [quality, setQuality] = useState<'draft' | 'high'>('high')
  const [progress, setProgress] = useState<number | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => window.laila.exporter.onProgress(setProgress), [])

  const run = async () => {
    const outPath = await window.laila.exporter.pick(project.name)
    if (!outPath) return
    setError(null)
    setDone(null)
    setProgress(0)
    const byId = new Map(project.media.map((m) => [m.id, m]))
    const music = project.music && byId.get(project.music.mediaId)
    try {
      await window.laila.exporter.run({
        outPath,
        settings: project.settings,
        quality,
        clips: project.timeline
          .filter((c) => byId.has(c.mediaId))
          .map((c) => {
            const m = byId.get(c.mediaId)!
            return { path: m.path, in: c.in, out: c.out, hasAudio: m.hasAudio, volume: c.volume }
          }),
        music: music ? { path: music.path, in: project.music!.in, volume: project.music!.volume } : undefined
      })
      setDone(outPath)
    } catch (e) {
      setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    } finally {
      setProgress(null)
    }
  }

  const running = progress !== null

  return (
    <div className="modal-back" onMouseDown={() => !running && props.onClose()}>
      <div className="modal export" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <b>Xuất video tổng</b>
          <div className="spacer" />
          {!running && (
            <button className="icon" onClick={props.onClose}>
              ×
            </button>
          )}
        </div>
        <p>
          {project.timeline.length} clip · {fmtTime(totalDuration(project.timeline))} · {project.settings.width}×
          {project.settings.height} @ {project.settings.fps}fps · MP4 (H.264 + AAC)
          {project.music ? ' · có nhạc nền' : ''}
        </p>
        <div className="row">
          <label>
            <input type="radio" checked={quality === 'high'} onChange={() => setQuality('high')} /> Chất lượng cao
          </label>
          <label>
            <input type="radio" checked={quality === 'draft'} onChange={() => setQuality('draft')} /> Nháp (nhanh)
          </label>
        </div>
        {running && (
          <div className="bar big">
            <div style={{ width: `${Math.round(progress! * 100)}%` }} />
          </div>
        )}
        {error && <pre className="error">{error}</pre>}
        {done && (
          <p className="ok">
            Đã xuất xong. <button onClick={() => window.laila.file.reveal(done)}>Mở trong Finder</button>
          </p>
        )}
        <div className="modal-foot">
          <div className="spacer" />
          {running ? (
            <button onClick={() => window.laila.exporter.cancel()}>Huỷ</button>
          ) : (
            <button className="primary" onClick={run} disabled={project.timeline.length === 0}>
              Chọn nơi lưu & xuất
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
