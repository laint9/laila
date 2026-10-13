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

// Hợp đồng code giữa Claude và sandbox render. Giữ ổn định (không chèn giá trị
// thay đổi theo request) để prompt caching hoạt động.
const MOTION_SYSTEM = `You are a senior motion designer who writes motion graphics as JavaScript for a 2D canvas.

Your code runs inside a sandboxed iframe and is rendered frame by frame into a video, so it must be a pure function of time.

CONTRACT
Write plain JavaScript (no imports, no DOM access, no network, no async). Define:

  function render(ctx, t, api) { ... }   // required. Draw ONE frame at time t (seconds, 0 <= t < api.duration)
  function setup(api) { ... }            // optional. Runs once before the first frame; return value is passed as api.state

ctx is a CanvasRenderingContext2D sized api.width x api.height. The canvas is NOT cleared for you: paint the full background every frame.

api fields:
  width, height, duration, fps
  p                      progress 0..1 for the current frame (t / duration)
  el                     { [name]: string }  text, note, color (#hex) and font values from the user's brand elements
  img                    { [name]: ImageBitmap } images from the user's brand elements (draw with ctx.drawImage)
  font(name, size, weight?)  returns a CSS font string using the brand font if one exists, e.g. ctx.font = api.font('heading', 96, 700)
  ease                   { linear, inQuad, outQuad, inOutQuad, inCubic, outCubic, inOutCubic, inQuart, outQuart, inOutQuart, inExpo, outExpo, inOutExpo, outBack, outElastic, outBounce }  each maps 0..1 -> 0..1
  lerp(a, b, k), clamp(v, min, max), map(v, inMin, inMax, outMin, outMax)  map clamps to the output range
  seg(t, start, end)     0..1 progress of t inside [start, end], clamped
  random(seed)           deterministic 0..1 for a numeric seed. Never use Math.random or Date.
  wrapText(ctx, text, maxWidth)  returns string[] lines that fit maxWidth with the current ctx.font
  state                  whatever setup returned

RULES
- Deterministic: the same t must always produce the same frame.
- Use only the brand elements given. Reference them by exact name via api.el / api.img. If an element is missing at runtime, fall back gracefully (check before use).
- Respect the canvas size; layouts must work for the given aspect ratio. Keep text inside a 6% safe margin.
- Animate in, hold, and (unless told otherwise) animate out before the end. Favour clean, modern, professional motion: strong easing, staggered reveals, purposeful movement. No cheesy effects.
- Text sizes relative to api.height or api.width, never hard-coded pixels for a single resolution.
- Performance: each frame must render in well under 50 ms. Avoid per-pixel loops over the whole canvas and avoid huge shadowBlur.
- The code field must contain only JavaScript source, no markdown fences.`

const RESULT_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'Short scene title' },
    duration: { type: 'number', description: 'Scene length in seconds' },
    code: { type: 'string', description: 'JavaScript source defining render() and optionally setup()' },
    notes: { type: 'string', description: 'One or two sentences on the motion idea, in the language of the user prompt' }
  },
  required: ['title', 'duration', 'code', 'notes'],
  additionalProperties: false
} as const

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
          return `- image "${e.name}" -> api.img["${e.name}"] (attached above)`
        case 'color':
          return `- color "${e.name}" = ${e.value} -> api.el["${e.name}"]`
        case 'font':
          return `- font "${e.name}" = ${e.value} -> api.font("${e.name}", size, weight)`
        case 'note':
          return `- brand note "${e.name}": ${e.value}`
        default:
          return `- text "${e.name}" = ${JSON.stringify(e.value)} -> api.el["${e.name}"]`
      }
    })
    .join('\n')
}

async function imageBlocks(elements: BrandElement[]): Promise<Anthropic.Beta.BetaContentBlockParam[]> {
  const blocks: Anthropic.Beta.BetaContentBlockParam[] = []
  for (const e of elements) {
    if (e.kind !== 'image') continue
    const media_type = IMAGE_TYPES[extname(e.value).toLowerCase()]
    if (!media_type) continue // svg... không gửi được dạng ảnh, chỉ mô tả tên
    try {
      const data = (await readFile(e.value)).toString('base64')
      blocks.push({ type: 'text', text: `Image element "${e.name}":` })
      blocks.push({ type: 'image', source: { type: 'base64', media_type, data } })
    } catch {
      // file đã bị xoá/di chuyển: bỏ qua, sandbox sẽ fallback
    }
  }
  return blocks
}

export class ClaudeService {
  constructor(private getKey: () => string | undefined) {}

  private client(): Anthropic {
    const apiKey = this.getKey()
    if (!apiKey) throw new Error('Chưa có Claude API key. Vào Settings để nhập key.')
    return new Anthropic({ apiKey })
  }

  private async structured<T>(opts: {
    system: string
    schema: Record<string, unknown>
    content: Anthropic.Beta.BetaContentBlockParam[]
    model?: string
    effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
    signal?: AbortSignal
  }): Promise<T> {
    const stream = this.client().beta.messages.stream(
      {
        model: opts.model || DEFAULT_MODEL,
        max_tokens: 64000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: [{ type: 'text', text: opts.system, cache_control: { type: 'ephemeral' } }],
        output_config: { effort: opts.effort, format: { type: 'json_schema', schema: opts.schema } },
        messages: [{ role: 'user', content: opts.content }]
      },
      { signal: opts.signal }
    )
    const msg = await stream.finalMessage()
    if (msg.stop_reason === 'refusal') {
      throw new Error('Claude từ chối yêu cầu này. Thử diễn đạt lại prompt.')
    }
    if (msg.stop_reason === 'max_tokens') {
      throw new Error('Kết quả bị cắt vì quá dài. Thử rút gọn scene.')
    }
    const text = msg.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
    try {
      return JSON.parse(text) as T
    } catch {
      throw new Error('Không đọc được kết quả JSON từ Claude.')
    }
  }

  async generateScene(req: GenerateRequest, signal?: AbortSignal): Promise<GenerateResult> {
    const { settings, scene } = req
    const content: Anthropic.Beta.BetaContentBlockParam[] = [...(await imageBlocks(req.elements))]
    let task =
      `Canvas: ${settings.width}x${settings.height} @ ${settings.fps}fps. Target duration: ${scene.duration}s.\n\n` +
      `Brand elements:\n${describeElements(req.elements)}\n\n` +
      `Scene "${scene.title || 'Untitled'}":\n${scene.prompt}`

    if (req.previousCode) {
      task +=
        `\n\nCurrent code for this scene:\n<code>\n${req.previousCode}\n</code>\n\n` +
        (req.runtimeError
          ? `It failed in the renderer with this error:\n${req.runtimeError}\nFix the bug while keeping the design.`
          : `Revise it with this change request (keep everything else unless the request says otherwise):\n${req.instruction ?? ''}`)
    }
    content.push({ type: 'text', text: task })

    const out = await this.structured<GenerateResult>({
      system: MOTION_SYSTEM,
      schema: RESULT_SCHEMA,
      content,
      model: req.model,
      effort: req.runtimeError ? 'medium' : 'high',
      signal
    })
    out.code = stripFences(out.code)
    if (!/function\s+render\s*\(/.test(out.code) && !/render\s*=/.test(out.code)) {
      throw new Error('Code trả về thiếu hàm render().')
    }
    if (!(out.duration > 0)) out.duration = scene.duration
    return out
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
    const out = await this.structured<{ scenes: StoryboardScene[] }>({
      system: STORYBOARD_SYSTEM,
      schema: STORYBOARD_SCHEMA,
      content,
      model: req.model,
      effort: 'medium',
      signal
    })
    return out.scenes
  }
}

export function stripFences(code: string): string {
  const m = code.match(/```(?:js|javascript)?\s*\n([\s\S]*?)```/)
  return (m ? m[1] : code).trim()
}
