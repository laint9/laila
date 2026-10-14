import { useState } from 'react'
import { useStore } from '../lib/store'
import { hasFiles, importDialog, importDropped } from '../lib/importer'
import { fmtTime, mediaUrl } from '../lib/media'
import { Icon } from './Icon'

export function MediaBin() {
  const media = useStore((s) => s.project.media)
  const append = useStore((s) => s.appendToTimeline)
  const remove = useStore((s) => s.removeMedia)
  const setPreview = useStore((s) => s.setPreview)

  const [over, setOver] = useState(false)
  const [busy, setBusy] = useState(false)

  const run = async (job: Promise<unknown>) => {
    setBusy(true)
    try {
      await job
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className={'panel-body media-bin' + (over ? ' file-over' : '')}
      onDragOver={(e) => {
        if (!hasFiles(e)) return
        e.preventDefault()
        e.stopPropagation()
        e.dataTransfer.dropEffect = 'copy'
        setOver(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false)
      }}
      onDrop={(e) => {
        if (!hasFiles(e)) return
        e.preventDefault()
        e.stopPropagation()
        setOver(false)
        run(importDropped([...e.dataTransfer.files]))
      }}
    >
      <div className="chip-buttons">
        <button className="btn small" onClick={() => run(importDialog('all'))}>
          <Icon name="plus" size={13} /> Nhập file
        </button>
        <button className="btn small" onClick={() => run(importDialog('video'))}>
          <Icon name="film" size={13} /> Video
        </button>
        <button className="btn small" onClick={() => run(importDialog('image'))}>
          <Icon name="image" size={13} /> Ảnh
        </button>
        <button className="btn small" onClick={() => run(importDialog('audio'))}>
          <Icon name="music" size={13} /> Âm thanh
        </button>
      </div>
      <p className="hint">{busy ? 'Đang nhập file…' : 'Kéo file từ Finder vào đây hoặc thả thẳng xuống timeline. Bấm + để thêm vào cuối.'}</p>
      <div className="media-grid">
        {media.map((m) => (
          <div
            key={m.id}
            className={'media-item kind-' + m.kind}
            draggable
            onDragStart={(e) => e.dataTransfer.setData('text/laila-media', m.id)}
            onClick={() => m.kind !== 'audio' && setPreview({ type: 'media', mediaId: m.id })}
            title={m.source ?? m.path}
          >
            <div className="thumb">
              {m.kind === 'audio' ? (
                <Icon name="music" size={26} />
              ) : m.kind === 'image' ? (
                <img src={mediaUrl(m.path)} alt="" draggable={false} />
              ) : (
                <video src={mediaUrl(m.path) + '#t=0.5'} muted preload="metadata" />
              )}
              <span className="dur">{m.kind === 'image' ? (m.source ? 'Vector' : 'Ảnh') : fmtTime(m.duration)}</span>
              <div className="media-actions">
                <button
                  title="Thêm vào timeline"
                  onClick={(e) => {
                    e.stopPropagation()
                    append(m.id)
                  }}
                >
                  <Icon name="plus" size={13} />
                </button>
                <button
                  title="Hiện trong Finder"
                  onClick={(e) => {
                    e.stopPropagation()
                    window.laila.file.reveal(m.source ?? m.path)
                  }}
                >
                  <Icon name="folder" size={13} />
                </button>
                <button
                  title="Xoá khỏi project"
                  onClick={(e) => {
                    e.stopPropagation()
                    remove(m.id)
                  }}
                >
                  <Icon name="trash" size={13} />
                </button>
              </div>
            </div>
            <div className="media-name" title={m.path}>
              {m.name}
            </div>
          </div>
        ))}
        {media.length === 0 && (
          <div className="drop-empty">
            <Icon name="plus" size={22} />
            <b>Kéo thả file vào đây</b>
            <span>Video (MP4, MOV, WebM), ảnh (PNG, JPG, WebP, GIF), vector (SVG, PDF, AI), âm thanh (MP3, WAV, M4A, AIFF)</span>
            <span>Clip render từ scene cũng nằm ở đây.</span>
          </div>
        )}
      </div>
    </div>
  )
}
