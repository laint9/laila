import Anthropic from '@anthropic-ai/sdk'
import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import type {
  BrandElement,
  GenerateRequest,
  GenerateResult,
  ReferenceAnalysis,
  ReferenceRequest,
  ReferenceResult,
  SoundDesignRequest,
  SoundDesignResult,
  ShotRatingRequest,
  ShotRatingResult,
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
  "color": "#hex", "align": "left"|"center"|"right"|"justify", "lineHeight": multiplier, "tracking": Prop (px between letters),
  "maxWidth": px (0 = no wrapping; justify needs it),
  optional: "italic": bool, "uppercase": bool, "paraSpacing": extra gap between paragraphs in multiples of size, "indent": px first-line indent,
  "stroke": { "color", "width" px } | null, "shadow": { "color", "blur", "x", "y" } | null (use for neon glow), "box": { "color", "opacity" 0..1, "padding" px, "radius" px } | null (caption/label background),
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

const REFERENCE_SYSTEM = `REFERENCE MODE
The user attaches frames sampled from a reference image or video that shows a motion graphics effect they like. Your job:
1. Study the frames in order (timestamps given) and reverse-engineer the effect: layers, motion paths, easing, timing, text animation style, transitions, masks, blur, colour, typography, camera moves.
2. Judge honestly how much of it this app can recreate. The app can do: text/shape/image layers with keyframed position/scale/rotation/opacity/blur, cubic-bezier easing, per char/word/line text reveals (fade, slide, mask, blur, scale, rotate, typewriter), trim-paths strokes, parenting, wiggle, blend modes, and code layers (2D canvas) for particles or generative patterns. It cannot do: 3D cameras or real 3D models, live-action footage, photographic textures it was not given, true motion tracking, fluid/physics simulations beyond simple 2D code, or exact copies of a third-party logo.
3. Rebuild the effect as a scene using the user's brand elements instead of the reference's content (keep the motion idea, swap in their text, colours, fonts, logo). Do not copy someone else's logo or copyrighted artwork.

Reply with ONLY one JSON object:
{
  "analysis": {
    "summary": string,                       // what the effect is, 2-3 sentences, in Vietnamese
    "feasibility": "high" | "partial" | "low",
    "feasibilityReason": string,             // Vietnamese
    "techniques": [ { "name": string, "detail": string, "replicable": "yes" | "approx" | "no" } ],  // Vietnamese
    "timing": string,                        // rhythm and durations, Vietnamese
    "palette": [ "#RRGGBB", ... ],           // dominant colours of the reference
    "tips": [ string ]                       // how to get closer by hand in the editor, Vietnamese
  },
  "title": string,
  "duration": number,
  "notes": string,
  "scene": { "background": ..., "layers": [...] } | null   // same scene format as above; null only if nothing reasonable can be built
}`

const SOUND_SYSTEM = `You are a sound designer for motion graphics. The app has a built-in synthesizer (no samples). Turn the user's description into synthesizer parameters.

Reply with ONLY one JSON object:
{ "type": "sfx" | "music", "name": short Vietnamese name, "notes": one Vietnamese sentence on the idea, "spec": SfxSpec | MusicSpec }

SfxSpec: { "kind": "whoosh"|"swish"|"riser"|"impact"|"boom"|"pop"|"click"|"glitch"|"chime"|"sparkle"|"typing"|"notification",
  "duration": seconds (0.03-8), "pitch": 0.5-2 (1 = normal), "intensity": 0-1, "brightness": 0-1 (dark to bright), "reverb": 0-1 }
MusicSpec: { "style": "hiphop"|"oldschool"|"trap"|"club"|"corporate"|"upbeat"|"chill"|"tech"|"cinematic"|"lofi", "bpm": 60-180, "swing": 0-0.3 (hip hop/old school 0.08-0.15), "key": "C".."B" (sharps as C#), "mode": "major"|"minor",
  "progression": chord scale degrees per bar, 2-8 numbers 1-7 (e.g. [1,5,6,4]), "length": seconds, "energy": 0-1,
  "instruments": { "pad": bool, "bass": bool, "arp": bool, "drums": bool, "lead": bool },
  "drums": { "kick": 16-step pattern like "x---x---x---x---", "snare": ..., "hat": ... } }
Nightlife/bar/club briefs: hiphop (boom bap ~88-95 BPM), oldschool (funk/old school hip hop ~95-105), trap (~135-150, 808), club (house ~120-128).
Pick "music" for background tracks/beds/songs, "sfx" for single sounds. Respect a requested type when given.`

const SHOTS_SYSTEM = `You are a senior video editor cutting short social videos (Reels/TikTok) for nightlife venues: bars, clubs, hip hop and old school nights.
You get one still per shot from the client's raw footage. Rate how strong each shot is for a fast, beat-synced promo cut.
Reward: energy (crowd hands up, dancing, DJ action, performers), atmosphere (lights, lasers, smoke, neon, colour), hero details (drinks being made, bottles, logo/signage), sharp and well exposed frames.
Penalise: blur, near-black or blown-out frames, empty rooms, awkward unflattering faces or people clearly not wanting to be filmed, staff-only/backstage mess, duplicates of a better shot.
Reply with ONLY one JSON object: { "shots": [ { "id": shot id, "score": 0-10, "tag": "crowd"|"dj"|"performer"|"drinks"|"venue"|"logo"|"people"|"detail"|"other", "skip": true when it should never be used } ], "notes": one short Vietnamese sentence about the footage overall }
Include every shot id exactly once.`

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
    /** khối system thứ 2 (sau khối được cache) */
    extraSystem?: string
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
        system: [
          { type: 'text', text: opts.system, cache_control: { type: 'ephemeral' } },
          ...(opts.extraSystem ? [{ type: 'text' as const, text: opts.extraSystem }] : [])
        ],
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

  async analyzeReference(req: ReferenceRequest, frames: { t: number; data: string }[], duration: number, signal?: AbortSignal): Promise<ReferenceResult> {
    const content: Anthropic.Beta.BetaContentBlockParam[] = [...(await imageBlocks(req.elements))]
    content.push({ type: 'text', text: `Reference ${frames.length > 1 ? `video, ${duration.toFixed(2)}s long, ${frames.length} frames sampled in order` : 'image'}:` })
    for (const f of frames) {
      if (frames.length > 1) content.push({ type: 'text', text: `Frame at t=${f.t.toFixed(2)}s` })
      content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: f.data } })
    }
    content.push({
      type: 'text',
      text:
        `Canvas: ${req.settings.width}x${req.settings.height} @ ${req.settings.fps}fps.\n\nBrand elements:\n${describeElements(req.elements)}` +
        (req.note?.trim() ? `\n\nWhat the user wants from this reference:\n${req.note.trim()}` : '')
    })

    let lastErr = ''
    for (let attempt = 0; attempt < 2; attempt++) {
      const text = await this.call({
        system: MOTION_SYSTEM,
        extraSystem: REFERENCE_SYSTEM,
        content: lastErr ? [...content, { type: 'text', text: `Your previous reply was not valid JSON (${lastErr}). Reply again with only the JSON object.` }] : content,
        model: req.model,
        effort: 'high',
        signal
      })
      try {
        const out = parseJsonObject(text) as Partial<ReferenceResult>
        const a = (out.analysis ?? {}) as Partial<ReferenceAnalysis>
        if (!a.summary) throw new Error('missing "analysis.summary"')
        return {
          analysis: {
            summary: String(a.summary),
            feasibility: a.feasibility === 'high' || a.feasibility === 'low' ? a.feasibility : 'partial',
            feasibilityReason: String(a.feasibilityReason ?? ''),
            techniques: Array.isArray(a.techniques)
              ? a.techniques.map((t) => ({
                  name: String(t?.name ?? ''),
                  detail: String(t?.detail ?? ''),
                  replicable: t?.replicable === 'yes' || t?.replicable === 'no' ? t.replicable : 'approx'
                }))
              : [],
            timing: String(a.timing ?? ''),
            palette: Array.isArray(a.palette) ? a.palette.filter((c) => typeof c === 'string').slice(0, 8) : [],
            tips: Array.isArray(a.tips) ? a.tips.map(String) : []
          },
          title: typeof out.title === 'string' ? out.title : 'Theo reference',
          duration: typeof out.duration === 'number' && out.duration > 0 ? Math.min(60, out.duration) : Math.max(1, Math.min(15, duration || 4)),
          notes: typeof out.notes === 'string' ? out.notes : '',
          scene: out.scene && typeof out.scene === 'object' ? out.scene : null,
          frames: frames.length
        }
      } catch (e) {
        lastErr = (e as Error).message
      }
    }
    throw new Error('Claude trả về phân tích không đọc được: ' + lastErr)
  }

  /** Chấm điểm từng cảnh (1 ảnh đại diện mỗi cảnh) để dựng video theo nhạc */
  async rateShots(req: ShotRatingRequest, signal?: AbortSignal): Promise<ShotRatingResult> {
    const content: Anthropic.Beta.BetaContentBlockParam[] = []
    for (const s of req.shots) {
      content.push({ type: 'text', text: `Shot ${s.id} (${s.length.toFixed(1)}s):` })
      content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: s.image } })
    }
    content.push({ type: 'text', text: req.brief?.trim() ? `What the client wants:\n${req.brief.trim()}` : 'No extra brief: a high-energy nightlife promo.' })
    const text = await this.call({ system: SHOTS_SYSTEM, content, model: req.model, effort: 'low', signal })
    const out = parseJsonObject(text) as { shots?: unknown[]; notes?: unknown }
    const ids = new Set(req.shots.map((s) => s.id))
    const ratings = (Array.isArray(out.shots) ? out.shots : [])
      .map((x) => x as Record<string, unknown>)
      .filter((x) => ids.has(String(x.id)))
      .map((x) => ({
        id: String(x.id),
        score: Math.max(0, Math.min(10, Number(x.score) || 0)),
        tag: typeof x.tag === 'string' ? x.tag : 'other',
        skip: x.skip === true
      }))
    return { ratings, notes: typeof out.notes === 'string' ? out.notes : '' }
  }

  async designSound(req: SoundDesignRequest, signal?: AbortSignal): Promise<SoundDesignResult> {
    const ask =
      `Description: ${req.prompt}\n` +
      (req.kind === 'auto' ? '' : `Type required: ${req.kind}\n`) +
      `If music, target length: ${Math.round(req.length)} seconds.`
    const text = await this.call({ system: SOUND_SYSTEM, content: [{ type: 'text', text: ask }], model: req.model, effort: 'low', signal })
    const out = parseJsonObject(text) as Partial<SoundDesignResult>
    const type = req.kind !== 'auto' ? req.kind : out.type === 'music' ? 'music' : 'sfx'
    return { type, name: typeof out.name === 'string' ? out.name : req.prompt.slice(0, 40), spec: out.spec ?? {}, notes: typeof out.notes === 'string' ? out.notes : '' }
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
