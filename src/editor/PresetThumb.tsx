// Hình thu nhỏ tự lặp cho nút hiệu ứng (giống CapCut): vẽ 1 layer mẫu bằng chính engine.
import { useEffect, useMemo, useRef } from 'react'
import { applyPreset, newShapeLayer, newTextLayer, type MotionPreset } from '../engine/edit'
import { defaultAnimator } from '../engine/normalize'
import { renderScene } from '../engine/render'
import type { Layer, MotionScene, TextPreset } from '../engine/types'
import { useLoopProgress } from '../lib/ticker'

const TW = 112
const TH = 64
const ASSETS = { width: TW, height: TH, fonts: {}, images: {} }

export function presetRange(group: 'in' | 'out' | 'loop' | 'text', l: Pick<Layer, 'in' | 'out'>, dur = 0.6): [number, number] {
  if (group === 'in') return [l.in, Math.min(l.out, l.in + dur + 0.5)]
  if (group === 'out') return [Math.max(l.in, l.out - dur - 0.5), l.out - 0.001]
  if (group === 'text') return [l.in, Math.min(l.out, l.in + 1.8)]
  return [l.in, Math.min(l.out, l.in + 2.5)]
}

export function groupOf(id: MotionPreset): 'in' | 'out' | 'loop' {
  if (id === 'fadeOut' || id === 'slideDownOut' || id === 'popOut' || id === 'blurOut') return 'out'
  if (id === 'wiggle' || id === 'float' || id === 'pulse' || id === 'clear') return 'loop'
  return 'in'
}

export function PresetThumb({ preset, text }: { preset?: MotionPreset; text?: { preset: TextPreset; unit: 'char' | 'word' | 'line'; stagger?: number } }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const { scene, range } = useMemo(() => {
    let layer: Layer
    if (text) {
      const t = newTextLayer(TW, TH, 2, 'Chữ đẹp', '')
      t.text = { ...t.text, size: 20, maxWidth: 0, animIn: { ...defaultAnimator(text.preset), unit: text.unit, stagger: text.stagger ?? defaultAnimator(text.preset).stagger } }
      layer = t
    } else {
      const s = newShapeLayer(TW, TH, 2, 'rect', '#0A84FF')
      if (s.type === 'shape') {
        s.shape = { ...s.shape, width: { v: 40 }, height: { v: 26 }, radius: 6 }
        if (preset === 'drawOn') s.shape = { ...s.shape, fill: null, stroke: '#0A84FF', strokeWidth: 3 }
      }
      layer = preset ? applyPreset(s, preset, TH * 3) : s
    }
    const sc: MotionScene = { background: '#1c1c1e', layers: [layer] }
    return { scene: sc, range: presetRange(text ? 'text' : groupOf(preset ?? 'fadeIn'), layer) }
  }, [preset, text?.preset, text?.unit, text?.stagger])

  const p = useLoopProgress(text ? 2000 : 1500, 0.3)
  useEffect(() => {
    const ctx = canvas.current?.getContext('2d')
    if (!ctx) return
    renderScene(ctx, scene, range[0] + (range[1] - range[0]) * p, ASSETS)
  }, [p, scene, range])

  return <canvas ref={canvas} width={TW} height={TH} className="preset-thumb" />
}
