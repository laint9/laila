// Chạy toàn bộ luồng dựng theo nhạc trong app: phân tích nhạc + video, (tuỳ chọn) Claude chấm cảnh, rồi đặt lên timeline.
import { analyzeBeats, gridBeats, type BeatInfo } from '../audio/beats'
import { MUSIC_PRESETS, MUSIC_STYLE_LABELS, normMusic, type MusicStyle } from '../audio/spec'
import { bufferToWav, renderMusic } from '../audio/synth'
import { buildPlan, detectShots, type EditPlan, type Pace, type Shot, type SourceInfo } from './autoedit'
import { mediaUrl, uid } from './media'
import { useStore } from './store'

export type MusicChoice = { kind: 'media'; mediaId: string } | { kind: 'generate'; style: MusicStyle; bpm: number }

export interface AutoEditRequest {
  videoIds: string[]
  music: MusicChoice
  duration: number
  pace: Pace
  musicStart: 'auto' | 'start'
  useClaude: boolean
  brief: string
  mode: 'replace' | 'append'
  /** âm lượng tiếng gốc của video 0..1 */
  sourceVolume: number
}

export interface AutoEditResult {
  plan: EditPlan
  musicName: string
  shots: number
  rated: number
  notes: string
  warnings: string[]
}

const beatCache = new Map<string, BeatInfo>()

/** Giải mã file nhạc, trộn mono rồi dò beat */
export async function beatsOfMedia(path: string): Promise<BeatInfo> {
  const hit = beatCache.get(path)
  if (hit) return hit
  const data = await (await fetch(mediaUrl(path))).arrayBuffer()
  const ctx = new OfflineAudioContext(1, 1, 44100)
  const buf = await ctx.decodeAudioData(data)
  const mono = new Float32Array(buf.length)
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c)
    for (let i = 0; i < d.length; i++) mono[i] += d[i] / buf.numberOfChannels
  }
  // nhường luồng giao diện 1 nhịp trước khi tính nặng
  await new Promise((r) => setTimeout(r, 0))
  const info = analyzeBeats(mono, buf.sampleRate)
  beatCache.set(path, info)
  return info
}

/** Chọn tối đa `max` cảnh để gửi Claude: ưu tiên cảnh dài, rải đều các video */
function pickForRating(shots: Shot[], max: number): Shot[] {
  const usable = shots.filter((s) => s.end - s.start >= 0.4)
  if (usable.length <= max) return usable
  const bySrc = new Map<string, Shot[]>()
  for (const s of usable) bySrc.set(s.mediaId, [...(bySrc.get(s.mediaId) ?? []), s])
  for (const arr of bySrc.values()) arr.sort((a, b) => b.end - b.start - (a.end - a.start))
  const out: Shot[] = []
  while (out.length < max) {
    let added = false
    for (const arr of bySrc.values()) {
      const s = arr.shift()
      if (s && out.length < max) {
        out.push(s)
        added = true
      }
    }
    if (!added) break
  }
  return out
}

export async function runAutoEdit(req: AutoEditRequest, onStep: (msg: string, p?: number) => void, signalId?: (id: string) => void): Promise<AutoEditResult> {
  const st = useStore.getState()
  const media = st.project.media
  const videos = req.videoIds.map((id) => media.find((m) => m.id === id)).filter((m) => m && (m.kind === 'video' || m.kind === 'motion'))
  if (!videos.length) throw new Error('Chọn ít nhất 1 video')
  const warnings: string[] = []
  let duration = Math.max(3, req.duration)

  // 1. nhạc
  let musicId: string
  let musicName: string
  let info: BeatInfo
  if (req.music.kind === 'generate') {
    onStep('Đang tạo nhạc…')
    const spec = normMusic({ ...MUSIC_PRESETS[req.music.style], bpm: req.music.bpm, length: duration + 1.5 }, duration + 1.5)
    const buf = await renderMusic(spec)
    const name = `${MUSIC_STYLE_LABELS[spec.style].split(' (')[0]} ${spec.bpm} BPM`
    const item = await window.laila.audio.save(name, bufferToWav(buf))
    useStore.getState().addMedia([item])
    musicId = item.id
    musicName = item.name
    info = gridBeats(spec.bpm, buf.duration, 0.8)
  } else {
    const m = media.find((x) => x.id === (req.music as { mediaId: string }).mediaId)
    if (!m) throw new Error('Không thấy file nhạc')
    onStep('Đang dò nhịp bài nhạc…')
    info = await beatsOfMedia(m.path)
    musicId = m.id
    musicName = m.name
    if (info.beats.length < 8) throw new Error('Không dò được nhịp bài nhạc (bài quá ngắn hoặc không có tiếng trống rõ)')
  }
  if (info.duration < duration - 0.05) {
    warnings.push(`Bài nhạc chỉ dài ${info.duration.toFixed(1)}s nên video rút còn ${Math.floor(info.duration)}s`)
    duration = Math.floor(info.duration)
  }

  // 2. video
  const sources: SourceInfo[] = []
  for (let i = 0; i < videos.length; i++) {
    const v = videos[i]!
    onStep(`Đang xem video ${i + 1}/${videos.length}: ${v.name}`, i / videos.length)
    const frames = await window.laila.autoedit.analyze(v.path)
    sources.push({ mediaId: v.id, duration: v.duration, frames })
  }
  const shots = sources.flatMap((s) => detectShots(s))

  // 3. Claude chấm cảnh
  let rated = 0
  let notes = ''
  if (req.useClaude) {
    const pick = pickForRating(shots, 40)
    onStep(`Claude đang xem ${pick.length} cảnh…`)
    try {
      const pathOf = (id: string) => media.find((m) => m.id === id)!.path
      const imgs = await window.laila.autoedit.thumbs(pick.map((s) => ({ path: pathOf(s.mediaId), t: (s.start + s.end) / 2 })))
      const withImg = pick.map((s, i) => ({ s, img: imgs[i] })).filter((x) => x.img)
      const reqId = uid()
      signalId?.(reqId)
      const r = await window.laila.autoedit.rateShots(reqId, {
        shots: withImg.map((x, i) => ({ id: String(i + 1), length: x.s.end - x.s.start, image: x.img })),
        brief: req.brief
      })
      for (const rt of r.ratings) {
        const sh = withImg[Number(rt.id) - 1]?.s
        if (!sh) continue
        sh.rating = rt.score
        sh.tag = rt.tag
        sh.skip = rt.skip
        rated++
      }
      notes = r.notes
    } catch (e) {
      warnings.push('Claude chưa chấm được cảnh, dùng điểm tự động: ' + (e as Error).message.slice(0, 160))
    }
  }

  // 4. dựng
  onStep('Đang ghép cảnh theo beat…')
  const plan = buildPlan(info, sources, shots, { duration, pace: req.pace, musicStart: req.musicStart === 'start' ? (info.downbeats[0] ?? 0) : 'auto' })
  useStore.getState().applyAutoEdit(plan, musicId, { mode: req.mode, sourceVolume: req.sourceVolume })
  return { plan, musicName, shots: shots.length, rated, notes, warnings }
}
