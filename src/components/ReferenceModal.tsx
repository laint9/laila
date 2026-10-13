import { useState } from 'react'
import type { ReferenceResult } from '../../shared/types'
import { useStore } from '../lib/store'
import { mediaUrl, uid } from '../lib/media'
import { cleanError, rerenderScene } from '../lib/pipeline'
import { normScene } from '../engine/normalize'
import { Icon } from './Icon'

const FEAS: Record<ReferenceResult['analysis']['feasibility'], { label: string; cls: string }> = {
  high: { label: 'Copy được gần như hoàn toàn', cls: 'ok' },
  partial: { label: 'Copy được một phần', cls: 'warn' },
  low: { label: 'Khó copy trong app', cls: 'bad' }
}
const REP = { yes: { icon: '✓', label: 'Làm được' }, approx: { icon: '≈', label: 'Gần giống' }, no: { icon: '✕', label: 'Không làm được' } }

/** Phân tích effect từ ảnh/video tham khảo và dựng scene tương tự bằng brand kit */
export function ReferenceModal(props: { onClose: () => void; onEdit: (sceneId: string) => void }) {
  const project = useStore((s) => s.project)
  const [path, setPath] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [reqId, setReqId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ReferenceResult | null>(null)
  const isImage = !!path && /\.(png|jpe?g|webp)$/i.test(path)

  const pick = async () => {
    const p = await window.laila.reference.pick()
    if (p) {
      setPath(p)
      setResult(null)
      setError(null)
    }
  }

  const analyze = async () => {
    if (!path) return
    const id = uid()
    setReqId(id)
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const r = await window.laila.reference.analyze(id, {
        path,
        note,
        elements: project.elements.filter((e) => e.kind !== 'image' || e.value),
        settings: project.settings
      })
      setResult(r)
    } catch (e) {
      setError(cleanError((e as Error).message))
    } finally {
      setBusy(false)
      setReqId(null)
    }
  }

  const createScene = (openEditor: boolean) => {
    if (!result?.scene) return
    const { width, height } = project.settings
    const s = useStore.getState().addScene({
      title: result.title,
      prompt: `Dựng theo reference: ${result.analysis.summary}${note ? `\nYêu cầu thêm: ${note}` : ''}`,
      duration: result.duration,
      motion: normScene(result.scene, result.duration, width, height),
      notes: result.notes
    })
    props.onClose()
    if (openEditor) props.onEdit(s.id)
    else rerenderScene(s.id)
  }

  const addPalette = () => {
    const st = useStore.getState()
    const existing = new Set(st.project.elements.filter((e) => e.kind === 'color').map((e) => e.value.toLowerCase()))
    for (const c of result?.analysis.palette ?? []) if (!existing.has(c.toLowerCase())) st.addElement('color', c)
  }

  return (
    <div className="modal-back" onMouseDown={() => !busy && props.onClose()}>
      <div className="modal reference" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Phân tích effect từ reference</h3>
          <div className="spacer" />
          <button className="tiny" onClick={props.onClose} disabled={busy}>
            <Icon name="close" />
          </button>
        </div>
        <div className="ref-body">
          <div className="ref-left">
            <div className="ref-drop" onClick={pick} title="Chọn ảnh / video / GIF tham khảo">
              {path ? (
                isImage ? (
                  <img src={mediaUrl(path)} alt="" />
                ) : (
                  <video src={mediaUrl(path)} muted loop autoPlay playsInline />
                )
              ) : (
                <div className="ref-empty">
                  <Icon name="film" size={26} />
                  <p>Chọn video, GIF hoặc ảnh có hiệu ứng anh muốn làm theo</p>
                </div>
              )}
            </div>
            {path && <div className="small muted ref-path">{path.split('/').pop()}</div>}
            <textarea
              rows={3}
              placeholder="Muốn lấy phần nào? Vd: chỉ lấy kiểu chữ chạy, giữ màu brand của mình…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <div className="row">
              <button className="btn" onClick={pick} disabled={busy}>
                <Icon name="folder" /> Chọn file
              </button>
              <div className="spacer" />
              {busy ? (
                <button className="btn" onClick={() => reqId && window.laila.claude.cancel(reqId)}>
                  Huỷ
                </button>
              ) : (
                <button className="btn primary" onClick={analyze} disabled={!path}>
                  <Icon name="sparkles" /> Phân tích
                </button>
              )}
            </div>
            <p className="hint">App trích tối đa 8 khung hình theo thứ tự thời gian rồi gửi Claude xem. Hiệu ứng chạy quá nhanh giữa 2 khung có thể bị bỏ sót.</p>
          </div>

          <div className="ref-right">
            {busy && (
              <div className="ref-busy">
                <div className="spinner dark" />
                Claude đang xem các khung hình và mổ xẻ hiệu ứng…
              </div>
            )}
            {error && <pre className="error">{error}</pre>}
            {!busy && !result && !error && <div className="empty">Kết quả phân tích sẽ hiện ở đây.</div>}
            {result && (
              <div className="ref-result">
                <div className={'feas ' + FEAS[result.analysis.feasibility].cls}>{FEAS[result.analysis.feasibility].label}</div>
                <p>{result.analysis.summary}</p>
                {result.analysis.feasibilityReason && <p className="muted">{result.analysis.feasibilityReason}</p>}
                <h4>Kỹ thuật trong reference</h4>
                <ul className="tech-list">
                  {result.analysis.techniques.map((t, i) => (
                    <li key={i}>
                      <span className={'rep rep-' + t.replicable} title={REP[t.replicable].label}>
                        {REP[t.replicable].icon}
                      </span>
                      <div>
                        <b>{t.name}</b>
                        <div className="muted">{t.detail}</div>
                      </div>
                    </li>
                  ))}
                </ul>
                {result.analysis.timing && (
                  <>
                    <h4>Nhịp</h4>
                    <p className="muted">{result.analysis.timing}</p>
                  </>
                )}
                {result.analysis.palette.length > 0 && (
                  <div className="row palette-row">
                    {result.analysis.palette.map((c) => (
                      <span key={c} className="swatch small" style={{ background: c }} title={c} />
                    ))}
                    <button className="btn small" onClick={addPalette}>
                      Thêm màu vào brand kit
                    </button>
                  </div>
                )}
                {result.analysis.tips.length > 0 && (
                  <>
                    <h4>Mẹo chỉnh thêm trong editor</h4>
                    <ul className="tips">
                      {result.analysis.tips.map((t, i) => (
                        <li key={i}>{t}</li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="modal-foot">
          <span className="small muted">{result ? `${result.frames} khung hình đã phân tích` : ''}</span>
          <div className="spacer" />
          <button className="btn" disabled={!result?.scene} onClick={() => createScene(true)}>
            <Icon name="wand" /> Tạo & mở editor
          </button>
          <button className="btn primary" disabled={!result?.scene} onClick={() => createScene(false)}>
            Tạo scene theo reference
          </button>
        </div>
      </div>
    </div>
  )
}
