// Cửa sổ "Dựng theo nhạc": chọn video có sẵn + nhạc + thời lượng, app tự cắt ghép khớp beat.
import { useMemo, useState } from 'react'
import { useStore } from '../lib/store'
import { fmtTime, mediaUrl } from '../lib/media'
import { cleanError } from '../lib/pipeline'
import { runAutoEdit, type AutoEditResult } from '../lib/autoeditRun'
import { MUSIC_PRESETS, MUSIC_STYLE_LABELS, type MusicStyle } from '../audio/spec'
import type { Pace } from '../lib/autoedit'
import { Icon } from './Icon'

const NIGHTLIFE: MusicStyle[] = ['hiphop', 'oldschool', 'trap', 'club']
const DURATIONS = [15, 30, 45, 60]
const PACES: { id: Pace; label: string; hint: string }[] = [
  { id: 'auto', label: 'Theo nhạc', hint: 'Đoạn nhẹ cắt thưa, đoạn mạnh cắt dồn dập' },
  { id: 'beat', label: 'Mỗi beat', hint: 'Dồn dập, hợp trap / club' },
  { id: 'half', label: '2 beat', hint: 'Vừa, hợp hip hop' },
  { id: 'bar', label: 'Mỗi ô nhịp', hint: 'Thong thả, kể chuyện' }
]
const RATIOS = [
  { label: 'Giữ khung hiện tại', w: 0, h: 0 },
  { label: '9:16 Reels / TikTok', w: 1080, h: 1920 },
  { label: '4:5 Instagram feed', w: 1080, h: 1350 },
  { label: '1:1 vuông', w: 1080, h: 1080 },
  { label: '16:9 ngang', w: 1920, h: 1080 }
]

export function AutoEditModal(props: { onClose: () => void; apiReady: boolean }) {
  const media = useStore((s) => s.project.media)
  const settings = useStore((s) => s.project.settings)
  const hasTimeline = useStore((s) => s.project.timeline.length > 0)
  const videos = media.filter((m) => m.kind === 'video')
  const audios = media.filter((m) => m.kind === 'audio')

  const [sel, setSel] = useState<Set<string>>(() => new Set(videos.map((v) => v.id)))
  const [musicKind, setMusicKind] = useState<'media' | 'generate'>(audios.length ? 'media' : 'generate')
  const [musicId, setMusicId] = useState(audios[audios.length - 1]?.id ?? '')
  const [style, setStyle] = useState<MusicStyle>('hiphop')
  const [bpm, setBpm] = useState(MUSIC_PRESETS.hiphop.bpm)
  const [duration, setDuration] = useState(30)
  const [pace, setPace] = useState<Pace>('auto')
  const [musicStart, setMusicStart] = useState<'auto' | 'start'>('auto')
  const [useClaude, setUseClaude] = useState(props.apiReady)
  const [brief, setBrief] = useState('')
  const [ratio, setRatio] = useState(0)
  const [fill, setFill] = useState(true)
  const [sourceVolume, setSourceVolume] = useState(0)
  const [mode, setMode] = useState<'replace' | 'append'>('replace')
  const [step, setStep] = useState<{ msg: string; p?: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<AutoEditResult | null>(null)
  const [reqId, setReqId] = useState<string | null>(null)

  const total = useMemo(() => videos.filter((v) => sel.has(v.id)).reduce((s, v) => s + v.duration, 0), [videos, sel])
  const running = step !== null
  const canRun = sel.size > 0 && (musicKind === 'generate' || !!musicId) && duration >= 3

  const toggle = (id: string) =>
    setSel((s) => {
      const n = new Set(s)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })

  const run = async () => {
    setError(null)
    setResult(null)
    setStep({ msg: 'Bắt đầu…' })
    try {
      const st = useStore.getState()
      const r = RATIOS[ratio]
      st.setSettings({ ...(r.w ? { width: r.w, height: r.h } : {}), fill })
      const res = await runAutoEdit(
        {
          videoIds: [...sel],
          music: musicKind === 'generate' ? { kind: 'generate', style, bpm } : { kind: 'media', mediaId: musicId },
          duration,
          pace,
          musicStart,
          useClaude: useClaude && props.apiReady,
          brief,
          mode,
          sourceVolume
        },
        (msg, p) => setStep({ msg, p }),
        setReqId
      )
      setResult(res)
    } catch (e) {
      setError(cleanError((e as Error).message))
    } finally {
      setStep(null)
      setReqId(null)
    }
  }

  return (
    <div className="modal-back" onMouseDown={() => !running && props.onClose()}>
      <div className="modal autoedit" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Dựng theo nhạc</h3>
          <span className="muted small">Cắt ghép video có sẵn khớp beat, đúng thời lượng</span>
          <div className="spacer" />
          {!running && (
            <button className="tiny" onClick={props.onClose}>
              <Icon name="close" />
            </button>
          )}
        </div>

        <div className="ae-body">
          <section>
            <div className="ae-title">
              1. Video nguồn <span className="count">{sel.size}</span>
              <span className="muted small">{fmtTime(total)} tư liệu</span>
            </div>
            {videos.length === 0 ? (
              <div className="drop-empty">
                <b>Chưa có video</b>
                <span>Kéo thả video quay ở quán vào tab Media trước.</span>
              </div>
            ) : (
              <div className="ae-videos">
                {videos.map((v) => (
                  <label key={v.id} className={'ae-video' + (sel.has(v.id) ? ' on' : '')}>
                    <input type="checkbox" checked={sel.has(v.id)} onChange={() => toggle(v.id)} />
                    <video src={mediaUrl(v.path) + '#t=1'} muted preload="metadata" />
                    <span className="ae-vname">{v.name}</span>
                    <span className="dur">{fmtTime(v.duration)}</span>
                  </label>
                ))}
              </div>
            )}
          </section>

          <section className="ae-form">
            <div className="ae-title">2. Nhạc</div>
            <div className="segmented">
              <button className={musicKind === 'media' ? 'on' : ''} onClick={() => setMusicKind('media')} disabled={!audios.length}>
                Bài có sẵn {audios.length ? `(${audios.length})` : ''}
              </button>
              <button className={musicKind === 'generate' ? 'on' : ''} onClick={() => setMusicKind('generate')}>
                Tạo beat mới
              </button>
            </div>
            {musicKind === 'media' ? (
              <select value={musicId} onChange={(e) => setMusicId(e.target.value)}>
                {audios.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} · {fmtTime(a.duration)}
                  </option>
                ))}
              </select>
            ) : (
              <div className="row">
                <select
                  value={style}
                  onChange={(e) => {
                    const s = e.target.value as MusicStyle
                    setStyle(s)
                    setBpm(MUSIC_PRESETS[s].bpm)
                  }}
                >
                  {NIGHTLIFE.map((s) => (
                    <option key={s} value={s}>
                      {MUSIC_STYLE_LABELS[s]}
                    </option>
                  ))}
                </select>
                <label className="inline">
                  <input type="number" min={70} max={160} value={bpm} onChange={(e) => setBpm(Math.max(70, Math.min(160, +e.target.value || 90)))} /> BPM
                </label>
              </div>
            )}
            {musicKind === 'media' && (
              <div className="segmented">
                <button className={musicStart === 'auto' ? 'on' : ''} onClick={() => setMusicStart('auto')}>
                  Lấy đoạn sôi động nhất
                </button>
                <button className={musicStart === 'start' ? 'on' : ''} onClick={() => setMusicStart('start')}>
                  Từ đầu bài
                </button>
              </div>
            )}

            <div className="ae-title">3. Thời lượng & nhịp cắt</div>
            <div className="row">
              {DURATIONS.map((d) => (
                <button key={d} className={'chip' + (duration === d ? ' on' : '')} onClick={() => setDuration(d)}>
                  {d}s
                </button>
              ))}
              <label className="inline">
                <input type="number" min={3} max={600} value={duration} onChange={(e) => setDuration(Math.max(3, Math.min(600, +e.target.value || 30)))} /> giây
              </label>
            </div>
            <div className="segmented">
              {PACES.map((p) => (
                <button key={p.id} className={pace === p.id ? 'on' : ''} title={p.hint} onClick={() => setPace(p.id)}>
                  {p.label}
                </button>
              ))}
            </div>
            <span className="muted small">{PACES.find((p) => p.id === pace)!.hint}</span>

            <div className="ae-title">4. Khung hình</div>
            <div className="row">
              <select value={ratio} onChange={(e) => setRatio(+e.target.value)}>
                {RATIOS.map((r, i) => (
                  <option key={r.label} value={i}>
                    {i === 0 ? `${r.label} (${settings.width}×${settings.height})` : r.label}
                  </option>
                ))}
              </select>
              <label className="inline">
                <input type="checkbox" checked={fill} onChange={(e) => setFill(e.target.checked)} /> Lấp đầy khung
              </label>
            </div>

            <div className="ae-title">5. Chọn cảnh</div>
            <label className="inline">
              <input type="checkbox" checked={useClaude && props.apiReady} disabled={!props.apiReady} onChange={(e) => setUseClaude(e.target.checked)} />
              Claude xem và chấm từng cảnh {props.apiReady ? '' : '(cần API key)'}
            </label>
            {useClaude && props.apiReady && (
              <textarea rows={2} placeholder="Ưu tiên gì? Vd: nhiều cảnh DJ và đám đông giơ tay, có quầy bar pha chế, bỏ cảnh mờ" value={brief} onChange={(e) => setBrief(e.target.value)} />
            )}
            <label className="inline">
              Tiếng gốc của video
              <input type="range" min={0} max={1} step={0.05} value={sourceVolume} onChange={(e) => setSourceVolume(+e.target.value)} />
              <span className="muted small">{Math.round(sourceVolume * 100)}%</span>
            </label>
            {hasTimeline && (
              <div className="segmented">
                <button className={mode === 'replace' ? 'on' : ''} onClick={() => setMode('replace')}>
                  Thay timeline hiện tại
                </button>
                <button className={mode === 'append' ? 'on' : ''} onClick={() => setMode('append')}>
                  Thêm vào cuối
                </button>
              </div>
            )}
          </section>
        </div>

        {running && (
          <div className="ae-progress">
            <span>{step!.msg}</span>
            <div className="bar big">
              <div style={{ width: `${Math.round((step!.p ?? 0.9) * 100)}%` }} />
            </div>
          </div>
        )}
        {error && <pre className="error">{error}</pre>}
        {result && (
          <div className="ae-result">
            <b>
              Đã dựng {result.plan.slots.length} cảnh · {fmtTime(result.plan.duration)} · {Math.round(result.plan.bpm)} BPM
            </b>
            <span>
              Nhạc: {result.musicName}
              {result.plan.musicStart > 0 ? ` (từ ${fmtTime(result.plan.musicStart)})` : ''} · {result.shots} cảnh tìm được
              {result.rated ? ` · Claude chấm ${result.rated} cảnh` : ''}
            </span>
            {result.notes && <span className="muted">{result.notes}</span>}
            {result.warnings.map((w) => (
              <span key={w} className="warn-text">
                {w}
              </span>
            ))}
            <span className="muted small">Vạch xanh trên thước timeline là beat: kéo mép clip sẽ tự hít vào beat.</span>
          </div>
        )}

        <div className="modal-foot">
          <div className="spacer" />
          {running ? (
            <button className="btn" disabled={!reqId} onClick={() => reqId && window.laila.claude.cancel(reqId)}>
              Bỏ qua Claude
            </button>
          ) : (
            <>
              <button className="btn" onClick={props.onClose}>
                {result ? 'Xong' : 'Đóng'}
              </button>
              <button className="btn primary" disabled={!canRun} onClick={run}>
                <Icon name="sparkles" size={13} /> {result ? 'Dựng lại' : 'Dựng video'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
