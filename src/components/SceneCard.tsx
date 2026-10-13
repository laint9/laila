import { useState } from 'react'
import type { Scene } from '../../shared/types'
import { useStore } from '../lib/store'
import { mediaUrl } from '../lib/media'
import { cancelScene, generateScene } from '../lib/pipeline'
import { CodeModal } from './CodeModal'

const STATUS: Record<Scene['status'], string> = {
  idle: 'Chưa generate',
  generating: 'Claude đang viết…',
  rendering: 'Đang render',
  ready: 'Xong',
  error: 'Lỗi'
}

export function SceneCard(props: { scene: Scene; index: number; apiReady: boolean; onNeedKey: () => void }) {
  const { scene } = props
  const elements = useStore((s) => s.project.elements)
  const media = useStore((s) => s.project.media.find((m) => m.id === scene.mediaId))
  const update = useStore((s) => s.updateScene)
  const remove = useStore((s) => s.removeScene)
  const move = useStore((s) => s.moveScene)
  const append = useStore((s) => s.appendToTimeline)
  const setPreview = useStore((s) => s.setPreview)
  const [refine, setRefine] = useState('')
  const [showCode, setShowCode] = useState(false)
  const busy = scene.status === 'generating' || scene.status === 'rendering'

  const run = (instruction?: string) => {
    if (!props.apiReady) return props.onNeedKey()
    generateScene(scene.id, { instruction })
    setRefine('')
  }

  const toggleEl = (id: string) => {
    const has = scene.elementIds.includes(id)
    update(scene.id, { elementIds: has ? scene.elementIds.filter((x) => x !== id) : [...scene.elementIds, id] })
  }

  return (
    <div className={'scene-card status-' + scene.status}>
      <div className="sc-head">
        <span className="sc-index">{props.index + 1}</span>
        <input className="sc-title" value={scene.title} onChange={(e) => update(scene.id, { title: e.target.value })} />
        <label className="sc-dur" title="Thời lượng (giây)">
          <input
            type="number"
            min={0.5}
            max={60}
            step={0.5}
            value={scene.duration}
            onChange={(e) => update(scene.id, { duration: Math.max(0.5, +e.target.value || 1) })}
          />
          s
        </label>
        <button className="icon" title="Lên" onClick={() => move(scene.id, -1)}>
          ↑
        </button>
        <button className="icon" title="Xuống" onClick={() => move(scene.id, 1)}>
          ↓
        </button>
        <button className="icon" title="Xoá scene" onClick={() => remove(scene.id)} disabled={busy}>
          ×
        </button>
      </div>

      <div
        className="sc-preview"
        onClick={() => media && setPreview({ type: 'media', mediaId: media.id })}
        title={media ? 'Bấm để xem lớn' : ''}
      >
        {media ? (
          <video
            src={mediaUrl(media.path)}
            muted
            loop
            preload="metadata"
            onMouseEnter={(e) => e.currentTarget.play()}
            onMouseLeave={(e) => {
              e.currentTarget.pause()
              e.currentTarget.currentTime = 0
            }}
          />
        ) : (
          <div className="sc-placeholder">{STATUS[scene.status]}</div>
        )}
        {busy && (
          <div className="sc-overlay">
            <div>{STATUS[scene.status]}</div>
            {scene.status === 'rendering' && (
              <div className="bar">
                <div style={{ width: `${Math.round((scene.progress ?? 0) * 100)}%` }} />
              </div>
            )}
          </div>
        )}
        {media && <span className="sc-version">v{scene.version}</span>}
      </div>

      <textarea
        className="sc-prompt"
        rows={4}
        placeholder="Mô tả motion graphic cho clip này: bố cục, chuyển động, element nào xuất hiện…"
        value={scene.prompt}
        onChange={(e) => update(scene.id, { prompt: e.target.value })}
      />

      {elements.length > 0 && (
        <div className="chips">
          {elements.map((e) => (
            <button
              key={e.id}
              className={'chip ' + (scene.elementIds.includes(e.id) ? 'on' : '')}
              onClick={() => toggleEl(e.id)}
              title={e.kind}
            >
              {e.kind === 'color' && <i style={{ background: e.value }} />}
              {e.name}
            </button>
          ))}
        </div>
      )}

      {scene.error && <div className="error">{scene.error}</div>}
      {scene.notes && !scene.error && <div className="notes">{scene.notes}</div>}

      <div className="sc-actions">
        {busy ? (
          <button onClick={() => cancelScene(scene.id)}>Huỷ</button>
        ) : (
          <button className="primary" disabled={!scene.prompt.trim()} onClick={() => run()}>
            {scene.code ? 'Generate lại' : 'Generate'}
          </button>
        )}
        <button disabled={!scene.code} onClick={() => setShowCode(true)}>
          Code
        </button>
        <div className="spacer" />
        <button disabled={!media} onClick={() => media && append(media.id)}>
          + Timeline
        </button>
      </div>

      {scene.code && (
        <div className="refine">
          <input
            placeholder="Sửa nhanh: chữ to hơn, đổi nền sang trắng, chậm lại…"
            value={refine}
            disabled={busy}
            onChange={(e) => setRefine(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && refine.trim() && run(refine.trim())}
          />
          <button disabled={busy || !refine.trim()} onClick={() => run(refine.trim())}>
            Sửa
          </button>
        </div>
      )}

      {showCode && <CodeModal scene={scene} onClose={() => setShowCode(false)} />}
    </div>
  )
}
