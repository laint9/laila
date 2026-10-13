import { useState } from 'react'
import { useStore } from '../lib/store'
import { cleanError, generateAll, planStoryboard, sendReadyScenesToTimeline } from '../lib/pipeline'
import { SceneCard } from './SceneCard'
import { Icon } from './Icon'

export function Studio(props: { apiReady: boolean; onNeedKey: () => void; onEdit: (sceneId: string) => void }) {
  const scenes = useStore((s) => s.project.scenes)
  const addScene = useStore((s) => s.addScene)
  const [brief, setBrief] = useState('')
  const [count, setCount] = useState(4)
  const [total, setTotal] = useState(16)
  const [planning, setPlanning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const guard = (fn: () => void) => () => (props.apiReady ? fn() : props.onNeedKey())

  const plan = guard(async () => {
    if (!brief.trim()) return
    setPlanning(true)
    setError(null)
    try {
      await planStoryboard(brief, count, total)
    } catch (e) {
      setError(cleanError((e as Error).message))
    } finally {
      setPlanning(false)
    }
  })

  const pending = scenes.filter((s) => s.prompt.trim() && (s.status === 'idle' || s.status === 'error') && !s.motion).length
  const ready = scenes.filter((s) => s.mediaId).length

  return (
    <div className="studio">
      <div className="storyboard card">
        <div className="card-title">
          <Icon name="sparkles" /> Lên kịch bản với Claude
        </div>
        <textarea
          rows={3}
          placeholder="Mô tả video tổng: mục tiêu, thông điệp, cảm xúc, nhịp. Vd: Video 15s giới thiệu app tài chính, mở bằng logo, 3 lợi ích chính, kết bằng CTA tải app."
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
        />
        <div className="sb-row">
          <label>
            Số scene
            <input type="number" min={1} max={12} value={count} onChange={(e) => setCount(+e.target.value || 1)} />
          </label>
          <label>
            Tổng
            <input type="number" min={2} max={180} value={total} onChange={(e) => setTotal(+e.target.value || 4)} />
            giây
          </label>
          <div className="spacer" />
          <button className="btn primary" disabled={planning || !brief.trim()} onClick={plan}>
            {planning ? 'Claude đang lên kịch bản…' : 'Chia thành scene'}
          </button>
        </div>
        {error && <div className="error">{error}</div>}
      </div>

      <div className="board-bar">
        <div className="section-title">
          Scenes <span className="count">{scenes.length}</span>
        </div>
        <div className="spacer" />
        <button className="btn" onClick={() => addScene()}>
          <Icon name="plus" /> Scene mới
        </button>
        <button className="btn" disabled={pending === 0} onClick={guard(generateAll)}>
          <Icon name="sparkles" /> Generate tất cả ({pending})
        </button>
        <button className="btn tinted" disabled={ready === 0} onClick={sendReadyScenesToTimeline}>
          <Icon name="film" /> Đưa lên timeline ({ready})
        </button>
      </div>

      <div className="board">
        {scenes.map((s, i) => (
          <SceneCard key={s.id} scene={s} index={i} apiReady={props.apiReady} onNeedKey={props.onNeedKey} onEdit={() => props.onEdit(s.id)} />
        ))}
        {scenes.length === 0 && (
          <div className="empty big">
            <Icon name="sparkles" size={28} />
            <p>Viết brief ở trên để Claude chia scene,</p>
            <p>hoặc bấm “Scene mới” để tự viết prompt hay tự dựng trong Motion Editor.</p>
          </div>
        )}
      </div>
    </div>
  )
}
