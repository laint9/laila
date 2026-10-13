import { useState } from 'react'
import { timelineEvents, type SfxEvent } from '../audio/autosfx'
import {
  MUSIC_PRESETS,
  MUSIC_STYLE_LABELS,
  MUSIC_STYLES,
  NOTE_NAMES,
  normMusic,
  normSfx,
  SFX_DEFAULTS,
  SFX_KINDS,
  SFX_LABELS,
  type MusicSpec,
  type MusicStyle,
  type SfxKind,
  type SfxSpec
} from '../audio/spec'
import { bufferToWav, playBuffer, renderMusic, renderSfx, renderSfxTimeline, stopPlayback } from '../audio/synth'
import { useStore } from '../lib/store'
import { cleanError } from '../lib/pipeline'
import { projectDuration } from '../lib/timeline'
import { uid } from '../lib/media'
import { Icon } from './Icon'

/** Lưu buffer thành WAV, đưa vào Media và đặt lên track âm thanh */
async function addToTimeline(buf: AudioBuffer, name: string, start: number, trackId?: string) {
  const item = await window.laila.audio.save(name, bufferToWav(buf))
  const st = useStore.getState()
  st.addMedia([item])
  st.addToTrack(item.id, start, trackId)
  return item
}

export function SoundPanel(props: { apiReady: boolean; onNeedKey: () => void }) {
  const project = useStore((s) => s.project)
  const playhead = useStore((s) => s.playhead)
  const [playingId, setPlayingId] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // ---- Claude ----
  const [prompt, setPrompt] = useState('')
  const [kind, setKind] = useState<'auto' | 'sfx' | 'music'>('auto')
  const [designed, setDesigned] = useState<{ type: 'sfx' | 'music'; name: string; notes: string; spec: SfxSpec | MusicSpec } | null>(null)

  // ---- SFX ----
  const [sfxKind, setSfxKind] = useState<SfxKind>('whoosh')
  const [sfx, setSfx] = useState<SfxSpec>({ kind: 'whoosh', ...SFX_DEFAULTS.whoosh })

  // ---- Nhạc ----
  const projLen = Math.max(4, Math.round(projectDuration(project)) || 15)
  const [music, setMusic] = useState<MusicSpec>({ ...MUSIC_PRESETS.corporate, length: projLen })

  // ---- Auto SFX ----
  const [events, setEvents] = useState<SfxEvent[] | null>(null)

  const run = async (id: string, fn: () => Promise<void>) => {
    setBusy(id)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(cleanError((e as Error).message))
    } finally {
      setBusy(null)
    }
  }

  const preview = (id: string, render: () => Promise<AudioBuffer>) => {
    if (playingId === id) {
      stopPlayback()
      setPlayingId(null)
      return
    }
    run(id, async () => {
      const buf = await render()
      setPlayingId(id)
      playBuffer(buf, () => setPlayingId((p) => (p === id ? null : p)))
    })
  }

  const renderDesigned = () => (designed!.type === 'sfx' ? renderSfx(designed!.spec as SfxSpec) : renderMusic(designed!.spec as MusicSpec))

  const askClaude = () => {
    if (!props.apiReady) return props.onNeedKey()
    if (!prompt.trim()) return
    run('claude', async () => {
      const r = await window.laila.claude.sound(uid(), { prompt, kind, length: projLen })
      const spec = r.type === 'sfx' ? normSfx(r.spec) : normMusic(r.spec, projLen)
      setDesigned({ type: r.type, name: r.name, notes: r.notes, spec })
      // nghe luôn kết quả
      const buf = r.type === 'sfx' ? await renderSfx(spec as SfxSpec) : await renderMusic(spec as MusicSpec)
      setPlayingId('designed')
      playBuffer(buf, () => setPlayingId((p) => (p === 'designed' ? null : p)))
    })
  }

  const pickSfx = (k: SfxKind) => {
    setSfxKind(k)
    setSfx({ kind: k, ...SFX_DEFAULTS[k] })
  }

  const slider = (label: string, key: keyof Omit<SfxSpec, 'kind'>, min: number, max: number, step: number, unit = '') => (
    <label className="snd-slider">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={sfx[key]} onChange={(e) => setSfx({ ...sfx, [key]: +e.target.value })} />
      <small>
        {(+sfx[key]).toFixed(step < 0.1 ? 2 : 1)}
        {unit}
      </small>
    </label>
  )

  const setStyle = (style: MusicStyle) => setMusic({ ...MUSIC_PRESETS[style], length: music.length })

  return (
    <div className="panel-body sound-panel">
      {error && <div className="error">{error}</div>}

      <section className="snd-section">
        <div className="snd-title">
          <Icon name="sparkles" size={13} /> Tạo bằng mô tả
        </div>
        <textarea rows={2} placeholder="Vd: tiếng vút nhanh, sáng khi chữ bay vào · nhạc nền 20s sôi động kiểu công nghệ" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
        <div className="row">
          <div className="segmented">
            {(['auto', 'sfx', 'music'] as const).map((k) => (
              <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>
                {k === 'auto' ? 'Tự chọn' : k === 'sfx' ? 'Hiệu ứng' : 'Nhạc'}
              </button>
            ))}
          </div>
          <div className="spacer" />
          <button className="btn small primary" disabled={!prompt.trim() || busy === 'claude'} onClick={askClaude}>
            {busy === 'claude' ? 'Đang tạo…' : 'Tạo'}
          </button>
        </div>
        {designed && (
          <div className="snd-result">
            <div className="row">
              <button className="round-btn" title="Nghe" onClick={() => preview('designed', renderDesigned)}>
                <Icon name={playingId === 'designed' ? 'pause' : 'play'} size={12} />
              </button>
              <div className="snd-result-name">
                <b>{designed.name}</b>
                <small className="muted">{designed.type === 'sfx' ? SFX_LABELS[(designed.spec as SfxSpec).kind] : MUSIC_STYLE_LABELS[(designed.spec as MusicSpec).style]}</small>
              </div>
              <button
                className="btn small"
                disabled={busy === 'add-designed'}
                onClick={() => run('add-designed', async () => void (await addToTimeline(await renderDesigned(), designed.name, designed.type === 'music' ? 0 : playhead)))}
              >
                <Icon name="plus" size={12} /> Timeline
              </button>
            </div>
            {designed.notes && <div className="small muted">{designed.notes}</div>}
          </div>
        )}
      </section>

      <section className="snd-section">
        <div className="snd-title">
          <Icon name="wave" size={13} /> Hiệu ứng âm thanh
        </div>
        <div className="sfx-grid">
          {SFX_KINDS.map((k) => (
            <div key={k} className={'sfx-tile ' + (sfxKind === k ? 'on' : '')} onClick={() => pickSfx(k)}>
              <button
                className="round-btn"
                title="Nghe thử"
                onClick={(e) => {
                  e.stopPropagation()
                  pickSfx(k)
                  const spec = sfxKind === k ? sfx : { kind: k, ...SFX_DEFAULTS[k] }
                  preview('sfx-' + k, () => renderSfx(spec))
                }}
              >
                <Icon name={playingId === 'sfx-' + k ? 'pause' : 'play'} size={11} />
              </button>
              <span>{SFX_LABELS[k]}</span>
            </div>
          ))}
        </div>
        <div className="snd-edit">
          {slider('Độ dài', 'duration', 0.03, 4, 0.01, 's')}
          {slider('Cao độ', 'pitch', 0.5, 2, 0.05, '×')}
          {slider('Mạnh', 'intensity', 0, 1, 0.05)}
          {slider('Sáng', 'brightness', 0, 1, 0.05)}
          {slider('Vang', 'reverb', 0, 1, 0.05)}
          <div className="row">
            <button className="btn small" onClick={() => preview('sfx-edit', () => renderSfx(sfx))}>
              <Icon name={playingId === 'sfx-edit' ? 'pause' : 'play'} size={11} /> Nghe
            </button>
            <div className="spacer" />
            <button className="btn small primary" disabled={busy === 'add-sfx'} onClick={() => run('add-sfx', async () => void (await addToTimeline(await renderSfx(sfx), SFX_LABELS[sfx.kind].split(' (')[0], playhead)))}>
              <Icon name="plus" size={12} /> Thêm tại playhead
            </button>
          </div>
        </div>
      </section>

      <section className="snd-section">
        <div className="snd-title">
          <Icon name="music" size={13} /> Nhạc nền
        </div>
        <select value={music.style} onChange={(e) => setStyle(e.target.value as MusicStyle)}>
          {MUSIC_STYLES.map((s) => (
            <option key={s} value={s}>
              {MUSIC_STYLE_LABELS[s]}
            </option>
          ))}
        </select>
        <div className="snd-grid2">
          <label>
            Tempo
            <input type="number" min={60} max={180} value={music.bpm} onChange={(e) => setMusic({ ...music, bpm: Math.min(180, Math.max(60, +e.target.value || 100)) })} />
          </label>
          <label>
            Dài (s)
            <input type="number" min={2} max={300} value={Math.round(music.length)} onChange={(e) => setMusic({ ...music, length: Math.min(300, Math.max(2, +e.target.value || 10)) })} />
          </label>
          <label>
            Giọng
            <select value={music.key} onChange={(e) => setMusic({ ...music, key: e.target.value as MusicSpec['key'] })}>
              {NOTE_NAMES.map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
          <label>
            Điệu
            <select value={music.mode} onChange={(e) => setMusic({ ...music, mode: e.target.value as MusicSpec['mode'] })}>
              <option value="major">Trưởng (vui)</option>
              <option value="minor">Thứ (sâu lắng)</option>
            </select>
          </label>
        </div>
        <label className="snd-slider">
          <span>Năng lượng</span>
          <input type="range" min={0} max={1} step={0.05} value={music.energy} onChange={(e) => setMusic({ ...music, energy: +e.target.value })} />
          <small>{Math.round(music.energy * 100)}%</small>
        </label>
        <div className="chips">
          {(['pad', 'bass', 'arp', 'drums', 'lead'] as const).map((k) => (
            <button key={k} className={'chip ' + (music.instruments[k] ? 'on' : '')} onClick={() => setMusic({ ...music, instruments: { ...music.instruments, [k]: !music.instruments[k] } })}>
              {{ pad: 'Pad', bass: 'Bass', arp: 'Arp', drums: 'Trống', lead: 'Giai điệu' }[k]}
            </button>
          ))}
        </div>
        <div className="row">
          <button className="btn small" disabled={busy === 'music'} onClick={() => preview('music', () => renderMusic({ ...music, length: Math.min(music.length, 12) }))}>
            <Icon name={playingId === 'music' ? 'pause' : 'play'} size={11} /> {busy === 'music' ? 'Đang dựng…' : 'Nghe 12s đầu'}
          </button>
          <div className="spacer" />
          <button className="btn small primary" disabled={busy === 'add-music'} onClick={() => run('add-music', async () => void (await addToTimeline(await renderMusic(music), 'Nhạc ' + music.style, 0)))}>
            {busy === 'add-music' ? 'Đang dựng…' : 'Tạo & thêm'}
          </button>
        </div>
      </section>

      <section className="snd-section">
        <div className="snd-title">
          <Icon name="wand" size={13} /> Tự gắn SFX theo chuyển động
        </div>
        <p className="hint">Quét các scene trên timeline: chữ bay vào, hình bật lên, vật di chuyển nhanh, chuyển cảnh… rồi đặt whoosh / pop / swish đúng thời điểm vào một track âm thanh mới.</p>
        <div className="row">
          <button className="btn small" onClick={() => setEvents(timelineEvents(useStore.getState().project))}>
            Quét timeline
          </button>
          <div className="spacer" />
          <button
            className="btn small primary"
            disabled={!events?.length || busy === 'auto'}
            onClick={() =>
              run('auto', async () => {
                const len = projectDuration(useStore.getState().project)
                const buf = await renderSfxTimeline(events!, len)
                const st = useStore.getState()
                const tid = st.addTrack('audio')
                st.updateTrack(tid, { name: 'SFX tự động' }, false)
                await addToTimeline(buf, 'SFX tự động', 0, tid)
                setEvents(null)
              })
            }
          >
            {busy === 'auto' ? 'Đang dựng…' : `Tạo track SFX${events ? ` (${events.length})` : ''}`}
          </button>
        </div>
        {events && (
          <ul className="sfx-events">
            {events.length === 0 && <li className="muted">Chưa thấy chuyển động nào cần âm thanh (cần scene đã render nằm trên timeline).</li>}
            {events.map((e, i) => (
              <li key={i}>
                <span className="tc">{e.t.toFixed(2)}s</span> {SFX_LABELS[e.spec.kind].split(' (')[0]} <span className="muted">· {e.why}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
