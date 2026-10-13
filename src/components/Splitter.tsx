import { useLayout, type LayoutKey } from '../lib/layout'

/**
 * Thanh kéo để co giãn khung. `dir` = hướng kéo làm khung TO ra:
 * 'right' (khung bên trái), 'left' (khung bên phải), 'up' (khung bên dưới).
 */
export function Splitter({ k, dir, className = '', style }: { k: LayoutKey; dir: 'left' | 'right' | 'up'; className?: string; style?: React.CSSProperties }) {
  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault()
    const start = useLayout.getState().sizes[k]
    const x0 = e.clientX
    const y0 = e.clientY
    document.body.classList.add(dir === 'up' ? 'resizing-v' : 'resizing-h')
    const move = (ev: PointerEvent) => {
      const d = dir === 'right' ? ev.clientX - x0 : dir === 'left' ? x0 - ev.clientX : y0 - ev.clientY
      useLayout.getState().set(k, start + d)
    }
    const up = () => {
      document.body.classList.remove('resizing-v', 'resizing-h')
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  return (
    <div
      className={'splitter ' + (dir === 'up' ? 'horizontal ' : 'vertical ') + className}
      style={style}
      onPointerDown={onPointerDown}
      onDoubleClick={() => useLayout.getState().reset(k)}
      title="Kéo để co giãn · bấm đúp để về mặc định"
    />
  )
}
