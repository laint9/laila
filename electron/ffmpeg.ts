import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import type { ExportRequest } from '../shared/types'

/**
 * Tìm ffmpeg:
 * 1. App đã đóng gói: Contents/Resources/bin/ffmpeg (đúng kiến trúc máy, xem scripts/build-mac.sh)
 * 2. Chạy dev: gói ffmpeg-static
 * 3. ffmpeg trong PATH
 */
function resolveFfmpeg(): string {
  const resources = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  if (resources) {
    const bundled = join(resources, 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
    if (existsSync(bundled)) return bundled
  }
  try {
    const p = createRequire(__filename)('ffmpeg-static') as string | null
    if (p) {
      const unpacked = p.replace('app.asar', 'app.asar.unpacked')
      if (existsSync(unpacked)) return unpacked
      if (existsSync(p)) return p
    }
  } catch {
    /* không có ffmpeg-static (bản đóng gói) */
  }
  return 'ffmpeg'
}

export const FFMPEG = resolveFfmpeg()

export interface ProbeResult {
  duration: number
  hasAudio: boolean
  hasVideo: boolean
  width?: number
  height?: number
}

/** Đọc thông tin file bằng chính ffmpeg (không cần ffprobe) */
export function parseProbe(stderr: string): ProbeResult {
  const d = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/)
  const duration = d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : 0
  const lines = stderr.split('\n').filter((l) => /^\s*Stream #/.test(l))
  const video = lines.find((l) => /: Video:/.test(l) && !/attached pic/.test(l))
  const size = video?.match(/, (\d{2,5})x(\d{2,5})[\s,[]/)
  return {
    duration,
    hasAudio: lines.some((l) => /: Audio:/.test(l)),
    hasVideo: !!video,
    width: size ? Number(size[1]) : undefined,
    height: size ? Number(size[2]) : undefined
  }
}

export function probe(path: string): Promise<ProbeResult> {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, ['-hide_banner', '-i', path])
    let err = ''
    p.stderr.on('data', (d) => (err += d))
    p.on('error', reject)
    // ffmpeg không có file ra nên luôn thoát mã 1; chỉ coi là lỗi khi không đọc được gì
    p.on('close', () => {
      const r = parseProbe(err)
      if (!r.hasVideo && !r.hasAudio) return reject(new Error('Không đọc được file media: ' + err.split('\n').slice(-3).join(' ')))
      resolve(r)
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

  constructor(outPath: string, fps: number, alpha = false) {
    const input = ['-y', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'png', '-i', '-']
    // alpha: webm VP9 giữ kênh trong suốt để làm lớp phủ
    const out = alpha
      ? ['-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', '20', '-deadline', 'good', '-cpu-used', '4', '-row-mt', '1', '-auto-alt-ref', '0', outPath]
      : ['-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', outPath]
    this.proc = spawn(FFMPEG, [...input, ...out])
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
  let input = 0
  const addInput = (path: string, alpha = false, image?: { until: number }) => {
    // ảnh tĩnh: lặp 1 khung thành luồng video đủ dài cho đoạn cần dùng
    if (image) args.push('-loop', '1', '-framerate', String(fps), '-t', n(image.until + 1))
    // webm có alpha phải giải mã bằng libvpx mới giữ được kênh trong suốt
    else if (alpha) args.push('-c:v', 'libvpx-vp9')
    args.push('-i', path)
    return input++
  }
  const fadesFor = (fadeIn: number, fadeOut: number, d: number) =>
    (fadeIn > 0 ? `,afade=t=in:st=0:d=${n(Math.min(fadeIn, d))}` : '') +
    (fadeOut > 0 ? `,afade=t=out:st=${n(Math.max(0, d - fadeOut))}:d=${n(Math.min(fadeOut, d))}` : '')
  const AF = 'aformat=sample_rates=48000:channel_layouts=stereo'

  req.clips.forEach((c, i) => {
    const k = addInput(c.path, false, c.image ? { until: c.out } : undefined)
    const speed = Math.min(4, Math.max(0.25, c.speed || 1))
    const d = Math.max(0.04, (c.out - c.in) / speed)
    lens.push(d)
    filters.push(
      // ảnh nền trong đặt lên nền đen (giống preview)
      `[${k}:v]${c.image ? 'format=rgba,premultiply=inplace=1,' : ''}trim=start=${n(c.in)}:end=${n(c.out)},setpts=(PTS-STARTPTS)/${speed},` +
        (req.settings.fill
          ? `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},`
          : `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,`) +
        `setsar=1,fps=${fps},format=yuv420p,settb=AVTB[v${i}]`
    )
    if (c.hasAudio) {
      filters.push(
        `[${k}:a]atrim=start=${n(c.in)}:end=${n(c.out)},asetpts=PTS-STARTPTS,${atempoChain(speed)}` +
          `${AF},volume=${c.volume.toFixed(2)},apad=whole_dur=${n(d)},atrim=duration=${n(d)}${fadesFor(c.fadeIn, c.fadeOut, d)}[a${i}]`
      )
    } else {
      filters.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${n(d)}[a${i}]`)
    }
  })

  // track chính: ghép tuần tự, chuyển cảnh dùng xfade/acrossfade, không thì concat
  let vAcc = 'v0'
  let aAcc = 'a0'
  let mainTotal = lens[0] ?? 0
  for (let i = 1; i < req.clips.length; i++) {
    const prev = req.clips[i - 1]
    const kind = XFADE[prev.transition]
    const td = kind ? Math.max(0, Math.min(prev.transitionDuration || 0.5, lens[i - 1] * 0.45, lens[i] * 0.45)) : 0
    const vOut = `vx${i}`
    const aOut = `ax${i}`
    if (kind && td > 0.02) {
      filters.push(`[${vAcc}][v${i}]xfade=transition=${kind}:duration=${n(td)}:offset=${n(mainTotal - td)}[${vOut}]`)
      filters.push(`[${aAcc}][a${i}]acrossfade=d=${n(td)}:c1=tri:c2=tri[${aOut}]`)
      mainTotal += lens[i] - td
    } else {
      filters.push(`[${vAcc}][${aAcc}][v${i}][a${i}]concat=n=2:v=1:a=1[${vOut}][${aOut}]`)
      mainTotal += lens[i]
    }
    vAcc = vOut
    aAcc = aOut
  }

  // tổng thời lượng: dài nhất giữa track chính, lớp phủ và âm thanh
  const clipLen = (c: { in: number; out: number; speed: number }) => Math.max(0.04, (c.out - c.in) / Math.min(4, Math.max(0.25, c.speed || 1)))
  const overlays = req.overlays ?? []
  const audios = req.audios ?? []
  let total = mainTotal
  for (const c of [...overlays, ...audios]) total = Math.max(total, c.start + clipLen(c))
  if (req.music) total = Math.max(total, mainTotal)

  if (!req.clips.length) {
    // không có track chính: nền đen + im lặng
    filters.push(`color=c=black:s=${W}x${H}:r=${fps}:d=${n(total)},format=yuv420p,settb=AVTB[vbase]`)
    filters.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${n(total)}[abase]`)
    vAcc = 'vbase'
    aAcc = 'abase'
  } else if (total > mainTotal + 0.01) {
    filters.push(`[${vAcc}]tpad=stop_mode=add:stop_duration=${n(total - mainTotal)}:color=black[vpad]`)
    filters.push(`[${aAcc}]apad=whole_dur=${n(total)}[apad0]`)
    vAcc = 'vpad'
    aAcc = 'apad0'
  }

  // lớp phủ: vẽ lần lượt từ dưới lên trên
  const mixIns: string[] = [`[${aAcc}]`]
  overlays.forEach((o, j) => {
    const k = addInput(o.path, o.alpha, o.image ? { until: o.out } : undefined)
    const sp = Math.min(4, Math.max(0.25, o.speed || 1))
    const d = clipLen(o)
    const sc = Math.max(0.05, (o.scale || 100) / 100)
    const op = Math.min(1, Math.max(0, (o.opacity ?? 100) / 100))
    filters.push(
      `[${k}:v]trim=start=${n(o.in)}:end=${n(o.out)},setpts=(PTS-STARTPTS)/${sp}+${n(o.start)}/TB,` +
        `scale=w='trunc(${W}*${sc.toFixed(4)}/2)*2':h='trunc(${H}*${sc.toFixed(4)}/2)*2':force_original_aspect_ratio=decrease,` +
        `fps=${fps},format=yuva420p` +
        (op < 0.999 ? `,colorchannelmixer=aa=${op.toFixed(3)}` : '') +
        `[ov${j}]`
    )
    const out = `vo${j}`
    filters.push(
      `[${vAcc}][ov${j}]overlay=x='(W-w)/2+${Math.round(o.x || 0)}':y='(H-h)/2+${Math.round(o.y || 0)}':` +
        `enable='between(t,${n(o.start)},${n(o.start + d)})':eof_action=pass:format=auto,format=yuv420p[${out}]`
    )
    vAcc = out
    if (o.hasAudio && o.volume > 0) {
      const ms = Math.round(o.start * 1000)
      filters.push(
        `[${k}:a]atrim=start=${n(o.in)}:end=${n(o.out)},asetpts=PTS-STARTPTS,${atempoChain(sp)}${AF},` +
          `volume=${o.volume.toFixed(2)}${fadesFor(o.fadeIn, o.fadeOut, d)},adelay=${ms}|${ms}[oa${j}]`
      )
      mixIns.push(`[oa${j}]`)
    }
  })

  // track âm thanh
  audios.forEach((a, j) => {
    if (a.volume <= 0) return
    const k = addInput(a.path)
    const sp = Math.min(4, Math.max(0.25, a.speed || 1))
    const d = clipLen(a)
    const ms = Math.round(a.start * 1000)
    filters.push(
      `[${k}:a]atrim=start=${n(a.in)}:end=${n(a.out)},asetpts=PTS-STARTPTS,${atempoChain(sp)}${AF},` +
        `volume=${a.volume.toFixed(2)}${fadesFor(a.fadeIn, a.fadeOut, d)},adelay=${ms}|${ms}[ta${j}]`
    )
    mixIns.push(`[ta${j}]`)
  })

  // nhạc nền kiểu cũ (project chưa chuyển sang track)
  if (req.music) {
    const k = addInput(req.music.path)
    filters.push(
      `[${k}:a]atrim=start=${n(req.music.in)},asetpts=PTS-STARTPTS,${AF},` +
        `volume=${req.music.volume.toFixed(2)},afade=t=out:st=${n(Math.max(0, total - 1.5))}:d=1.5[mus]`
    )
    mixIns.push('[mus]')
  }

  let audioOut = `[${aAcc}]`
  if (mixIns.length > 1) {
    filters.push(`${mixIns.join('')}amix=inputs=${mixIns.length}:duration=first:dropout_transition=0:normalize=0[aout]`)
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

/** Hình sóng âm (PNG trắng, nền trong) cho clip âm thanh trên timeline */
export function makeWaveform(path: string, outPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, [
      '-y',
      '-i', path,
      '-filter_complex', 'aformat=channel_layouts=mono,showwavespic=s=1600x80:colors=white',
      '-frames:v', '1',
      outPath
    ])
    let err = ''
    p.stderr.on('data', (d) => (err = (err + d).slice(-2000)))
    p.on('error', reject)
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err))))
  })
}

/** Trích khung hình JPEG (rộng tối đa 768px) tại các thời điểm cho trước — dùng để Claude xem reference */
export function extractFrame(path: string, t: number, outPath: string, maxW = 768): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, [
      '-y',
      ...(t > 0 ? ['-ss', t.toFixed(3)] : []),
      '-i', path,
      '-frames:v', '1',
      '-vf', `scale='min(${maxW},iw)':-2`,
      '-q:v', '4',
      outPath
    ])
    let err = ''
    p.stderr.on('data', (d) => (err = (err + d).slice(-2000)))
    p.on('error', reject)
    p.on('close', (code) => (code === 0 && existsSync(outPath) ? resolve() : reject(new Error('Không trích được khung hình: ' + err.slice(-300)))))
  })
}

export interface VideoFrames {
  /** số mẫu mỗi giây */
  fps: number
  /** độ thay đổi so với khung trước 0..1 (chuyển động / cắt cảnh) */
  motion: number[]
  /** độ sáng trung bình 0..255 */
  luma: number[]
  /** độ bão hoà màu trung bình */
  sat: number[]
}

/** Đọc kết quả `metadata=print` của ffmpeg (signalstats + scene score) */
export function parseFrameStats(text: string, fps: number): VideoFrames {
  const motion: number[] = []
  const luma: number[] = []
  const sat: number[] = []
  let i = -1
  for (const line of text.split('\n')) {
    if (line.startsWith('frame:')) {
      i++
      motion[i] = 0
      luma[i] = 0
      sat[i] = 0
      continue
    }
    if (i < 0) continue
    const eq = line.indexOf('=')
    if (eq < 0) continue
    const key = line.slice(0, eq)
    const v = parseFloat(line.slice(eq + 1))
    if (!Number.isFinite(v)) continue
    if (key === 'lavfi.scene_score') motion[i] = v
    else if (key === 'lavfi.signalstats.YAVG') luma[i] = v
    else if (key === 'lavfi.signalstats.SATAVG') sat[i] = v
  }
  return { fps, motion, luma, sat }
}

/** Lấy mẫu video ở `fps` khung/giây (ảnh nhỏ) để đo chuyển động, độ sáng, màu */
export function analyzeVideoFrames(path: string, fps = 8): Promise<VideoFrames> {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, [
      '-hide_banner', '-nostats',
      '-i', path,
      '-an',
      '-vf', `fps=${fps},scale=96:-2,signalstats,select='gte(scene\\,0)',metadata=print:file=-`,
      '-f', 'null', '-'
    ])
    const chunks: Buffer[] = []
    let err = ''
    p.stdout.on('data', (d: Buffer) => chunks.push(d))
    p.stderr.on('data', (d) => (err = (err + d).slice(-2000)))
    p.on('error', reject)
    p.on('close', (code) => (code === 0 ? resolve(parseFrameStats(Buffer.concat(chunks).toString(), fps)) : reject(new Error('Không phân tích được video: ' + err.slice(-300)))))
  })
}
