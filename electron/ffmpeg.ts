import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import ffmpegStatic from 'ffmpeg-static'
import ffprobeStatic from 'ffprobe-static'
import type { ExportRequest } from '../shared/types'

// Trong app đã đóng gói, binary nằm ở app.asar.unpacked (xem asarUnpack trong electron-builder.yml).
function resolveBin(p: string | null | undefined, fallback: string): string {
  if (!p) return fallback
  const unpacked = p.replace('app.asar', 'app.asar.unpacked')
  if (existsSync(unpacked)) return unpacked
  if (existsSync(p)) return p
  return fallback
}

export const FFMPEG = resolveBin(ffmpegStatic as unknown as string, 'ffmpeg')
export const FFPROBE = resolveBin(ffprobeStatic?.path, 'ffprobe')

export interface ProbeResult {
  duration: number
  hasAudio: boolean
  hasVideo: boolean
  width?: number
  height?: number
}

export function probe(path: string): Promise<ProbeResult> {
  return new Promise((resolve, reject) => {
    const p = spawn(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path])
    let out = ''
    let err = ''
    p.stdout.on('data', (d) => (out += d))
    p.stderr.on('data', (d) => (err += d))
    p.on('error', reject)
    p.on('close', (code) => {
      if (code !== 0) return reject(new Error(err || `ffprobe exit ${code}`))
      const j = JSON.parse(out)
      const streams: any[] = j.streams ?? []
      const v = streams.find((s) => s.codec_type === 'video' && s.disposition?.attached_pic !== 1)
      resolve({
        duration: Number(j.format?.duration ?? v?.duration ?? 0),
        hasAudio: streams.some((s) => s.codec_type === 'audio'),
        hasVideo: !!v,
        width: v?.width,
        height: v?.height
      })
    })
  })
}

/**
 * Nhận từng frame PNG qua stdin và encode thành H.264 mp4.
 * Dùng cho các scene motion graphic Claude generate.
 */
export class FrameEncoder {
  private proc: ChildProcessWithoutNullStreams
  private done: Promise<void>
  private stderr = ''

  constructor(outPath: string, fps: number) {
    this.proc = spawn(FFMPEG, [
      '-y',
      '-f', 'image2pipe',
      '-framerate', String(fps),
      '-c:v', 'png',
      '-i', '-',
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-crf', '16',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      outPath
    ])
    this.proc.stderr.on('data', (d) => {
      this.stderr = (this.stderr + d).slice(-4000)
    })
    this.done = new Promise((resolve, reject) => {
      this.proc.on('error', reject)
      this.proc.on('close', (code) =>
        code === 0 ? resolve() : reject(new Error(`ffmpeg lỗi (${code}): ${this.stderr.slice(-800)}`))
      )
    })
    // tránh unhandled rejection nếu chưa ai await
    this.done.catch(() => {})
    this.proc.stdin.on('error', () => {})
  }

  async write(frame: Uint8Array): Promise<void> {
    if (!this.proc.stdin.write(frame)) {
      await new Promise<void>((resolve, reject) => {
        const onDrain = () => {
          this.proc.removeListener('close', onClose)
          resolve()
        }
        const onClose = () => reject(new Error(`ffmpeg đã dừng: ${this.stderr.slice(-800)}`))
        this.proc.stdin.once('drain', onDrain)
        this.proc.once('close', onClose)
      })
    }
  }

  async finish(): Promise<void> {
    this.proc.stdin.end()
    await this.done
  }

  abort(): void {
    this.proc.kill('SIGKILL')
  }
}

const n = (v: number) => v.toFixed(3)

/** atempo chỉ nhận 0.5..2 mỗi lần -> xâu chuỗi */
function atempoChain(speed: number): string {
  const parts: string[] = []
  let s = speed
  while (s > 2) {
    parts.push('atempo=2')
    s /= 2
  }
  while (s < 0.5) {
    parts.push('atempo=0.5')
    s /= 0.5
  }
  if (Math.abs(s - 1) > 1e-3) parts.push(`atempo=${s.toFixed(4)}`)
  return parts.length ? parts.join(',') + ',' : ''
}

const XFADE: Record<string, string> = {
  fade: 'fade',
  dissolve: 'dissolve',
  fadeblack: 'fadeblack',
  fadewhite: 'fadewhite',
  slideleft: 'slideleft',
  slideup: 'slideup',
  wipeleft: 'wipeleft',
  circleopen: 'circleopen',
  zoomin: 'zoomin'
}

/** Dựng lệnh ffmpeg xuất video tổng: trim, tốc độ, scale/pad, fade âm thanh, chuyển cảnh (xfade), nhạc nền. */
export function buildExportArgs(req: ExportRequest): { args: string[]; total: number } {
  const even = (v: number) => Math.max(2, Math.round(v / 2) * 2)
  const W = even(req.settings.width)
  const H = even(req.settings.height)
  const fps = req.settings.fps
  const args: string[] = ['-y']
  const filters: string[] = []
  const lens: number[] = []

  req.clips.forEach((c, i) => {
    args.push('-i', c.path)
    const speed = Math.min(4, Math.max(0.25, c.speed || 1))
    const d = Math.max(0.04, (c.out - c.in) / speed)
    lens.push(d)
    filters.push(
      `[${i}:v]trim=start=${n(c.in)}:end=${n(c.out)},setpts=(PTS-STARTPTS)/${speed},` +
        `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,` +
        `setsar=1,fps=${fps},format=yuv420p,settb=AVTB[v${i}]`
    )
    const fades =
      (c.fadeIn > 0 ? `,afade=t=in:st=0:d=${n(Math.min(c.fadeIn, d))}` : '') +
      (c.fadeOut > 0 ? `,afade=t=out:st=${n(Math.max(0, d - c.fadeOut))}:d=${n(Math.min(c.fadeOut, d))}` : '')
    if (c.hasAudio) {
      filters.push(
        `[${i}:a]atrim=start=${n(c.in)}:end=${n(c.out)},asetpts=PTS-STARTPTS,${atempoChain(speed)}` +
          `aformat=sample_rates=48000:channel_layouts=stereo,volume=${c.volume.toFixed(2)},apad=whole_dur=${n(d)},atrim=duration=${n(d)}${fades}[a${i}]`
      )
    } else {
      filters.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${n(d)}[a${i}]`)
    }
  })

  // ghép tuần tự: chuyển cảnh dùng xfade/acrossfade, không thì concat
  let vAcc = 'v0'
  let aAcc = 'a0'
  let total = lens[0] ?? 0
  for (let i = 1; i < req.clips.length; i++) {
    const prev = req.clips[i - 1]
    const kind = XFADE[prev.transition]
    const td = kind ? Math.max(0, Math.min(prev.transitionDuration || 0.5, lens[i - 1] * 0.45, lens[i] * 0.45)) : 0
    const vOut = `vx${i}`
    const aOut = `ax${i}`
    if (kind && td > 0.02) {
      filters.push(`[${vAcc}][v${i}]xfade=transition=${kind}:duration=${n(td)}:offset=${n(total - td)}[${vOut}]`)
      filters.push(`[${aAcc}][a${i}]acrossfade=d=${n(td)}:c1=tri:c2=tri[${aOut}]`)
      total += lens[i] - td
    } else {
      filters.push(`[${vAcc}][${aAcc}][v${i}][a${i}]concat=n=2:v=1:a=1[${vOut}][${aOut}]`)
      total += lens[i]
    }
    vAcc = vOut
    aAcc = aOut
  }

  let audioOut = `[${aAcc}]`
  if (req.music) {
    const mi = req.clips.length
    args.push('-i', req.music.path)
    filters.push(
      `[${mi}:a]atrim=start=${n(req.music.in)},asetpts=PTS-STARTPTS,aformat=sample_rates=48000:channel_layouts=stereo,` +
        `volume=${req.music.volume.toFixed(2)},afade=t=out:st=${n(Math.max(0, total - 1.5))}:d=1.5[mus]`
    )
    filters.push(`[${aAcc}][mus]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]`)
    audioOut = '[aout]'
  }

  args.push('-filter_complex', filters.join(';'))
  args.push('-map', `[${vAcc}]`, '-map', audioOut)
  args.push(
    '-c:v', 'libx264',
    '-preset', req.quality === 'high' ? 'slow' : 'veryfast',
    '-crf', req.quality === 'high' ? '17' : '23',
    '-pix_fmt', 'yuv420p',
    '-r', String(fps),
    '-c:a', 'aac',
    '-b:a', '192k',
    '-t', n(total),
    '-movflags', '+faststart',
    req.outPath
  )
  return { args, total }
}

/** Dải thumbnail (filmstrip) cho clip trên timeline */
export function makeFilmstrip(path: string, outPath: string, duration: number, count = 12): Promise<void> {
  return new Promise((resolve, reject) => {
    const rate = count / Math.max(0.1, duration)
    const p = spawn(FFMPEG, [
      '-y',
      '-i', path,
      '-vf', `fps=${rate.toFixed(4)},scale=-2:72,tile=${count}x1`,
      '-frames:v', '1',
      '-q:v', '5',
      outPath
    ])
    let err = ''
    p.stderr.on('data', (d) => (err = (err + d).slice(-2000)))
    p.on('error', reject)
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err))))
  })
}

export function runExport(
  req: ExportRequest,
  onProgress: (p: number) => void
): { promise: Promise<void>; cancel: () => void } {
  const { args, total } = buildExportArgs(req)
  const proc = spawn(FFMPEG, args)
  let tail = ''
  proc.stderr.on('data', (d: Buffer) => {
    const s = d.toString()
    tail = (tail + s).slice(-4000)
    const m = s.match(/time=(\d+):(\d+):(\d+\.\d+)/)
    if (m && total > 0) {
      const t = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
      onProgress(Math.min(1, t / total))
    }
  })
  const promise = new Promise<void>((resolve, reject) => {
    proc.on('error', reject)
    proc.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`Xuất video lỗi (${code}): ${tail.slice(-800)}`))
    )
  })
  return { promise, cancel: () => proc.kill('SIGKILL') }
}
