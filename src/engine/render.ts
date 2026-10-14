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

export function fontString(fonts: Record<string, string>, font: string, size: number, weight: number, italic = false) {
  const fam = fonts[font] || font || Object.values(fonts)[0] || ''
  const stack = '-apple-system, "SF Pro Display", "Helvetica Neue", Arial, sans-serif'
  return `${italic ? 'italic ' : ''}${Math.round(weight)} ${Math.max(1, size)}px ${fam ? `"${fam}", ` : ''}${stack}`
}

/** lề của hộp nền chữ (0 nếu không có nền) */
export const textPad = (d: TextLayer['text']) => (d.box ? Math.max(0, d.box.padding) : 0)

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
  lines: { text: string; x: number; y: number; width: number; justify: number }[]
  chars: CharBox[]
  words: number
  justified: boolean
}

const layoutCache = new Map<string, TextLayout>()

export function layoutText(ctx: Ctx, l: TextLayer, tracking: number, fonts: Record<string, string>): TextLayout {
  const d = l.text
  const font = fontString(fonts, d.font, d.size, d.weight, d.italic)
  const content = d.uppercase ? d.content.toLocaleUpperCase('vi') : d.content
  const indent = Math.max(0, d.indent ?? 0)
  const paraGap = Math.max(0, d.paraSpacing ?? 0) * d.size
  const key = [content, font, tracking.toFixed(2), d.maxWidth, d.align, d.lineHeight, indent, paraGap].join('|')
  const hit = layoutCache.get(key)
  if (hit) return hit
  ctx.font = font
  const measure = (s: string) => (s ? ctx.measureText(s).width + tracking * Math.max(0, [...s].length - 1) : 0)

  // mỗi dòng nhớ đoạn của nó, có phải dòng đầu / cuối đoạn không (để thụt đầu dòng và căn đều)
  const raw: { text: string; para: number; first: boolean; last: boolean }[] = []
  content.split('\n').forEach((para, pi) => {
    if (!d.maxWidth) {
      raw.push({ text: para, para: pi, first: true, last: true })
      return
    }
    let line = ''
    let first = true
    for (const w of para.split(/\s+/).filter(Boolean)) {
      const test = line ? line + ' ' + w : w
      const room = d.maxWidth - (first ? indent : 0)
      if (line && measure(test) > room) {
        raw.push({ text: line, para: pi, first, last: false })
        line = w
        first = false
      } else line = test
    }
    raw.push({ text: line, para: pi, first, last: true })
  })
  const widths = raw.map((r) => measure(r.text) + (r.first ? indent : 0))
  const width = Math.max(d.maxWidth || 0, ...widths, 1)
  const lineH = d.size * d.lineHeight
  let y = lineH / 2
  const lines = raw.map((r, i) => {
    if (i > 0 && r.para !== raw[i - 1].para) y += paraGap
    const ind = r.first ? indent : 0
    const x = d.align === 'left' || d.align === 'justify' ? ind : d.align === 'right' ? width - widths[i] + ind : (width - widths[i]) / 2 + ind
    const ln = { text: r.text, x, y, width: widths[i] - ind, justify: d.align === 'justify' && !r.last && !!d.maxWidth ? width - widths[i] : 0 }
    y += lineH
    return ln
  })
  const chars: CharBox[] = []
  let word = 0
  let inWord = false
  lines.forEach((ln, li) => {
    const glyphs = [...ln.text]
    // căn đều: chia phần dư cho các khoảng trắng của dòng
    const gaps = ln.justify ? glyphs.filter((g) => /\s/.test(g)).length : 0
    const extra = gaps ? ln.justify / gaps : 0
    let spaces = 0
    for (let i = 0; i < glyphs.length; i++) {
      const ch = glyphs[i]
      const space = /\s/.test(ch)
      if (space && inWord) {
        word++
        inWord = false
      } else if (!space) inWord = true
      const left = ctx.measureText(glyphs.slice(0, i).join('')).width + tracking * i + spaces * extra
      if (space) spaces++
      const w = ctx.measureText(ch).width
      chars.push({ ch, x: ln.x + left + w / 2, y: ln.y, w, line: li, word })
    }
    if (inWord) {
      word++
      inWord = false
    }
  })
  const out: TextLayout = { width, height: y - lineH / 2, lineH, lines, chars, words: word, justified: lines.some((l) => l.justify > 0) }
  if (layoutCache.size > 400) layoutCache.clear()
  layoutCache.set(key, out)
  return out
}

// ---------- kích thước hộp layer ----------

export function layerBox(ctx: Ctx, l: Layer, t: number, a: RenderAssets): { w: number; h: number } {
  switch (l.type) {
    case 'text': {
      const lay = layoutText(ctx, l, valueAt(l.text.tracking, t), a.fonts)
      const pad = textPad(l.text)
      return { w: lay.width + 2 * pad, h: lay.height + 2 * pad }
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
  const pad = textPad(d)
  // nền chữ: hộp bo góc phủ cả khối chữ + lề
  if (d.box && d.box.opacity > 0) {
    ctx.save()
    ctx.globalAlpha *= Math.min(1, Math.max(0, d.box.opacity))
    ctx.fillStyle = d.box.color
    ctx.beginPath()
    ctx.roundRect(0, 0, lay.width + 2 * pad, lay.height + 2 * pad, Math.max(0, d.box.radius))
    ctx.fill()
    ctx.restore()
  }
  if (pad) ctx.translate(pad, pad)
  ctx.font = fontString(a.fonts, d.font, d.size, d.weight, d.italic)
  ctx.fillStyle = d.color
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  if (d.shadow) {
    ctx.shadowColor = d.shadow.color
    ctx.shadowBlur = Math.max(0, d.shadow.blur)
    ctx.shadowOffsetX = d.shadow.x
    ctx.shadowOffsetY = d.shadow.y
  }
  const stroke = d.stroke && d.stroke.width > 0 ? d.stroke : null
  if (stroke) {
    ctx.strokeStyle = stroke.color
    ctx.lineWidth = stroke.width * 2 // nửa nét bị chữ đè lên nên nhân đôi
    ctx.lineJoin = 'round'
  }
  const put = (s: string, x: number, y: number) => {
    if (stroke) ctx.strokeText(s, x, y)
    ctx.fillText(s, x, y)
  }

  const unitOf = (c: CharBox, i: number, anim: TextAnimator) =>
    anim.unit === 'char' ? i : anim.unit === 'word' ? c.word : c.line
  const nUnits = (anim: TextAnimator | null) =>
    !anim ? 0 : anim.unit === 'char' ? lay.chars.length : anim.unit === 'word' ? lay.words : lay.lines.length
  const pin = animProgress(d.animIn, nUnits(d.animIn), t, l, 'in')
  const pout = animProgress(d.animOut, nUnits(d.animOut), t, l, 'out')

  const settled = (!pin || pin.every((k) => k >= 1)) && (!pout || pout.every((k) => k >= 1))
  if (settled && Math.abs(tracking) < 0.01 && !lay.justified) {
    for (const ln of lay.lines) put(ln.text, ln.x, ln.y)
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
    put(c.ch, -c.w / 2, 0)
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
