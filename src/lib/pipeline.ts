// Điều phối: gọi Claude -> chuẩn hoá scene -> chạy thử -> tự sửa lỗi -> render mp4 -> media bin.
import type { MediaItem, Scene } from '../../shared/types'
import { normScene, sceneFromCode } from '../engine/normalize'
import { SceneRunner, renderSceneToFile } from '../engine/player'
import type { MotionScene } from '../engine/types'
import { useStore } from './store'
import { uid } from './media'

const MAX_AUTOFIX = 2

class Semaphore {
  private queue: (() => void)[] = []
  constructor(private slots: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.slots <= 0) await new Promise<void>((r) => this.queue.push(r))
    else this.slots--
    try {
      return await fn()
    } finally {
      const next = this.queue.shift()
      if (next) next()
      else this.slots++
    }
  }
}

const claudeSlots = new Semaphore(3)
const renderSlots = new Semaphore(1)

interface Job {
  reqId: string
  signal: { cancelled: boolean }
}
const jobs = new Map<string, Job>()

const st = () => useStore.getState()
const sceneOf = (id: string) => st().project.scenes.find((s) => s.id === id)

export function elementsFor(scene: Scene) {
  const ids = new Set(scene.elementIds)
  return st().project.elements.filter((e) => ids.has(e.id) && (e.kind !== 'image' || e.value))
}

/** Scene dạng layer của 1 scene (tự chuyển scene kiểu cũ chỉ có code) */
export function motionOf(scene: Scene): MotionScene | null {
  const { width, height } = st().project.settings
  if (scene.motion) return normScene(scene.motion, scene.duration, width, height)
  if (scene.code) return sceneFromCode(scene.code, scene.duration, width, height)
  return null
}

export function isBusy(sceneId: string) {
  return jobs.has(sceneId)
}

export function cancelScene(sceneId: string) {
  const job = jobs.get(sceneId)
  if (!job) return
  job.signal.cancelled = true
  window.laila.claude.cancel(job.reqId)
}

/** Generate (hoặc sửa theo lời nếu có instruction) một scene rồi render. */
export async function generateScene(sceneId: string, opts: { instruction?: string } = {}) {
  const scene0 = sceneOf(sceneId)
  if (!scene0 || jobs.has(sceneId)) return
  const job: Job = { reqId: uid(), signal: { cancelled: false } }
  jobs.set(sceneId, job)
  const update = (patch: Partial<Scene>) => st().updateScene(sceneId, patch)
  update({ status: 'generating', error: undefined, progress: undefined })

  try {
    const { settings } = st().project
    const elements = elementsFor(scene0)
    const current = motionOf(scene0)
    const refine = !!(opts.instruction && current)

    let result = await claudeSlots.run(() =>
      window.laila.claude.generate(job.reqId, {
        scene: { title: scene0.title, prompt: scene0.prompt, duration: scene0.duration },
        elements,
        settings,
        previousScene: refine ? current : undefined,
        instruction: refine ? opts.instruction : undefined
      })
    )

    let motion = normScene(result.scene, result.duration, settings.width, settings.height)
    for (let attempt = 0; ; attempt++) {
      if (job.signal.cancelled) throw new Error('Đã huỷ')
      if (!motion.layers.length) throw new Error('Claude không trả về layer nào')
      const runner = new SceneRunner(settings, elements)
      const err = await runner.validate(motion, result.duration).finally(() => runner.dispose())
      if (!err) break
      if (attempt >= MAX_AUTOFIX) throw new Error(`Layer code lỗi sau ${MAX_AUTOFIX} lần tự sửa: ${err}`)
      update({ notes: `Đang tự sửa lỗi (${attempt + 1}/${MAX_AUTOFIX})…` })
      job.reqId = uid()
      const duration = result.duration
      result = await claudeSlots.run(() =>
        window.laila.claude.generate(job.reqId, {
          scene: { title: scene0.title, prompt: scene0.prompt, duration },
          elements,
          settings,
          previousScene: motion,
          runtimeError: err
        })
      )
      motion = normScene(result.scene, result.duration, settings.width, settings.height)
    }

    update({ motion, code: undefined, notes: result.notes, duration: result.duration, title: scene0.title || result.title })
    await renderScene(sceneId, job)
  } catch (e) {
    const msg = (e as Error).message || String(e)
    update({ status: job.signal.cancelled ? 'idle' : 'error', error: job.signal.cancelled ? undefined : cleanError(msg) })
  } finally {
    jobs.delete(sceneId)
  }
}

/** Render lại từ scene hiện có (sau khi chỉnh trong Motion Editor hoặc đổi khung hình). */
export async function rerenderScene(sceneId: string) {
  if (jobs.has(sceneId)) return
  const job: Job = { reqId: uid(), signal: { cancelled: false } }
  jobs.set(sceneId, job)
  try {
    await renderScene(sceneId, job)
  } catch (e) {
    st().updateScene(sceneId, { status: job.signal.cancelled ? 'idle' : 'error', error: cleanError((e as Error).message) })
  } finally {
    jobs.delete(sceneId)
  }
}

async function renderScene(sceneId: string, job: Job) {
  const scene = sceneOf(sceneId)
  const motion = scene && motionOf(scene)
  if (!scene || !motion) throw new Error('Scene chưa có nội dung')
  const update = (patch: Partial<Scene>) => st().updateScene(sceneId, patch)
  update({ status: 'rendering', progress: 0, error: undefined })

  const out = await renderSlots.run(() =>
    renderSceneToFile(motion, scene.duration, st().project.settings, elementsFor(scene), scene.title, (p) => update({ progress: p }), job.signal, !!scene.alpha)
  )

  const version = scene.version + 1
  const media: MediaItem = {
    id: uid(),
    kind: 'motion',
    name: `${scene.title} · v${version}`,
    path: out.path,
    duration: out.duration || scene.duration,
    hasAudio: false,
    width: out.width,
    height: out.height,
    sceneId,
    alpha: !!scene.alpha
  }
  const oldMediaId = scene.mediaId
  const oldDuration = st().project.media.find((m) => m.id === oldMediaId)?.duration
  st().addMedia([media])
  update({ status: 'ready', progress: 1, mediaId: media.id, version, dirty: false })

  // Clip trên timeline đang dùng bản cũ -> tự đổi sang bản mới
  if (oldMediaId) {
    useStore.setState((s) => ({
      project: {
        ...s.project,
        timeline: s.project.timeline.map((c) => {
          if (c.mediaId !== oldMediaId) return c
          // clip chưa trim -> lấy trọn bản mới; đã trim -> giữ đoạn cắt trong giới hạn bản mới
          const untrimmed = c.in === 0 && c.out >= (oldDuration ?? 0) - 0.05
          if (untrimmed) return { ...c, mediaId: media.id, in: 0, out: media.duration }
          const out = Math.min(media.duration, c.out)
          return { ...c, mediaId: media.id, in: Math.max(0, Math.min(c.in, out - 0.1)), out }
        }),
        // clip trên track phủ cũng đổi sang bản mới
        tracks: (s.project.tracks ?? []).map((t) => ({
          ...t,
          clips: t.clips.map((c) => {
            if (c.mediaId !== oldMediaId) return c
            const untrimmed = c.in === 0 && c.out >= (oldDuration ?? 0) - 0.05
            const out = untrimmed ? media.duration : Math.min(media.duration, c.out)
            return { ...c, mediaId: media.id, in: Math.max(0, Math.min(c.in, out - 0.1)), out }
          })
        }))
      }
    }))
  }
}

/** Nhờ Claude sửa scene đang mở trong Motion Editor (không render, để còn undo) */
export async function reviseMotion(scene: Scene, motion: MotionScene, duration: number, instruction: string) {
  const { settings } = st().project
  const elements = elementsFor(scene)
  let r = await claudeSlots.run(() =>
    window.laila.claude.generate(uid(), {
      scene: { title: scene.title, prompt: scene.prompt, duration },
      elements,
      settings,
      previousScene: motion,
      instruction
    })
  )
  let next = normScene(r.scene, r.duration, settings.width, settings.height)
  for (let attempt = 0; attempt < MAX_AUTOFIX; attempt++) {
    const runner = new SceneRunner(settings, elements)
    const err = await runner.validate(next, r.duration).finally(() => runner.dispose())
    if (!err) break
    const d = r.duration
    r = await claudeSlots.run(() =>
      window.laila.claude.generate(uid(), {
        scene: { title: scene.title, prompt: scene.prompt, duration: d },
        elements,
        settings,
        previousScene: next,
        runtimeError: err
      })
    )
    next = normScene(r.scene, r.duration, settings.width, settings.height)
  }
  return { scene: next, duration: r.duration, notes: r.notes }
}

export async function generateAll() {
  const targets = st().project.scenes.filter((s) => s.prompt.trim() && (s.status === 'idle' || s.status === 'error'))
  await Promise.all(targets.map((s) => generateScene(s.id)))
}

export async function planStoryboard(brief: string, sceneCount: number, totalDuration: number) {
  const { project } = st()
  const scenes = await window.laila.claude.storyboard(uid(), {
    brief,
    sceneCount,
    totalDuration,
    elements: project.elements.filter((e) => e.kind !== 'image' || e.value),
    settings: project.settings
  })
  const byName = new Map(project.elements.map((e) => [e.name, e.id]))
  for (const s of scenes) {
    const ids = s.elementNames.map((n) => byName.get(n)).filter((x): x is string => !!x)
    st().addScene({
      title: s.title,
      prompt: s.prompt,
      duration: Math.max(1, Math.min(30, s.duration || 4)),
      elementIds: ids.length ? ids : project.elements.map((e) => e.id)
    })
  }
  return scenes.length
}

/** Gửi scene đã xong lên timeline theo thứ tự trên board. */
export function sendReadyScenesToTimeline() {
  const { project, appendToTimeline } = st()
  const onTimeline = new Set(project.timeline.map((c) => c.mediaId))
  for (const s of project.scenes) {
    if (s.mediaId && !onTimeline.has(s.mediaId)) appendToTimeline(s.mediaId)
  }
}

export function cleanError(msg: string) {
  // Electron bọc lỗi IPC: "Error invoking remote method 'x': Error: ..."
  return msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}
