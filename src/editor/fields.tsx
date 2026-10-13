import { useEffect, useRef, useState } from 'react'
import { Icon } from '../components/Icon'
import { isAnimated, valueAt } from '../engine/ease'
import { getProp, hasKeyAt, nextKeyTime, setPropAt, toggleKeyAt, toggleStopwatch, withProp, type PropPath } from '../engine/edit'
import type { Layer, Prop } from '../engine/types'
import { useEditor } from './state'

/** Ô số kiểu AE: kéo chữ ngang để chỉnh nhanh (scrubby), bấm để gõ */
export function NumberField(props: {
  value: number
  onChange: (v: number, live: boolean) => void
  onStart?: () => void
  step?: number
  min?: number
  max?: number
  precision?: number
  suffix?: string
  width?: number
}) {
  const { value, step = 1, min = -1e9, max = 1e9, precision = 1, suffix } = props
  const [text, setText] = useState<string | null>(null)
  const clamp = (v: number) => Math.min(max, Math.max(min, v))
  const fmt = (v: number) => (Math.round(v * 10 ** precision) / 10 ** precision).toString()

  const onPointerDown = (e: React.PointerEvent) => {
    if (text !== null) return
    const x0 = e.clientX
    const v0 = value
    let moved = false
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - x0
      if (!moved && Math.abs(dx) < 3) return
      if (!moved) props.onStart?.()
      moved = true
      const mult = ev.shiftKey ? 10 : ev.altKey ? 0.1 : 1
      props.onChange(clamp(v0 + dx * step * mult), true)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      if (!moved) setText(fmt(value))
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const commit = () => {
    if (text === null) return
    const v = parseFloat(text.replace(',', '.'))
    setText(null)
    if (Number.isFinite(v)) {
      props.onStart?.()
      props.onChange(clamp(v), false)
    }
  }

  return text !== null ? (
    <input
      className="num-input"
      style={{ width: props.width ?? 64 }}
      autoFocus
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') setText(null)
        e.stopPropagation()
      }}
    />
  ) : (
    <span className="num-scrub" style={{ minWidth: props.width ?? 64 }} onPointerDown={onPointerDown} title="Kéo ngang để chỉnh (Shift: nhanh, Option: chậm). Bấm để gõ.">
      {fmt(value)}
      {suffix && <small>{suffix}</small>}
    </span>
  )
}

/** Một dòng thuộc tính có thể keyframe: đồng hồ, giá trị, điều hướng keyframe, wiggle */
export function PropRow(props: { layer: Layer; path: PropPath; label: string; step?: number; min?: number; max?: number; suffix?: string; precision?: number }) {
  const { layer, path } = props
  const time = useEditor((s) => s.time)
  const ed = useEditor.getState
  const p = getProp(layer, path)
  if (!p) return null
  const animated = isAnimated(p)
  const v = valueAt(p, time)
  const keyHere = hasKeyAt(p, time)
  const mod = (fn: (pp: Prop) => Prop, history = true) => ed().editLayer(layer.id, (l) => withProp(l, path, fn), { history })

  const go = (dir: 1 | -1) => {
    const t = nextKeyTime([p], time, dir)
    if (t !== null) ed().setTime(t)
  }

  return (
    <div className={'prop-row ' + (animated ? 'animated' : '')}>
      <button className={'sw ' + (animated ? 'on' : '')} title="Bật/tắt keyframe (stopwatch)" onClick={() => mod((pp) => toggleStopwatch(pp, time))}>
        <Icon name="stopwatch" size={14} />
      </button>
      <span className="prop-label">{props.label}</span>
      <NumberField
        value={v}
        step={props.step}
        min={props.min}
        max={props.max}
        suffix={props.suffix}
        precision={props.precision}
        onStart={() => ed().checkpoint()}
        onChange={(nv) => mod((pp) => setPropAt(pp, time, nv), false)}
      />
      <span className="key-nav">
        {animated && (
          <>
            <button className="tiny" onClick={() => go(-1)} title="Keyframe trước (J)">
              <Icon name="chevronL" size={12} />
            </button>
            <button className={'tiny key ' + (keyHere ? 'on' : '')} onClick={() => mod((pp) => toggleKeyAt(pp, time))} title="Thêm/xoá keyframe tại playhead">
              <Icon name="diamond" size={11} fill={keyHere} />
            </button>
            <button className="tiny" onClick={() => go(1)} title="Keyframe sau (K)">
              <Icon name="chevronR" size={12} />
            </button>
          </>
        )}
        <button
          className={'tiny wig ' + (p.wiggle ? 'on' : '')}
          title={p.wiggle ? `Wiggle ${p.wiggle.freq}/s, ${p.wiggle.amp} — bấm để tắt` : 'Thêm wiggle (rung ngẫu nhiên)'}
          onClick={() => mod((pp) => ({ ...pp, wiggle: pp.wiggle ? null : { freq: 2, amp: path.endsWith('rotation') ? 5 : path.endsWith('scale') ? 4 : 10 } }))}
        >
          ~
        </button>
      </span>
      {p.wiggle && (
        <div className="wiggle-row">
          wiggle
          <NumberField value={p.wiggle.freq} step={0.1} min={0} max={30} suffix="/s" width={44} onStart={() => ed().checkpoint()} onChange={(f) => mod((pp) => ({ ...pp, wiggle: { ...pp.wiggle!, freq: f } }), false)} />
          <NumberField value={p.wiggle.amp} step={0.5} suffix=" biên độ" width={70} onStart={() => ed().checkpoint()} onChange={(a) => mod((pp) => ({ ...pp, wiggle: { ...pp.wiggle!, amp: a } }), false)} />
        </div>
      )}
    </div>
  )
}

export function Section(props: { title: string; children: React.ReactNode; defaultOpen?: boolean; right?: React.ReactNode }) {
  const [open, setOpen] = useState(props.defaultOpen ?? true)
  return (
    <section className="insp-section">
      <header onClick={() => setOpen(!open)}>
        <Icon name={open ? 'chevronD' : 'chevronR'} size={12} />
        <span>{props.title}</span>
        <div className="spacer" />
        <span onClick={(e) => e.stopPropagation()}>{props.right}</span>
      </header>
      {open && <div className="insp-body">{props.children}</div>}
    </section>
  )
}

export function Segmented<T extends string>(props: { value: T; options: { value: T; label: React.ReactNode; title?: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="segmented">
      {props.options.map((o) => (
        <button key={o.value} title={o.title} className={o.value === props.value ? 'on' : ''} onClick={() => props.onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function ColorField(props: { value: string | null; onChange: (v: string | null) => void; allowNone?: boolean; swatches?: string[] }) {
  const ref = useRef<HTMLInputElement>(null)
  const [hex, setHex] = useState(props.value ?? '')
  useEffect(() => setHex(props.value ?? ''), [props.value])
  return (
    <div className="color-field">
      <button className="swatch" style={{ background: props.value ?? 'transparent' }} onClick={() => ref.current?.click()} title="Chọn màu">
        {!props.value && <span className="none-slash" />}
      </button>
      <input ref={ref} type="color" className="hidden-color" value={/^#[0-9a-f]{6}$/i.test(props.value ?? '') ? props.value! : '#ffffff'} onChange={(e) => props.onChange(e.target.value)} />
      <input
        className="hex"
        value={hex}
        placeholder={props.allowNone ? 'Không' : '#'}
        onChange={(e) => setHex(e.target.value)}
        onBlur={() => props.onChange(hex.trim() ? hex.trim() : props.allowNone ? null : props.value)}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      {props.swatches?.map((c) => (
        <button key={c} className="swatch small" style={{ background: c }} title={c} onClick={() => props.onChange(c)} />
      ))}
      {props.allowNone && props.value && (
        <button className="tiny" title="Bỏ màu" onClick={() => props.onChange(null)}>
          <Icon name="close" size={11} />
        </button>
      )}
    </div>
  )
}
