import { useStore } from '../lib/store'
import { fmtTime, mediaUrl } from '../lib/media'

export function MediaBin() {
  const media = useStore((s) => s.project.media)
  const addMedia = useStore((s) => s.addMedia)
  const append = useStore((s) => s.appendToTimeline)
  const remove = useStore((s) => s.removeMedia)
  const setPreview = useStore((s) => s.setPreview)

  const importKind = async (kind: 'video' | 'audio') => addMedia(await window.laila.media.import(kind))

  return (
    <div className="panel-body">
      <div className="add-row">
        <button onClick={() => importKind('video')}>+ Import video</button>
        <button onClick={() => importKind('audio')}>+ Nhạc nền</button>
      </div>
      <p className="hint">Kéo thả xuống timeline, hoặc bấm “+” để thêm vào cuối.</p>
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
              {m.kind === 'audio' ? (
                <span className="audio-icon">♪</span>
              ) : (
                <video src={mediaUrl(m.path) + '#t=0.5'} muted preload="metadata" />
              )}
              <span className="dur">{fmtTime(m.duration)}</span>
            </div>
            <div className="media-name" title={m.path}>
              {m.name}
            </div>
            <div className="media-actions">
              <button
                title="Thêm vào timeline"
                onClick={(e) => {
                  e.stopPropagation()
                  append(m.id)
                }}
              >
                +
              </button>
              <button
                title="Hiện trong Finder"
                onClick={(e) => {
                  e.stopPropagation()
                  window.laila.file.reveal(m.path)
                }}
              >
                ⌕
              </button>
              <button
                title="Xoá khỏi project"
                onClick={(e) => {
                  e.stopPropagation()
                  remove(m.id)
                }}
              >
                ×
              </button>
            </div>
          </div>
        ))}
        {media.length === 0 && <div className="empty">Clip Claude render xong sẽ hiện ở đây.</div>}
      </div>
    </div>
  )
}
