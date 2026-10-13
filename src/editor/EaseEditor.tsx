// Graph editor rút gọn kiểu plugin Flow: chỉnh đường cong cubic-bezier của keyframe đang chọn.
import { useRef } from 'react'
import { EASE_LABELS, easeFn, easeToBezier } from '../engine/ease'
import { setKeyEase, updateLayer, withProp } from '../engine/edit'
import type { Ease, EaseName } from '../engine/types'
import { propOf, useEditor } from './state'

const SIZE = 180
const PAD = 30

const QUICK: EaseName[] = ['linear', 'easyEase', 'easeOutCubic', 'easeOutExpo', 'easeInOutCubic', 'easeInOutExpo', 'easeOutBack', 'easeIn', 'easeOutElastic', 'easeOutBounce', 'hold']

export function EaseEditor() {
  const keys = useEditor((s) => s.keys)
  const scene = useEditor((s) => s.scene)
  const ed = useEditor.getState
  const svg = useRef<SVGSVGElement>(null)
  if (!keys.length) return null

  const first = keys[0]
  const p = propOf(scene, first)
  const k = p?.keys?.find((x) => Math.abs(x.t - first.t) < 1e-3)
  if (!k) return null
  const isLast = p!.keys![p!.keys!.length - 1] === k
  const ease = k.ease
  const bz = easeToBezier(ease)
  const fn = easeFn(ease)

  const apply = (e: Ease, history: boolean) =>
    ed().edit((sc) => {
      let out = sc
      for (const r of ed().keys) out = updateLayer(out, r.layerId, (l) => withProp(l, r.path, (pp) => setKeyEase(pp, r.t, e)))
      return out
    }, { history })

  // toạ độ graph: x 0..1 trái->phải, y 0..1 dưới->trên, có đệm để thấy overshoot
  const gx = (x: number) => PAD + x * (SIZE - PAD * 2)
  const gy = (y: number) => SIZE - PAD - y * (SIZE - PAD * 2)
  const pts: string[] = []
  for (let i = 0; i <= 60; i++) {
    const x = i / 60
    pts.push(`${gx(x)},${gy(fn(x))}`)
  }

  const dragHandle = (which: 1 | 2) => (e: React.PointerEvent) => {
    if (!bz) return
    e.preventDefault()
    ed().checkpoint()
    const rect = svg.current!.getBoundingClientRect()
    const move = (ev: PointerEvent) => {
      const x = Math.min(1, Math.max(0, ((ev.clientX - rect.left) * (SIZE / rect.width) - PAD) / (SIZE - PAD * 2)))
      const y = Math.min(2.5, Math.max(-1.5, (SIZE - PAD - (ev.clientY - rect.top) * (SIZE / rect.height)) / (SIZE - PAD * 2)))
      const cur = easeToBezier(ed().keys.length ? (propOf(ed().scene, ed().keys[0])?.keys?.find((x2) => Math.abs(x2.t - ed().keys[0].t) < 1e-3)?.ease ?? ease) : ease) ?? bz
      const r = (n: number) => Math.round(n * 100) / 100
      const next: [number, number, number, number] = which === 1 ? [r(x), r(y), cur[2], cur[3]] : [cur[0], cur[1], r(x), r(y)]
      apply(next, false)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div className="ease-editor">
      <div className="ease-head">
        Đường cong chuyển động <span className="muted">({keys.length} keyframe)</span>
      </div>
      {isLast && <div className="hint">Keyframe cuối không có đoạn phía sau. Chọn keyframe phía trước để chỉnh ease.</div>}
      <div className="ease-body">
        <svg ref={svg} viewBox={`0 0 ${SIZE} ${SIZE}`} className="ease-graph">
          <rect x={gx(0)} y={gy(1)} width={gx(1) - gx(0)} height={gy(0) - gy(1)} className="ease-frame" />
          <polyline points={pts.join(' ')} className="ease-curve" />
          {bz && (
            <>
              <line x1={gx(0)} y1={gy(0)} x2={gx(bz[0])} y2={gy(bz[1])} className="ease-arm" />
              <line x1={gx(1)} y1={gy(1)} x2={gx(bz[2])} y2={gy(bz[3])} className="ease-arm" />
              <circle cx={gx(bz[0])} cy={gy(bz[1])} r={7} className="ease-handle" onPointerDown={dragHandle(1)} />
              <circle cx={gx(bz[2])} cy={gy(bz[3])} r={7} className="ease-handle" onPointerDown={dragHandle(2)} />
            </>
          )}
        </svg>
        <div className="ease-presets">
          {QUICK.map((name) => (
            <button key={name} className={'ease-chip ' + (ease === name ? 'on' : '')} onClick={() => apply(name, true)}>
              <MiniCurve ease={name} />
              {EASE_LABELS[name]}
            </button>
          ))}
        </div>
      </div>
      <div className="muted small">
        {bz ? `cubic-bezier(${bz.join(', ')})` : EASE_LABELS[ease as EaseName]} · F9 = Easy Ease
      </div>
    </div>
  )
}

function MiniCurve({ ease }: { ease: Ease }) {
  const f = easeFn(ease)
  const pts: string[] = []
  for (let i = 0; i <= 20; i++) pts.push(`${2 + (i / 20) * 16},${16 - f(i / 20) * 12}`)
  return (
    <svg width="20" height="18" viewBox="0 0 20 18" className="mini-curve">
      <polyline points={pts.join(' ')} />
    </svg>
  )
}
