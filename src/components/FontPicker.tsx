import { useEffect, useMemo, useRef, useState } from 'react'
import { useFonts } from '../lib/fonts'
import { Icon } from './Icon'

/**
 * Ô chọn font: tìm kiếm, xem trước bằng chính font đó, font brand kit nằm trên cùng.
 * value là tên font family (hoặc tên brand font element nếu chọn từ brand kit).
 */
export function FontPicker(props: {
  value: string
  onChange: (v: string) => void
  brand?: { name: string; family: string }[]
  placeholder?: string
  /** family để hiển thị xem trước khi value là tên brand font */
  previewFamily?: string
}) {
  const { families, system, loading, refresh } = useFonts()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const box = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setTimeout(() => search.current?.focus(), 0)
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false)
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])

  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    return (s ? families.filter((f) => f.family.toLowerCase().includes(s)) : families).slice(0, 400)
  }, [families, q])

  const pick = (v: string) => {
    props.onChange(v)
    setOpen(false)
    setQ('')
  }

  const shown = props.previewFamily || props.value

  return (
    <div className="font-picker" ref={box}>
      <button className="fp-current" onClick={() => setOpen(!open)} title="Chọn font">
        <span style={{ fontFamily: shown ? `"${shown}"` : undefined }}>{props.value || props.placeholder || 'Font hệ thống'}</span>
        <Icon name="chevronD" size={11} />
      </button>
      {open && (
        <div className="fp-pop">
          <div className="fp-search">
            <input ref={search} placeholder={`Tìm trong ${families.length} font…`} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
            <button className="tiny" title="Quét lại font trong máy" onClick={() => refresh()}>
              <Icon name="loop" size={13} className={loading ? 'spin' : ''} />
            </button>
          </div>
          <div className="fp-list">
            {props.brand && props.brand.length > 0 && !q && (
              <>
                <div className="fp-group">Brand kit</div>
                {props.brand.map((b) => (
                  <button key={'b' + b.name} className={'fp-item ' + (props.value === b.name ? 'on' : '')} onClick={() => pick(b.name)}>
                    <span style={{ fontFamily: `"${b.family}"` }}>{b.family}</span>
                    <small>{b.name}</small>
                  </button>
                ))}
                <div className="fp-group">Font trong máy</div>
              </>
            )}
            {list.map((f) => (
              <button key={f.family} className={'fp-item ' + (props.value === f.family ? 'on' : '')} onClick={() => pick(f.family)} title={f.styles.join(', ')}>
                <span style={{ fontFamily: `"${f.family}"` }}>{f.family}</span>
                {f.styles.length > 1 && <small>{f.styles.length} kiểu</small>}
              </button>
            ))}
            {list.length === 0 && (
              <button className="fp-item" onClick={() => pick(q.trim())}>
                Dùng “{q.trim()}”
              </button>
            )}
          </div>
          <div className="fp-foot">{system ? `${families.length} font · tự cập nhật khi cài font mới` : 'Chưa đọc được font hệ thống, đang dùng danh sách mặc định'}</div>
        </div>
      )}
    </div>
  )
}
