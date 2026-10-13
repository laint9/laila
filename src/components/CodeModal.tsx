import { useEffect, useRef, useState } from 'react'
import type { Scene } from '../../shared/types'
import { useStore } from '../lib/store'
import { MotionSandbox } from '../lib/sandbox'
import { rerenderScene } from '../lib/pipeline'

/** Xem/sửa code Claude viết, preview trực tiếp trong sandbox, rồi render lại. */
export function CodeModal(props: { scene: Scene; onClose: () => void }) {
  const { scene } = props
  const settings = useStore((s) => s.project.settings)
  const allElements = useStore((s) => s.project.elements)
  const update = useStore((s) => s.updateScene)
  const [code, setCode] = useState(scene.code ?? '')
  const [t, setT] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const host = useRef<HTMLDivElement>(null)
  const sb = useRef<MotionSandbox | null>(null)
  const loadedRef = useRef(false)

  useEffect(() => {
    sb.current = new MotionSandbox(host.current!)
    return () => sb.current?.dispose()
  }, [])

  // nạp lại code (debounce khi gõ)
  useEffect(() => {
    const h = setTimeout(async () => {
      const elements = allElements.filter((e) => scene.elementIds.includes(e.id) && (e.kind !== 'image' || e.value))
      try {
        loadedRef.current = false
        await sb.current!.load({ code, duration: scene.duration, settings, elements })
        loadedRef.current = true
        await sb.current!.draw(t)
        setErr(null)
      } catch (e) {
        setErr((e as Error).message)
      }
    }, 350)
    return () => clearTimeout(h)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, settings, scene.duration])

  useEffect(() => {
    if (!loadedRef.current) return
    sb.current!.draw(t).then(
      () => setErr(null),
      (e) => setErr((e as Error).message)
    )
  }, [t])

  useEffect(() => {
    if (!playing) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = (now - last) / 1000
      last = now
      setT((x) => (x + dt) % scene.duration)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, scene.duration])

  const apply = () => {
    update(scene.id, { code })
    props.onClose()
    rerenderScene(scene.id)
  }

  return (
    <div className="modal-back" onMouseDown={props.onClose}>
      <div className="modal code-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <b>{scene.title}</b> · code motion graphic
          <div className="spacer" />
          <button className="icon" onClick={props.onClose}>
            ×
          </button>
        </div>
        <div className="code-body">
          <textarea className="code" spellCheck={false} value={code} onChange={(e) => setCode(e.target.value)} />
          <div className="code-preview">
            <div className="stage" style={{ aspectRatio: `${settings.width} / ${settings.height}` }} ref={host} />
            <div className="scrub">
              <button onClick={() => setPlaying(!playing)}>{playing ? '❚❚' : '▶'}</button>
              <input
                type="range"
                min={0}
                max={scene.duration}
                step={0.01}
                value={t}
                onChange={(e) => {
                  setPlaying(false)
                  setT(+e.target.value)
                }}
              />
              <span>{t.toFixed(2)}s</span>
            </div>
            {err && <pre className="error">{err}</pre>}
          </div>
        </div>
        <div className="modal-foot">
          <span className="hint">Sửa tay xong bấm “Render lại” để cập nhật clip.</span>
          <div className="spacer" />
          <button onClick={props.onClose}>Đóng</button>
          <button className="primary" disabled={!!err} onClick={apply}>
            Render lại
          </button>
        </div>
      </div>
    </div>
  )
}
