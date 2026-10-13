import { useStore } from '../lib/store'
import { fmtTime, mediaUrl } from '../lib/media'
import { Icon } from './Icon'

export function MediaBin() {
  const media = useStore((s) => s.project.media)
  const addMedia = useStore((s) => s.addMedia)
  const append = useStore((s) => s.appendToTimeline)
  const remove = useStore((s) => s.removeMedia)
  const setPreview = useStore((s) => s.setPreview)

  const importKind = async (kind: 'video' | 'audio') => addMedia(await window.laila.media.import(kind))

  return (
    <div className="panel-body">
      <div className="chip-buttons">
        <button className="btn small" onClick={() => importKind('video')}>
          <Icon name="film" size={13} /> Nhập video
        </button>
        <button className="btn small" onClick={() => importKind('audio')}>
          <Icon name="music" size={13} /> Nhạc nền
        </button>
      </div>
      <p className="hint">Kéo xuống timeline hoặc bấm + để thêm vào cuối.</p>
      <div className="media-grid">
        {media.map((m) => (
          <div
            key={m.id}
            className={'media-item kind-' + m.kind}
            draggable
            onDragStart={(e) => e.dataTransfer.setData('text/laila-media', m.id)}
            onClick={() => m.kind !== 'audio' && setPreview({ type: 'media', mediaId: m.id })}
          >
            <div className="thumb">
              {m.kind === 'audio' ? <Icon name="music" size={26} /> : <video src={mediaUrl(m.path) + '#t=0.5'} muted preload="metadata" />}
              <span className="dur">{fmtTime(m.duration)}</span>
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
                    window.laila.file.reveal(m.path)
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
        {media.length === 0 && <div className="empty">Clip render xong sẽ nằm ở đây.</div>}
      </div>
    </div>
  )
}
