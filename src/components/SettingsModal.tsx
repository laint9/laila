import { useState } from 'react'
import type { AppSettings } from '../../shared/types'
import { RESOLUTIONS, useStore } from '../lib/store'
import { rerenderScene } from '../lib/pipeline'

const MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (mặc định, cân bằng chất lượng/giá)' },
  { id: 'claude-fable-5-1', label: 'Claude Fable 5.1 (mạnh nhất, đắt nhất)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (nhanh, rẻ hơn)' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (nhanh nhất, cho nháp)' }
]

export function SettingsModal(props: { settings: AppSettings; onChange: (s: AppSettings) => void; onClose: () => void }) {
  const [key, setKey] = useState('')
  const [saving, setSaving] = useState(false)
  const settings = useStore((s) => s.project.settings)
  const setSettings = useStore((s) => s.setSettings)
  const scenes = useStore((s) => s.project.scenes)

  const saveKey = async () => {
    setSaving(true)
    props.onChange(await window.laila.settings.setKey(key))
    setKey('')
    setSaving(false)
  }

  const resIndex = RESOLUTIONS.findIndex((r) => r.width === settings.width && r.height === settings.height)
  const rendered = scenes.filter((s) => s.code)

  return (
    <div className="modal-back" onMouseDown={props.onClose}>
      <div className="modal settings" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <b>Settings</b>
          <div className="spacer" />
          <button className="icon" onClick={props.onClose}>
            ×
          </button>
        </div>

        <section>
          <h4>Claude API key</h4>
          <p className="hint">
            Trạng thái:{' '}
            {props.settings.keySource === 'stored'
              ? 'đã lưu trong Keychain'
              : props.settings.keySource === 'env'
                ? 'lấy từ biến môi trường ANTHROPIC_API_KEY'
                : 'chưa có key'}
            . Lấy key tại console.anthropic.com.
          </p>
          <div className="row">
            <input type="password" placeholder="sk-ant-…" value={key} onChange={(e) => setKey(e.target.value)} />
            <button className="primary" disabled={saving || !key.trim()} onClick={saveKey}>
              Lưu key
            </button>
            {props.settings.keySource === 'stored' && (
              <button onClick={async () => props.onChange(await window.laila.settings.setKey(''))}>Xoá key</button>
            )}
          </div>
        </section>

        <section>
          <h4>Model</h4>
          <select
            value={props.settings.model}
            onChange={async (e) => props.onChange(await window.laila.settings.setModel(e.target.value))}
          >
            {MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </section>

        <section>
          <h4>Khung hình project</h4>
          <div className="row">
            <select
              value={resIndex}
              onChange={(e) => {
                const r = RESOLUTIONS[+e.target.value]
                if (r) setSettings({ width: r.width, height: r.height })
              }}
            >
              {resIndex < 0 && <option value={-1}>Tuỳ chỉnh {settings.width}×{settings.height}</option>}
              {RESOLUTIONS.map((r, i) => (
                <option key={r.label} value={i}>
                  {r.label}
                </option>
              ))}
            </select>
            <select value={settings.fps} onChange={(e) => setSettings({ fps: +e.target.value })}>
              {[24, 25, 30, 60].map((f) => (
                <option key={f} value={f}>
                  {f} fps
                </option>
              ))}
            </select>
          </div>
          {rendered.length > 0 && (
            <p className="hint">
              Đổi khung hình sau khi đã render: các clip cũ vẫn giữ kích thước cũ (sẽ được scale khi xuất).{' '}
              <button onClick={() => rendered.forEach((s) => rerenderScene(s.id))}>
                Render lại {rendered.length} scene theo khung mới
              </button>
            </p>
          )}
        </section>
      </div>
    </div>
  )
}
