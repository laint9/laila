// Một vòng requestAnimationFrame dùng chung cho mọi hình thu nhỏ tự lặp (tránh mỗi nút một vòng).
import { useEffect, useState } from 'react'

type Fn = (now: number) => void
const subs = new Set<Fn>()
let raf = 0
const loop = (now: number) => {
  for (const f of subs) f(now)
  raf = subs.size ? requestAnimationFrame(loop) : 0
}

export function subscribeTick(f: Fn) {
  subs.add(f)
  if (!raf) raf = requestAnimationFrame(loop)
  return () => {
    subs.delete(f)
  }
}

/** Tiến độ 0..1 lặp theo chu kỳ (ms); `hold` = tỉ lệ thời gian dừng ở cuối mỗi vòng */
export function useLoopProgress(periodMs = 1600, hold = 0.35, active = true) {
  const [p, setP] = useState(0)
  useEffect(() => {
    if (!active) return
    const t0 = performance.now()
    return subscribeTick((now) => {
      const u = ((now - t0) % periodMs) / periodMs
      setP(Math.min(1, u / (1 - hold)))
    })
  }, [periodMs, hold, active])
  return p
}
