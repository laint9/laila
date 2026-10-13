// Mô phỏng chuyển cảnh bằng CSS (preview), khớp với ffmpeg xfade lúc xuất.
import type { CSSProperties } from 'react'
import type { TransitionKind } from '../../shared/types'

export const TRANSITIONS: { id: TransitionKind; label: string }[] = [
  { id: 'none', label: 'Không' },
  { id: 'fade', label: 'Mờ dần' },
  { id: 'dissolve', label: 'Hoà tan' },
  { id: 'fadeblack', label: 'Qua màu đen' },
  { id: 'fadewhite', label: 'Qua màu trắng' },
  { id: 'slideleft', label: 'Đẩy sang trái' },
  { id: 'slideup', label: 'Đẩy lên' },
  { id: 'wipeleft', label: 'Quét ngang' },
  { id: 'circleopen', label: 'Mở tròn' },
  { id: 'zoomin', label: 'Phóng to' }
]

/** Style của 2 clip trong lúc chuyển cảnh (xem trước gần giống bản xuất bằng ffmpeg xfade) */
export function transitionStyles(kind: TransitionKind, p: number): { out: CSSProperties; in: CSSProperties; overlay: number; overlayColor: string } {
  const r = { out: {} as CSSProperties, in: {} as CSSProperties, overlay: 0, overlayColor: '#000' }
  switch (kind) {
    case 'fade':
    case 'dissolve':
      r.in.opacity = p
      break
    case 'fadeblack':
    case 'fadewhite':
      r.overlayColor = kind === 'fadeblack' ? '#000' : '#fff'
      r.overlay = 1 - Math.abs(2 * p - 1)
      r.in.opacity = p < 0.5 ? 0 : 1
      break
    case 'slideleft':
      r.out.transform = `translateX(${-p * 100}%)`
      r.in.transform = `translateX(${(1 - p) * 100}%)`
      break
    case 'slideup':
      r.out.transform = `translateY(${-p * 100}%)`
      r.in.transform = `translateY(${(1 - p) * 100}%)`
      break
    case 'wipeleft':
      r.in.clipPath = `inset(0 0 0 ${(1 - p) * 100}%)`
      break
    case 'circleopen':
      r.in.clipPath = `circle(${p * 75}% at 50% 50%)`
      break
    case 'zoomin':
      r.out.transform = `scale(${1 + p * 0.6})`
      r.out.opacity = 1 - p
      r.in.opacity = p
      break
  }
  return r
}

