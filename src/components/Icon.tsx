// Bộ icon nét mảnh kiểu SF Symbols (vẽ tay, không dùng font Apple)
const P: Record<string, string> = {
  play: 'M7 5v14l11-7z',
  pause: 'M7 5h3.5v14H7zM13.5 5H17v14h-3.5z',
  scissors:
    'M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm0 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8.1 7.9 20 18M8.1 16.1 20 6',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  copy: 'M8 8h11v12H8zM5 16V4h11',
  undo: 'M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  redo: 'm15 14 5-5-5-5M20 9H10a6 6 0 0 0 0 12h3',
  plus: 'M12 5v14M5 12h14',
  alignLeft: 'M4 6h16M4 10h10M4 14h16M4 18h10',
  alignCenter: 'M4 6h16M7 10h10M4 14h16M7 18h10',
  alignRight: 'M4 6h16M10 10h10M4 14h16M10 18h10',
  alignJustify: 'M4 6h16M4 10h16M4 14h16M4 18h10',
  shape: 'M4 4h9v9H4zM16.5 11a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9z',
  detach: 'M4 6h16v6H4zM6 16v2M9 15v4M12 16v2M15 14v6M18 16v2',
  sparkles: 'M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z',
  text: 'M5 6V4h14v2M12 4v16M9 20h6',
  rect: 'M4 6h16v12H4z',
  ellipse: 'M12 5c4.4 0 8 3.1 8 7s-3.6 7-8 7-8-3.1-8-7 3.6-7 8-7z',
  line: 'M5 19 19 5',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15.5 9.5a1.5 1.5 0 1 1 0-.01',
  code: 'm8 7-5 5 5 5M16 7l5 5-5 5M14 4l-4 16',
  eye: 'M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  eyeOff: 'M3 3l18 18M10.6 6.1A10 10 0 0 1 12 6c6.4 0 10 6 10 6a17 17 0 0 1-3.2 3.8M6.4 6.5C3.7 8.2 2 12 2 12s3.6 6 10 6a10 10 0 0 0 4.2-.9',
  lock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3',
  unlock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 6.8-1.2',
  pointer: 'M5 3l13 7-6 1.5L9 18z',
  diamond: 'M12 3l9 9-9 9-9-9z',
  stopwatch: 'M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM12 9v4l2.5 2M10 2h4M19 5l1.5 1.5',
  chevronL: 'M15 5l-7 7 7 7',
  chevronR: 'M9 5l7 7-7 7',
  chevronD: 'M5 9l7 7 7-7',
  back: 'M15 5l-7 7 7 7',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  share: 'M12 3v12M7 8l5-5 5 5M5 13v7h14v-7',
  film: 'M4 4h16v16H4zM8 4v16M16 4v16M4 8h4M4 12h4M4 16h4M16 8h4M16 12h4M16 16h4',
  music: 'M9 18V6l11-2v12M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  wand: 'M4 20 16 8M14 4v3M18 6h3M19 2l-1.5 1.5M17 10l1 1',
  magnet: 'M6 4v8a6 6 0 0 0 12 0V4h-4v8a2 2 0 0 1-4 0V4zM6 8h4M14 8h4',
  grid: 'M4 4h16v16H4zM9.3 4v16M14.7 4v16M4 9.3h16M4 14.7h16',
  safe: 'M3 5h18v14H3zM6 8h12v8H6z',
  loop: 'M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4',
  alignL: 'M4 3v18M8 7h12v4H8zM8 13h7v4H8z',
  alignCH: 'M12 3v18M6 7h12v4H6zM8.5 13h7v4h-7z',
  alignR: 'M20 3v18M4 7h12v4H4zM9 13h7v4H9z',
  alignT: 'M3 4h18M7 8h4v12H7zM13 8h4v7h-4z',
  alignCV: 'M3 12h18M7 6h4v12H7zM13 8.5h4v7h-4z',
  alignB: 'M3 20h18M7 4h4v12H7zM13 9h4v7h-4z',
  close: 'M6 6l12 12M18 6 6 18',
  speed: 'M12 21a9 9 0 1 1 9-9M12 12l5-4',
  transition: 'M3 5h8v14H3zM13 5h8v14h-8zM9 12h6M13 10l2 2-2 2',
  folder: 'M3 6h6l2 2h10v11H3z',
  doc: 'M6 3h9l4 4v14H6zM14 3v5h5',
  wave: 'M2 12h2l2-6 3 12 3-9 3 6 2-3h5'
}

export function Icon({ name, size = 16, fill = false, className }: { name: keyof typeof P | string; size?: number; fill?: boolean; className?: string }) {
  const d = P[name] ?? P.plus
  const solid = fill || name === 'play' || name === 'pause'
  return (
    <svg
      className={'icon-svg ' + (className ?? '')}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={solid ? 'currentColor' : 'none'}
      stroke={solid ? 'none' : 'currentColor'}
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={d} />
    </svg>
  )
}
