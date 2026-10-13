import Anthropic from '@anthropic-ai/sdk'
import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import type {
  BrandElement,
  GenerateRequest,
  GenerateResult,
  StoryboardRequest,
  StoryboardScene
} from '../shared/types'

export const DEFAULT_MODEL = 'claude-opus-5-5'

type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

// Hợp đồng giữa Claude và engine. Giữ cố định (không chèn giá trị thay đổi theo request)
// để prompt caching hoạt động.
export const MOTION_SYSTEM = `You are a senior motion designer (After Effects background). You design one short motion graphics scene as a layered composition with keyframes, which the user will then fine-tune in an After Effects style editor (layers, keyframes, easing curves, text animators). Make it editable: prefer real text/shape/image layers with keyframes over code.

Reply with ONLY one JSON object, no markdown, in this shape:
{
  "title": string,
  "duration": number,              // seconds
  "notes": string,                 // 1-2 sentences on the idea, in the user's language
  "scene": {
    "background": "#RRGGBB" | null,
    "layers": [ Layer, ... ]       // index 0 is the TOP layer (front), like the AE layer stack
  }
}

Layer (common fields):
  "id": short unique string, "name": string, "type": "text" | "shape" | "image" | "code",
  "in": number, "out": number,     // seconds the layer is visible
  "parent": id | null,             // parenting: child x/y are relative to the parent's anchor point and inherit its position/scale/rotation (not opacity)
  "anchor": [ax, ay],              // anchor inside the layer box, 0..1 (default [0.5,0.5] = centre)
  "blend": "normal" | "multiply" | "screen" | "add" | "overlay",
  "transform": { "x", "y", "scale", "rotation", "opacity", "blur" }
     each is a Prop: either a number, or { "v": number, "keys": [ { "t": seconds, "v": number, "ease": Ease } ], "wiggle": { "freq": n, "amp": n } }
     x/y: pixels in the composition (0,0 = top-left) of the anchor point. scale: percent (100 = natural). rotation: degrees. opacity: 0..100. blur: pixels.
     Keyframe "t" is absolute scene time. "ease" shapes the segment from that key to the next.
Ease: "linear" | "hold" | "easyEase" | "easeIn" | "easeOut" | "easeOutCubic" | "easeInOutCubic" | "easeOutQuart" | "easeOutExpo" | "easeInOutExpo" | "easeOutBack" | "easeOutElastic" | "easeOutBounce" | [x1, y1, x2, y2] (cubic-bezier, y may overshoot)

type "text": "text": {
  "content": string (\\n for line breaks), "font": brand font element name or a macOS font family, "size": px, "weight": 100..900,
  "color": "#hex", "align": "left"|"center"|"right", "lineHeight": multiplier, "tracking": Prop (px between letters),
  "maxWidth": px (0 = no wrapping),
  "animIn":  TextAnimator | null,   // per char/word/line reveal, like AE text animators with a range selector
  "animOut": TextAnimator | null
}
TextAnimator: { "preset": "fade"|"slideUp"|"slideDown"|"slideLeft"|"scale"|"blur"|"typewriter"|"rotate"|"mask",
  "unit": "char"|"word"|"line", "duration": seconds per unit, "stagger": seconds between units, "delay": seconds after layer in (or before layer out),
  "ease": Ease, "order": "forward"|"reverse"|"center"|"random", "distance": travel as a multiple of font size }
  "mask" = each line slides up from behind an invisible line mask (classic kinetic type).

type "shape": "shape": { "kind": "rect"|"ellipse"|"line", "width": Prop, "height": Prop (0 for line), "radius": px,
  "fill": "#hex"|null, "stroke": "#hex"|null, "strokeWidth": px, "trimEnd": Prop (0..100, Trim Paths: percent of the stroke drawn) }
type "image": "image": { "src": brand image element name, "width": px (height follows aspect ratio) }
type "code": "code": { "source": JavaScript } only for effects layers cannot express (particles, generative backgrounds, complex patterns).
  Define function render(ctx, t, api) drawing the full canvas at layer-local time t; optional setup(api) returning api.state.
  api: width, height, duration, fps, p (0..1), el (brand text/colour values by name), img (brand images), font(name, size, weight),
  ease.{linear,inQuad,outQuad,inOutQuad,inCubic,outCubic,inOutCubic,inQuart,outQuart,inOutQuart,inExpo,outExpo,inOutExpo,outBack,outElastic,outBounce},
  lerp, clamp, map, seg(t,start,end), random(seed), wrapText(ctx,text,maxWidth), state. Deterministic: no Math.random, no Date. Paint only what the layer needs (transparent elsewhere).

DESIGN RULES
- Use the brand elements given: exact text, colours, fonts, images by name. Do not invent other logos.
- Clear hierarchy, generous spacing, 6% safe margin, layouts that fit the stated aspect ratio. Sizes relative to the canvas.
- Good motion: animate in with strong ease-outs (easeOutExpo/easeOutCubic/easeOutBack), hold long enough to read (~0.25 s per word), stagger related elements 0.05-0.15 s, animate out unless told otherwise. Use parenting for groups that move together.
- Keep layer names meaningful (e.g. "Headline", "Logo", "Accent bar") and ids stable: when revising a scene keep the ids of layers you keep.
- Keep it lean: usually 3-12 layers.`

const STORYBOARD_SYSTEM = `You are a creative director planning a short motion graphics video that will be built from several independent scenes. Each scene is generated separately by a motion designer who only sees that scene's prompt plus the brand elements, so every scene prompt must be self-contained: describe layout, which brand elements appear (by exact name), motion style, colours, pacing and how it should start/end so cuts between scenes feel continuous. Write prompts in the same language as the brief.`

const STORYBOARD_SCHEMA = {
  type: 'object',
  properties: {
    scenes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          prompt: { type: 'string' },
          duration: { type: 'number' },
          elementNames: { type: 'array', items: { type: 'string' } }
        },
        required: ['title', 'prompt', 'duration', 'elementNames'],
        additionalProperties: false
      }
    }
  },
  required: ['scenes'],
  additionalProperties: false
} as const

const IMAGE_TYPES: Record<string, 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp'
}

function describeElements(elements: BrandElement[]): string {
  if (elements.length === 0) return 'No brand elements were provided. Invent tasteful placeholder content.'
  return elements
    .map((e) => {
      switch (e.kind) {
        case 'image':
          return `- image "${e.name}" (attached above): use as an image layer with "src": "${e.name}"`
        case 'color':
          return `- colour "${e.name}" = ${e.value}`
        case 'font':
          return `- font "${e.name}" = ${e.value}: use "font": "${e.name}" on text layers`
        case 'note':
          return `- brand note "${e.name}": ${e.value}`
        default:
          return `- text "${e.name}" = ${JSON.stringify(e.value)}`
      }
    })
    .join('\n')
}

async function imageBlocks(elements: BrandElement[]): Promise<Anthropic.Beta.BetaContentBlockParam[]> {
  const blocks: Anthropic.Beta.BetaContentBlockParam[] = []
  for (const e of elements) {
    if (e.kind !== 'image') continue
    const media_type = IMAGE_TYPES[extname(e.value).toLowerCase()]
    if (!media_type) continue // svg không gửi dạng ảnh được, Claude chỉ biết tên
    try {
      const data = (await readFile(e.value)).toString('base64')
      blocks.push({ type: 'text', text: `Image element "${e.name}":` })
      blocks.push({ type: 'image', source: { type: 'base64', media_type, data } })
    } catch {
      // file đã bị xoá/di chuyển: bỏ qua
    }
  }
  return blocks
}

/** Lấy object JSON đầu tiên trong text (bỏ qua ```json fence hay lời dẫn nếu có) */
export function parseJsonObject(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*\n([\s\S]*?)```/)
  const body = fenced ? fenced[1] : text
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('no JSON object found')
  return JSON.parse(body.slice(start, end + 1))
}

export class ClaudeService {
  constructor(private getKey: () => string | undefined) {}

  private client(): Anthropic {
    const apiKey = this.getKey()
    if (!apiKey) throw new Error('Chưa có Claude API key. Vào Settings để nhập key.')
    return new Anthropic({ apiKey })
  }

  private async call(opts: {
    system: string
    content: Anthropic.Beta.BetaContentBlockParam[]
    model?: string
    effort: Effort
    schema?: Record<string, unknown>
    signal?: AbortSignal
  }): Promise<string> {
    const stream = this.client().beta.messages.stream(
      {
        model: opts.model || DEFAULT_MODEL,
        max_tokens: 64000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: [{ type: 'text', text: opts.system, cache_control: { type: 'ephemeral' } }],
        output_config: opts.schema
          ? { effort: opts.effort, format: { type: 'json_schema', schema: opts.schema } }
          : { effort: opts.effort },
        messages: [{ role: 'user', content: opts.content }]
      },
      { signal: opts.signal }
    )
    const msg = await stream.finalMessage()
    if (msg.stop_reason === 'refusal') throw new Error('Claude từ chối yêu cầu này. Thử diễn đạt lại prompt.')
    if (msg.stop_reason === 'max_tokens') throw new Error('Kết quả bị cắt vì quá dài. Thử rút gọn scene.')
    return msg.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
  }

  async generateScene(req: GenerateRequest, signal?: AbortSignal): Promise<GenerateResult> {
    const { settings, scene } = req
    const content: Anthropic.Beta.BetaContentBlockParam[] = [...(await imageBlocks(req.elements))]
    let task =
      `Canvas: ${settings.width}x${settings.height} @ ${settings.fps}fps. Target duration: ${scene.duration}s.\n\n` +
      `Brand elements:\n${describeElements(req.elements)}\n\n` +
      `Scene "${scene.title || 'Untitled'}":\n${scene.prompt}`

    if (req.previousScene) {
      task +=
        `\n\nCurrent scene JSON (the user may have edited it by hand; keep their changes unless asked):\n` +
        JSON.stringify(req.previousScene) +
        '\n\n' +
        (req.runtimeError
          ? `A code layer failed in the renderer with this error:\n${req.runtimeError}\nFix it while keeping the design.`
          : `Revise the scene with this change request, keeping everything else:\n${req.instruction ?? ''}`)
    }
    content.push({ type: 'text', text: task })

    let lastErr = ''
    for (let attempt = 0; attempt < 2; attempt++) {
      const text = await this.call({
        system: MOTION_SYSTEM,
        content: lastErr
          ? [...content, { type: 'text', text: `Your previous reply was not valid JSON (${lastErr}). Reply again with only the JSON object.` }]
          : content,
        model: req.model,
        effort: req.runtimeError ? 'medium' : 'high',
        signal
      })
      try {
        const out = parseJsonObject(text) as Partial<GenerateResult>
        if (!out.scene || typeof out.scene !== 'object') throw new Error('missing "scene"')
        return {
          title: typeof out.title === 'string' ? out.title : scene.title,
          duration: typeof out.duration === 'number' && out.duration > 0 ? Math.min(60, out.duration) : scene.duration,
          notes: typeof out.notes === 'string' ? out.notes : '',
          scene: out.scene
        }
      } catch (e) {
        lastErr = (e as Error).message
      }
    }
    throw new Error('Claude trả về dữ liệu không đọc được: ' + lastErr)
  }

  async storyboard(req: StoryboardRequest, signal?: AbortSignal): Promise<StoryboardScene[]> {
    const content: Anthropic.Beta.BetaContentBlockParam[] = [
      ...(await imageBlocks(req.elements)),
      {
        type: 'text',
        text:
          `Format: ${req.settings.width}x${req.settings.height}. Plan ${req.sceneCount} scenes totalling about ${req.totalDuration}s.\n\n` +
          `Brand elements:\n${describeElements(req.elements)}\n\nBrief:\n${req.brief}`
      }
    ]
    const text = await this.call({
      system: STORYBOARD_SYSTEM,
      schema: STORYBOARD_SCHEMA,
      content,
      model: req.model,
      effort: 'medium',
      signal
    })
    try {
      return (JSON.parse(text) as { scenes: StoryboardScene[] }).scenes
    } catch {
      throw new Error('Không đọc được kịch bản từ Claude.')
    }
  }
}
