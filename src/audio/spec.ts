// Thông số âm thanh (thuần dữ liệu, dùng chung cho synth, Claude và test).

export const SFX_KINDS = ['whoosh', 'swish', 'riser', 'impact', 'boom', 'pop', 'click', 'glitch', 'chime', 'sparkle', 'typing', 'notification'] as const
export type SfxKind = (typeof SFX_KINDS)[number]

export const SFX_LABELS: Record<SfxKind, string> = {
  whoosh: 'Whoosh (vút qua)',
  swish: 'Swish (lướt nhanh)',
  riser: 'Riser (dâng lên)',
  impact: 'Impact (đập mạnh)',
  boom: 'Boom (trầm, sâu)',
  pop: 'Pop (bật)',
  click: 'Click (UI)',
  glitch: 'Glitch (nhiễu số)',
  chime: 'Chime (chuông)',
  sparkle: 'Sparkle (lấp lánh)',
  typing: 'Gõ phím',
  notification: 'Thông báo'
}

export interface SfxSpec {
  kind: SfxKind
  /** giây */
  duration: number
  /** hệ số cao độ 0.5..2 */
  pitch: number
  /** 0..1 */
  intensity: number
  /** 0..1 (tối -> sáng) */
  brightness: number
  /** 0..1 */
  reverb: number
}

export const SFX_DEFAULTS: Record<SfxKind, Omit<SfxSpec, 'kind'>> = {
  whoosh: { duration: 0.7, pitch: 1, intensity: 0.8, brightness: 0.5, reverb: 0.2 },
  swish: { duration: 0.35, pitch: 1.2, intensity: 0.7, brightness: 0.7, reverb: 0.1 },
  riser: { duration: 2, pitch: 1, intensity: 0.7, brightness: 0.6, reverb: 0.3 },
  impact: { duration: 1.2, pitch: 1, intensity: 0.9, brightness: 0.4, reverb: 0.35 },
  boom: { duration: 2, pitch: 0.8, intensity: 1, brightness: 0.2, reverb: 0.4 },
  pop: { duration: 0.18, pitch: 1, intensity: 0.8, brightness: 0.6, reverb: 0.05 },
  click: { duration: 0.06, pitch: 1, intensity: 0.7, brightness: 0.8, reverb: 0 },
  glitch: { duration: 0.5, pitch: 1, intensity: 0.7, brightness: 0.7, reverb: 0.05 },
  chime: { duration: 1.6, pitch: 1, intensity: 0.6, brightness: 0.7, reverb: 0.5 },
  sparkle: { duration: 1.2, pitch: 1.3, intensity: 0.6, brightness: 0.9, reverb: 0.5 },
  typing: { duration: 1.2, pitch: 1, intensity: 0.6, brightness: 0.6, reverb: 0.05 },
  notification: { duration: 0.6, pitch: 1, intensity: 0.7, brightness: 0.6, reverb: 0.3 }
}

export const MUSIC_STYLES = ['corporate', 'upbeat', 'chill', 'tech', 'cinematic', 'lofi'] as const
export type MusicStyle = (typeof MUSIC_STYLES)[number]

export const MUSIC_STYLE_LABELS: Record<MusicStyle, string> = {
  corporate: 'Corporate (doanh nghiệp, tích cực)',
  upbeat: 'Upbeat (sôi động, quảng cáo)',
  chill: 'Chill (nhẹ nhàng)',
  tech: 'Tech (tối giản, điện tử)',
  cinematic: 'Cinematic (hùng tráng, dâng trào)',
  lofi: 'Lo-fi (ấm, thư giãn)'
}

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const

export interface MusicSpec {
  style: MusicStyle
  bpm: number
  key: (typeof NOTE_NAMES)[number]
  mode: 'major' | 'minor'
  /** bậc hợp âm theo ô nhịp, 1..7 (vd [1,5,6,4]) */
  progression: number[]
  /** giây */
  length: number
  /** 0..1 */
  energy: number
  instruments: { pad: boolean; bass: boolean; arp: boolean; drums: boolean; lead: boolean }
  /** pattern 16 bước, 'x' = đánh, '-' = nghỉ */
  drums: { kick: string; snare: string; hat: string }
}

const D = (kick: string, snare: string, hat: string) => ({ kick, snare, hat })

export const MUSIC_PRESETS: Record<MusicStyle, Omit<MusicSpec, 'length'>> = {
  corporate: { style: 'corporate', bpm: 112, key: 'C', mode: 'major', progression: [1, 5, 6, 4], energy: 0.6, instruments: { pad: true, bass: true, arp: true, drums: true, lead: false }, drums: D('x---x---x---x---', '----x-------x---', 'x-x-x-x-x-x-x-x-') },
  upbeat: { style: 'upbeat', bpm: 124, key: 'G', mode: 'major', progression: [1, 6, 4, 5], energy: 0.85, instruments: { pad: true, bass: true, arp: true, drums: true, lead: true }, drums: D('x---x---x---x---', '----x-------x---', 'xxxxxxxxxxxxxxxx') },
  chill: { style: 'chill', bpm: 88, key: 'F', mode: 'major', progression: [1, 3, 6, 4], energy: 0.35, instruments: { pad: true, bass: true, arp: true, drums: true, lead: false }, drums: D('x-------x-x-----', '----x-------x---', '--x---x---x---x-') },
  tech: { style: 'tech', bpm: 118, key: 'A', mode: 'minor', progression: [1, 1, 6, 7], energy: 0.65, instruments: { pad: true, bass: true, arp: true, drums: true, lead: false }, drums: D('x---x---x---x---', '----x-------x---', '--x---x---x---x-') },
  cinematic: { style: 'cinematic', bpm: 90, key: 'D', mode: 'minor', progression: [1, 6, 3, 7], energy: 0.7, instruments: { pad: true, bass: true, arp: false, drums: true, lead: false }, drums: D('x-------x-------', '------------x---', '----------------') },
  lofi: { style: 'lofi', bpm: 80, key: 'E', mode: 'minor', progression: [4, 3, 2, 5], energy: 0.4, instruments: { pad: true, bass: true, arp: false, drums: true, lead: true }, drums: D('x------x--x-----', '----x-------x---', 'x-x-x-x-x-x-x-x-') }
}

const clampN = (v: unknown, d: number, lo: number, hi: number) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d
}
const pattern = (v: unknown, d: string) => (typeof v === 'string' && /^[x\-.]{4,32}$/i.test(v) ? v.toLowerCase().replace(/\./g, '-') : d)

/** Chuẩn hoá thông số SFX (từ Claude hoặc người dùng) */
export function normSfx(raw: unknown): SfxSpec {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const kind = (SFX_KINDS as readonly string[]).includes(r.kind as string) ? (r.kind as SfxKind) : 'whoosh'
  const d = SFX_DEFAULTS[kind]
  return {
    kind,
    duration: clampN(r.duration, d.duration, 0.03, 8),
    pitch: clampN(r.pitch, d.pitch, 0.5, 2),
    intensity: clampN(r.intensity, d.intensity, 0, 1),
    brightness: clampN(r.brightness, d.brightness, 0, 1),
    reverb: clampN(r.reverb, d.reverb, 0, 1)
  }
}

/** Chuẩn hoá thông số nhạc */
export function normMusic(raw: unknown, fallbackLength = 15): MusicSpec {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const style = (MUSIC_STYLES as readonly string[]).includes(r.style as string) ? (r.style as MusicStyle) : 'corporate'
  const p = MUSIC_PRESETS[style]
  const inst = (r.instruments && typeof r.instruments === 'object' ? r.instruments : {}) as Record<string, unknown>
  const dr = (r.drums && typeof r.drums === 'object' ? r.drums : {}) as Record<string, unknown>
  const prog = Array.isArray(r.progression) ? r.progression.map((x) => Math.round(clampN(x, 1, 1, 7))).slice(0, 8) : p.progression
  return {
    style,
    bpm: Math.round(clampN(r.bpm, p.bpm, 60, 180)),
    key: (NOTE_NAMES as readonly string[]).includes(r.key as string) ? (r.key as MusicSpec['key']) : p.key,
    mode: r.mode === 'minor' || r.mode === 'major' ? r.mode : p.mode,
    progression: prog.length ? prog : p.progression,
    length: clampN(r.length, fallbackLength, 2, 300),
    energy: clampN(r.energy, p.energy, 0, 1),
    instruments: {
      pad: typeof inst.pad === 'boolean' ? inst.pad : p.instruments.pad,
      bass: typeof inst.bass === 'boolean' ? inst.bass : p.instruments.bass,
      arp: typeof inst.arp === 'boolean' ? inst.arp : p.instruments.arp,
      drums: typeof inst.drums === 'boolean' ? inst.drums : p.instruments.drums,
      lead: typeof inst.lead === 'boolean' ? inst.lead : p.instruments.lead
    },
    drums: { kick: pattern(dr.kick, p.drums.kick), snare: pattern(dr.snare, p.drums.snare), hat: pattern(dr.hat, p.drums.hat) }
  }
}

// ---------- nhạc lý ----------

const SCALES = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10] }

export const midiToHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12)

/** Hợp âm 3 nốt (MIDI) của bậc `degree` trong giọng, quanh quãng tám `octave` */
export function chordNotes(key: MusicSpec['key'], mode: MusicSpec['mode'], degree: number, octave = 4): number[] {
  const scale = SCALES[mode]
  const root = 12 * (octave + 1) + NOTE_NAMES.indexOf(key)
  const at = (i: number) => {
    const o = Math.floor(i / 7)
    return root + scale[((i % 7) + 7) % 7] + 12 * o
  }
  const d = degree - 1
  return [at(d), at(d + 2), at(d + 4)]
}

// ---------- WAV ----------

/** Mã hoá PCM 16-bit WAV từ các kênh float */
export function encodeWav(channels: Float32Array[], sampleRate: number): Uint8Array {
  const n = channels[0]?.length ?? 0
  const ch = channels.length
  const dataLen = n * ch * 2
  const buf = new ArrayBuffer(44 + dataLen)
  const v = new DataView(buf)
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)))
  str(0, 'RIFF')
  v.setUint32(4, 36 + dataLen, true)
  str(8, 'WAVE')
  str(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, ch, true)
  v.setUint32(24, sampleRate, true)
  v.setUint32(28, sampleRate * ch * 2, true)
  v.setUint16(32, ch * 2, true)
  v.setUint16(34, 16, true)
  str(36, 'data')
  v.setUint32(40, dataLen, true)
  let o = 44
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      const s = Math.max(-1, Math.min(1, channels[c][i]))
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true)
      o += 2
    }
  }
  return new Uint8Array(buf)
}
