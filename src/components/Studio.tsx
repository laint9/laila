import { useState } from 'react'
import { useStore } from '../lib/store'
import { generateAll, planStoryboard, sendReadyScenesToTimeline } from '../lib/pipeline'
import { SceneCard } from './SceneCard'

export function Studio(props: { apiReady: boolean; onNeedKey: () => void }) {
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
      setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    } finally {
      setPlanning(false)
    }
  })

  const pending = scenes.filter((s) => s.prompt.trim() && (s.status === 'idle' || s.status === 'error')).length
  const ready = scenes.filter((s) => s.mediaId).length

  return (
    <div className="studio">
      <div className="storyboard">
        <div className="sb-title">Storyboard với Claude</div>
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
            Tổng (giây)
            <input type="number" min={2} max={180} value={total} onChange={(e) => setTotal(+e.target.value || 4)} />
          </label>
          <div className="spacer" />
          <button className="primary" disabled={planning || !brief.trim()} onClick={plan}>
            {planning ? 'Claude đang lên kịch bản…' : 'Chia thành scene'}
          </button>
        </div>
        {error && <div className="error">{error}</div>}
      </div>

      <div className="board-bar">
        <div className="board-title">
          Scenes <span className="count">{scenes.length}</span>
        </div>
        <div className="spacer" />
        <button onClick={() => addScene()}>+ Scene trống</button>
        <button disabled={pending === 0} onClick={guard(generateAll)}>
          Generate tất cả ({pending})
        </button>
        <button className="accent" disabled={ready === 0} onClick={sendReadyScenesToTimeline}>
          Đưa lên timeline ({ready})
        </button>
      </div>

      <div className="board">
        {scenes.map((s, i) => (
          <SceneCard key={s.id} scene={s} index={i} apiReady={props.apiReady} onNeedKey={props.onNeedKey} />
        ))}
        {scenes.length === 0 && (
          <div className="empty big">
            Viết brief ở trên để Claude chia scene, hoặc bấm “+ Scene trống” để tự viết prompt cho từng clip.
          </div>
        )}
      </div>
    </div>
  )
}
