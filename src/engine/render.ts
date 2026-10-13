// Engine vẽ scene layer lên canvas 2D. Dùng chung cho preview, editor và render ra file.
import { easeFn, valueAt } from './ease'
import type { Layer, MotionScene, TextAnimator, TextLayer, TransformProp } from './types'

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

export interface RenderAssets {
  width: number
  height: number
  /** tên brand font -> font family */
  fonts: Record<string, string>
  /** tên brand image -> ảnh */
  images: Record<string, CanvasImageSource & { width: number; height: number }>
  /** frame của layer code tại t (do sandbox vẽ) */
  codeFrames?: Map<string, CanvasImageSource>
}

const hash = (s: string) => {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h % 10000) / 7.3
}

export function tv(layer: Layer, p: TransformProp, t: number): number {
  return valueAt(layer.transform[p], t, hash(layer.id + p))
}

export const isActive = (l: Layer, t: number) => l.visible && t >= l.in && t < l.out

// ---------- text layout ----------

export function fontString(fonts: Record<string, string>, font: string, size: number, weight: number) {
  const fam = fonts[font] || font || Object.values(fonts)[0] || ''
  const stack = '-apple-system, "SF Pro Display", "Helvetica Neue", Arial, sans-serif'
  return `${Math.round(weight)} ${Math.max(1, size)}px ${fam ? `"${fam}", ` : ''}${stack}`
}

interface CharBox {
  ch: string
  x: number // tâm ký tự theo trục x, trong hộp layer
  y: number // tâm dòng
  w: number
  line: number
  word: number
}
export interface TextLayout {
  width: number
  height: number
  lineH: number
  lines: { text: string; x: number; y: number; width: number }[]
  chars: CharBox[]
  words: number
}

const layoutCache = new Map<string, TextLayout>()

export function layoutText(ctx: Ctx, l: TextLayer, tracking: number, fonts: Record<string, string>): TextLayout {
  const d = l.text
  const font = fontString(fonts, d.font, d.size, d.weight)
  const key = [d.content, font, tracking.toFixed(2), d.maxWidth, d.align, d.lineHeight].join('|')
  const hit = layoutCache.get(key)
  if (hit) return hit
  ctx.font = font
  const measure = (s: string) => (s ? ctx.measureText(s).width + tracking * Math.max(0, [...s].length - 1) : 0)

  const rawLines: string[] = []
  for (const para of d.content.split('\n')) {
    if (!d.maxWidth) {
      rawLines.push(para)
      continue
    }
    let line = ''
    for (const w of para.split(/\s+/).filter(Boolean)) {
      const test = line ? line + ' ' + w : w
      if (line && measure(test) > d.maxWidth) {
        rawLines.push(line)
        line = w
      } else line = test
    }
    rawLines.push(line)
  }
  const widths = rawLines.map(measure)
  const width = Math.max(d.maxWidth || 0, ...widths, 1)
  const lineH = d.size * d.lineHeight
  const lines = rawLines.map((text, i) => {
    const x = d.align === 'left' ? 0 : d.align === 'right' ? width - widths[i] : (width - widths[i]) / 2
    return { text, x, y: i * lineH + lineH / 2, width: widths[i] }
  })
  const chars: CharBox[] = []
  let word = 0
  let inWord = false
  lines.forEach((ln, li) => {
    const glyphs = [...ln.text]
    for (let i = 0; i < glyphs.length; i++) {
      const ch = glyphs[i]
      const space = /\s/.test(ch)
      if (space && inWord) {
        word++
        inWord = false
      } else if (!space) inWord = true
      const left = ctx.measureText(glyphs.slice(0, i).join('')).width + tracking * i
      const w = ctx.measureText(ch).width
      chars.push({ ch, x: ln.x + left + w / 2, y: ln.y, w, line: li, word })
    }
    if (inWord) {
      word++
      inWord = false
    }
  })
  const out: TextLayout = { width, height: lines.length * lineH, lineH, lines, chars, words: word }
  if (layoutCache.size > 400) layoutCache.clear()
  layoutCache.set(key, out)
  return out
}

// ---------- kích thước hộp layer ----------

export function layerBox(ctx: Ctx, l: Layer, t: number, a: RenderAssets): { w: number; h: number } {
  switch (l.type) {
    case 'text': {
      const lay = layoutText(ctx, l, valueAt(l.text.tracking, t), a.fonts)
      return { w: lay.width, h: lay.height }
    }
    case 'image': {
      const img = a.images[l.image.src]
      const ratio = img && img.width ? img.height / img.width : 1
      return { w: l.image.width, h: l.image.width * ratio }
    }
    case 'shape':
      return { w: Math.max(0, valueAt(l.shape.width, t)), h: Math.max(0, valueAt(l.shape.height, t)) }
    case 'code':
      return { w: a.width, h: a.height }
  }
}

/** Ma trận "gốc" của layer (tại điểm neo) — layer con dùng ma trận này của cha */
function baseMatrix(l: Layer, t: number, byId: Map<string, Layer>, depth = 0): DOMMatrix {
  const parent = l.parent && depth < 30 ? byId.get(l.parent) : undefined
  const m = parent ? baseMatrix(parent, t, byId, depth + 1) : new DOMMatrix()
  const s = tv(l, 'scale', t) / 100
  return m.translate(tv(l, 'x', t), tv(l, 'y', t)).rotate(tv(l, 'rotation', t)).scale(s, s)
}

export function layerMatrix(ctx: Ctx, scene: MotionScene, l: Layer, t: number, a: RenderAssets): { m: DOMMatrix; w: number; h: number } {
  const byId = new Map(scene.layers.map((x) => [x.id, x]))
  const { w, h } = layerBox(ctx, l, t, a)
  const m = baseMatrix(l, t, byId).translate(-l.anchor[0] * w, -l.anchor[1] * h)
  return { m, w, h }
}

// ---------- text animator ----------

function unitRanks(n: number, order: TextAnimator['order'], seed: number): number[] {
  const idx = [...Array(n).keys()]
  if (order === 'reverse') return idx.map((i) => n - 1 - i)
  if (order === 'center') {
    const c = (n - 1) / 2
    return idx.map((i) => Math.round(Math.abs(i - c)))
  }
  if (order === 'random') {
    const r = idx.map((i) => {
      const x = Math.sin((i + 1) * 12.9898 + seed) * 43758.5453
      return x - Math.floor(x)
    })
    const sorted = idx.slice().sort((a, b) => r[a] - r[b])
    const ranks = new Array(n)
    sorted.forEach((u, rank) => (ranks[u] = rank))
    return ranks
  }
  return idx
}

function animProgress(a: TextAnimator | null, n: number, t: number, l: Layer, dir: 'in' | 'out'): number[] | null {
  if (!a || n === 0) return null
  const ranks = unitRanks(n, a.order, hash(l.id))
  const maxRank = Math.max(...ranks)
  const ease = easeFn(a.ease)
  return ranks.map((r) => {
    if (dir === 'in') {
      const start = l.in + a.delay + r * a.stagger
      return ease(Math.min(1, Math.max(0, (t - start) / a.duration)))
    }
    const total = maxRank * a.stagger + a.duration
    const start = l.out - a.delay - total + r * a.stagger
    return 1 - ease(Math.min(1, Math.max(0, (t - start) / a.duration)))
  })
}

function drawText(ctx: Ctx, l: TextLayer, t: number, a: RenderAssets) {
  const d = l.text
  const tracking = valueAt(d.tracking, t)
  const lay = layoutText(ctx, l, tracking, a.fonts)
  ctx.font = fontString(a.fonts, d.font, d.size, d.weight)
  ctx.fillStyle = d.color
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'

  const unitOf = (c: CharBox, i: number, anim: TextAnimator) =>
    anim.unit === 'char' ? i : anim.unit === 'word' ? c.word : c.line
  const nUnits = (anim: TextAnimator | null) =>
    !anim ? 0 : anim.unit === 'char' ? lay.chars.length : anim.unit === 'word' ? lay.words : lay.lines.length
  const pin = animProgress(d.animIn, nUnits(d.animIn), t, l, 'in')
  const pout = animProgress(d.animOut, nUnits(d.animOut), t, l, 'out')

  const settled = (!pin || pin.every((k) => k >= 1)) && (!pout || pout.every((k) => k >= 1))
  if (settled && Math.abs(tracking) < 0.01) {
    for (const ln of lay.lines) ctx.fillText(ln.text, ln.x, ln.y)
    return
  }

  const baseAlpha = ctx.globalAlpha
  const baseFilter = ctx.filter
  lay.chars.forEach((c, i) => {
    if (/\s/.test(c.ch)) return
    let alpha = 1,
      dx = 0,
      dy = 0,
      sc = 1,
      rot = 0,
      blur = 0,
      mask = false
    const apply = (anim: TextAnimator | null, prog: number[] | null) => {
      if (!anim || !prog) return
      const k = prog[unitOf(c, i, anim)] ?? 1
      if (k >= 1) return
      const dist = anim.distance * d.size
      switch (anim.preset) {
        case 'fade':
          alpha *= k
          break
        case 'slideUp':
          dy += (1 - k) * dist
          alpha *= k
          break
        case 'slideDown':
          dy -= (1 - k) * dist
          alpha *= k
          break
        case 'slideLeft':
          dx += (1 - k) * dist
          alpha *= k
          break
        case 'scale':
          sc *= Math.max(0, k)
          alpha *= Math.min(1, k * 2)
          break
        case 'blur':
          blur += (1 - k) * d.size * 0.25
          alpha *= k
          break
        case 'typewriter':
          alpha *= k >= 0.5 ? 1 : 0
          break
        case 'rotate':
          rot += (1 - k) * -40
          dy += (1 - k) * dist * 0.5
          alpha *= k
          break
        case 'mask':
          mask = true
          dy += (1 - k) * lay.lineH * 1.05
          break
      }
    }
    apply(d.animIn, pin)
    apply(d.animOut, pout)
    if (alpha <= 0.001 || sc <= 0.001) return
    ctx.save()
    if (mask) {
      const ln = lay.lines[c.line]
      ctx.beginPath()
      ctx.rect(-d.size, ln.y - lay.lineH / 2, lay.width + d.size * 2, lay.lineH)
      ctx.clip()
    }
    ctx.globalAlpha = baseAlpha * Math.min(1, alpha)
    if (blur > 0.1) ctx.filter = (baseFilter && baseFilter !== 'none' ? baseFilter + ' ' : '') + `blur(${blur.toFixed(1)}px)`
    ctx.translate(c.x + dx, c.y + dy)
    if (rot) ctx.rotate((rot * Math.PI) / 180)
    if (sc !== 1) ctx.scale(sc, sc)
    ctx.fillText(c.ch, -c.w / 2, 0)
    ctx.restore()
  })
}

// ---------- shape ----------

function drawShape(ctx: Ctx, l: Extract<Layer, { type: 'shape' }>, t: number, w: number, h: number) {
  const s = l.shape
  const trim = Math.min(100, Math.max(0, valueAt(s.trimEnd, t))) / 100
  ctx.beginPath()
  let perimeter = 0
  if (s.kind === 'ellipse') {
    ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, -Math.PI / 2, Math.PI * 1.5)
    const a = w / 2,
      b = h / 2
    perimeter = Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)))
  } else if (s.kind === 'line') {
    ctx.moveTo(0, h / 2)
    ctx.lineTo(w, h / 2)
    perimeter = w
  } else {
    const r = Math.min(s.radius, w / 2, h / 2)
    if (r > 0) ctx.roundRect(0, 0, w, h, r)
    else ctx.rect(0, 0, w, h)
    perimeter = 2 * (w + h)
  }
  if (s.fill && s.kind !== 'line') {
    ctx.fillStyle = s.fill
    ctx.fill()
  }
  if (s.stroke && s.strokeWidth > 0 && trim > 0) {
    ctx.strokeStyle = s.stroke
    ctx.lineWidth = s.strokeWidth
    ctx.lineCap = s.kind === 'line' ? 'round' : 'butt'
    if (trim < 1) ctx.setLineDash([perimeter * trim, perimeter + 1])
    ctx.stroke()
    ctx.setLineDash([])
  }
}

// ---------- scene ----------

const BLEND: Record<Layer['blend'], GlobalCompositeOperation> = {
  normal: 'source-over',
  multiply: 'multiply',
  screen: 'screen',
  add: 'lighter',
  overlay: 'overlay'
}

export function renderScene(ctx: Ctx, scene: MotionScene, t: number, a: RenderAssets) {
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalAlpha = 1
  ctx.filter = 'none'
  ctx.globalCompositeOperation = 'source-over'
  if (scene.background) {
    ctx.fillStyle = scene.background
    ctx.fillRect(0, 0, a.width, a.height)
  } else ctx.clearRect(0, 0, a.width, a.height)
  ctx.restore()

  for (let i = scene.layers.length - 1; i >= 0; i--) {
    const l = scene.layers[i]
    if (!isActive(l, t)) continue
    const opacity = Math.min(100, Math.max(0, tv(l, 'opacity', t))) / 100
    if (opacity <= 0) continue
    const { m, w, h } = layerMatrix(ctx, scene, l, t, a)
    ctx.save()
    ctx.setTransform(m)
    ctx.globalAlpha = opacity
    ctx.globalCompositeOperation = BLEND[l.blend]
    const blur = tv(l, 'blur', t)
    if (blur > 0.05) ctx.filter = `blur(${blur.toFixed(2)}px)`
    switch (l.type) {
      case 'text':
        drawText(ctx, l, t, a)
        break
      case 'shape':
        drawShape(ctx, l, t, w, h)
        break
      case 'image': {
        const img = a.images[l.image.src]
        if (img) ctx.drawImage(img, 0, 0, w, h)
        break
      }
      case 'code': {
        const frame = a.codeFrames?.get(l.id)
        if (frame) ctx.drawImage(frame, 0, 0, w, h)
        break
      }
    }
    ctx.restore()
  }
}

// ---------- tiện ích cho editor ----------

export function layerCorners(ctx: Ctx, scene: MotionScene, l: Layer, t: number, a: RenderAssets) {
  const { m, w, h } = layerMatrix(ctx, scene, l, t, a)
  const hh = l.type === 'shape' && l.shape.kind === 'line' ? Math.max(h, l.shape.strokeWidth) : h
  const oy = hh === h ? 0 : (h - hh) / 2
  const pts = [
    [0, oy],
    [w, oy],
    [w, oy + hh],
    [0, oy + hh]
  ].map(([x, y]) => m.transformPoint(new DOMPoint(x, y)))
  const anchor = m.transformPoint(new DOMPoint(l.anchor[0] * w, l.anchor[1] * h))
  return { pts, anchor, m, w, h }
}

/** Layer trên cùng tại điểm (toạ độ composition) */
export function hitTest(ctx: Ctx, scene: MotionScene, t: number, a: RenderAssets, x: number, y: number): Layer | null {
  for (const l of scene.layers) {
    if (!isActive(l, t) || l.locked || l.type === 'code') continue
    const { m, w, h } = layerMatrix(ctx, scene, l, t, a)
    const p = m.inverse().transformPoint(new DOMPoint(x, y))
    const pad = l.type === 'shape' && l.shape.kind === 'line' ? Math.max(12, l.shape.strokeWidth) : 6
    if (p.x >= -pad && p.x <= w + pad && p.y >= -pad && p.y <= h + pad) return l
  }
  return null
}

/** Toạ độ "gốc" mà x/y của layer sống trong đó (để kéo chuột đổi ra giá trị x/y) */
export function parentSpace(scene: MotionScene, l: Layer, t: number): DOMMatrix {
  if (!l.parent) return new DOMMatrix()
  const byId = new Map(scene.layers.map((x) => [x.id, x]))
  const p = byId.get(l.parent)
  return p ? baseMatrix(p, t, byId) : new DOMMatrix()
}
