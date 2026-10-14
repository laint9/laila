// Bộ tổng hợp âm thanh bằng Web Audio (OfflineAudioContext): hiệu ứng âm thanh và nhạc nền.
// Không dùng sample có sẵn, nên không lo bản quyền; chất lượng kiểu "sound design tổng hợp".
import { chordNotes, encodeWav, midiToHz, type MusicSpec, type SfxSpec } from './spec'

export const SR = 48000
type Ctx = BaseAudioContext

// nhiễu trắng xác định (seed) để lần nào render cũng giống nhau
function noiseBuffer(ctx: Ctx, seconds: number, seed = 1): AudioBuffer {
  const len = Math.max(1, Math.floor(ctx.sampleRate * seconds))
  const b = ctx.createBuffer(1, len, ctx.sampleRate)
  const d = b.getChannelData(0)
  let x = seed * 9301 + 49297
  for (let i = 0; i < len; i++) {
    x = (x * 9301 + 49297) % 233280
    d[i] = (x / 233280) * 2 - 1
  }
  return b
}

function reverbIR(ctx: Ctx, seconds: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds)
  const b = ctx.createBuffer(2, len, ctx.sampleRate)
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c)
    let x = 17 + c * 31
    for (let i = 0; i < len; i++) {
      x = (x * 9301 + 49297) % 233280
      d[i] = ((x / 233280) * 2 - 1) * Math.pow(1 - i / len, 3)
    }
  }
  return b
}

/** Bus ra: dry + reverb tuỳ lượng */
function outBus(ctx: Ctx, dest: AudioNode, reverb: number): AudioNode {
  const input = ctx.createGain()
  const dry = ctx.createGain()
  dry.gain.value = 1
  input.connect(dry).connect(dest)
  if (reverb > 0.01) {
    const conv = ctx.createConvolver()
    conv.buffer = reverbIR(ctx, 1.2 + reverb * 1.8)
    const wet = ctx.createGain()
    wet.gain.value = reverb * 0.6
    input.connect(conv).connect(wet).connect(dest)
  }
  return input
}

function env(g: AudioParam, t: number, attack: number, peak: number, decay: number, curve: 'exp' | 'lin' = 'exp') {
  g.setValueAtTime(0.0001, t)
  g.linearRampToValueAtTime(peak, t + Math.max(0.001, attack))
  if (curve === 'exp') g.exponentialRampToValueAtTime(0.0001, t + attack + Math.max(0.01, decay))
  else g.linearRampToValueAtTime(0, t + attack + decay)
}

function noiseSrc(ctx: Ctx, seconds: number, seed = 1) {
  const s = ctx.createBufferSource()
  s.buffer = noiseBuffer(ctx, seconds, seed)
  return s
}

/** Lập lịch 1 hiệu ứng tại thời điểm t vào node đích */
export function scheduleSfx(ctx: Ctx, dest: AudioNode, spec: SfxSpec, t: number, seed = 1) {
  const { duration: dur, pitch: p, intensity: amp, brightness: br } = spec
  const out = outBus(ctx, dest, spec.reverb)
  const level = 0.25 + amp * 0.75
  switch (spec.kind) {
    case 'whoosh':
    case 'swish': {
      const n = noiseSrc(ctx, dur + 0.1, seed)
      const f = ctx.createBiquadFilter()
      f.type = 'bandpass'
      f.Q.value = spec.kind === 'swish' ? 2.5 : 1.2
      const lo = 300 * p,
        hi = (2500 + br * 6000) * p
      f.frequency.setValueAtTime(lo, t)
      f.frequency.exponentialRampToValueAtTime(hi, t + dur * 0.55)
      f.frequency.exponentialRampToValueAtTime(lo * 1.5, t + dur)
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(level, t + dur * 0.5)
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
      const pan = ctx.createStereoPanner()
      pan.pan.setValueAtTime(-0.6, t)
      pan.pan.linearRampToValueAtTime(0.6, t + dur)
      n.connect(f).connect(g).connect(pan).connect(out)
      n.start(t)
      n.stop(t + dur + 0.05)
      break
    }
    case 'riser': {
      const n = noiseSrc(ctx, dur + 0.1, seed)
      const f = ctx.createBiquadFilter()
      f.type = 'highpass'
      f.frequency.setValueAtTime(200 * p, t)
      f.frequency.exponentialRampToValueAtTime((3000 + br * 6000) * p, t + dur)
      const o = ctx.createOscillator()
      o.type = 'sawtooth'
      o.frequency.setValueAtTime(110 * p, t)
      o.frequency.exponentialRampToValueAtTime(880 * p, t + dur)
      const og = ctx.createGain()
      og.gain.value = 0.15
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(level, t + dur * 0.97)
      g.gain.linearRampToValueAtTime(0, t + dur)
      n.connect(f).connect(g)
      o.connect(og).connect(g)
      g.connect(out)
      n.start(t)
      o.start(t)
      n.stop(t + dur)
      o.stop(t + dur)
      break
    }
    case 'impact':
    case 'boom': {
      const o = ctx.createOscillator()
      o.type = 'sine'
      const f0 = (spec.kind === 'boom' ? 90 : 160) * p
      o.frequency.setValueAtTime(f0, t)
      o.frequency.exponentialRampToValueAtTime(f0 * 0.3, t + dur * 0.6)
      const og = ctx.createGain()
      env(og.gain, t, 0.005, level, dur)
      o.connect(og).connect(out)
      o.start(t)
      o.stop(t + dur + 0.05)
      const n = noiseSrc(ctx, 0.4, seed)
      const nf = ctx.createBiquadFilter()
      nf.type = 'lowpass'
      nf.frequency.value = 800 + br * 5000
      const ng = ctx.createGain()
      env(ng.gain, t, 0.002, level * (spec.kind === 'boom' ? 0.4 : 0.8), 0.25)
      n.connect(nf).connect(ng).connect(out)
      n.start(t)
      n.stop(t + 0.4)
      break
    }
    case 'pop': {
      const o = ctx.createOscillator()
      o.type = 'sine'
      o.frequency.setValueAtTime(900 * p, t)
      o.frequency.exponentialRampToValueAtTime(220 * p, t + dur)
      const g = ctx.createGain()
      env(g.gain, t, 0.003, level, dur)
      o.connect(g).connect(out)
      o.start(t)
      o.stop(t + dur + 0.02)
      break
    }
    case 'click': {
      const n = noiseSrc(ctx, 0.05, seed)
      const f = ctx.createBiquadFilter()
      f.type = 'bandpass'
      f.frequency.value = (2000 + br * 4000) * p
      f.Q.value = 3
      const g = ctx.createGain()
      env(g.gain, t, 0.001, level, dur)
      n.connect(f).connect(g).connect(out)
      n.start(t)
      n.stop(t + 0.05)
      break
    }
    case 'glitch': {
      const steps = Math.max(3, Math.round(dur * 18))
      for (let i = 0; i < steps; i++) {
        const tt = t + (dur * i) / steps
        const r = Math.abs(Math.sin(seed * 13.7 + i * 7.1))
        if (r < 0.35) continue
        const o = ctx.createOscillator()
        o.type = r > 0.7 ? 'square' : 'sawtooth'
        o.frequency.value = (120 + r * 1800) * p
        const g = ctx.createGain()
        env(g.gain, tt, 0.001, level * 0.5, dur / steps, 'lin')
        o.connect(g).connect(out)
        o.start(tt)
        o.stop(tt + dur / steps + 0.01)
      }
      break
    }
    case 'chime':
    case 'notification':
    case 'sparkle': {
      // chuông FM: nhiều nốt cao, tắt dần
      const notes = spec.kind === 'chime' ? [84, 91] : spec.kind === 'notification' ? [79, 84] : [96, 100, 103, 108, 103, 108]
      notes.forEach((m, i) => {
        const tt = t + i * (spec.kind === 'sparkle' ? dur / (notes.length * 1.6) : spec.kind === 'notification' ? 0.12 : 0.05)
        const car = ctx.createOscillator()
        car.frequency.value = midiToHz(m) * p
        const mod = ctx.createOscillator()
        mod.frequency.value = midiToHz(m) * p * 3.5
        const mg = ctx.createGain()
        mg.gain.value = midiToHz(m) * p * (0.5 + br)
        mod.connect(mg).connect(car.frequency)
        const g = ctx.createGain()
        env(g.gain, tt, 0.002, level * (spec.kind === 'sparkle' ? 0.25 : 0.4), dur * 0.9)
        car.connect(g).connect(out)
        car.start(tt)
        mod.start(tt)
        car.stop(tt + dur)
        mod.stop(tt + dur)
      })
      break
    }
    case 'typing': {
      const keys = Math.max(2, Math.round(dur * 9))
      for (let i = 0; i < keys; i++) {
        const jitter = Math.abs(Math.sin(seed * 3.1 + i * 12.9)) * 0.06
        const tt = t + (dur * i) / keys + jitter
        const n = noiseSrc(ctx, 0.04, seed + i)
        const f = ctx.createBiquadFilter()
        f.type = 'bandpass'
        f.frequency.value = (1500 + Math.abs(Math.sin(i * 5.3)) * 2500) * p
        f.Q.value = 4
        const g = ctx.createGain()
        env(g.gain, tt, 0.001, level * 0.7, 0.035)
        n.connect(f).connect(g).connect(out)
        n.start(tt)
        n.stop(tt + 0.04)
      }
      break
    }
  }
}

async function renderOffline(seconds: number, build: (ctx: OfflineAudioContext, master: AudioNode) => void): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, Math.max(1, Math.ceil(SR * seconds)), SR)
  const comp = ctx.createDynamicsCompressor()
  comp.threshold.value = -10
  comp.ratio.value = 4
  const master = ctx.createGain()
  master.gain.value = 0.9
  master.connect(comp).connect(ctx.destination)
  build(ctx, master)
  return ctx.startRendering()
}

export function renderSfx(spec: SfxSpec): Promise<AudioBuffer> {
  return renderOffline(spec.duration + 0.3 + spec.reverb * 2, (ctx, m) => scheduleSfx(ctx, m, spec, 0.01))
}

/** Nhiều hiệu ứng trên 1 dải thời gian (tự gắn SFX theo chuyển động) */
export function renderSfxTimeline(events: { t: number; spec: SfxSpec }[], length: number): Promise<AudioBuffer> {
  return renderOffline(length + 1.5, (ctx, m) => events.forEach((e, i) => scheduleSfx(ctx, m, e.spec, Math.max(0, e.t), i + 1)))
}

// ---------- nhạc nền ----------

const softClip = (() => {
  const c = new Float32Array(1024)
  for (let i = 0; i < c.length; i++) {
    const x = (i / (c.length - 1)) * 2 - 1
    c[i] = Math.tanh(2.2 * x)
  }
  return c
})()

/** Tiếng lạo xạo đĩa than cho hip hop / old school */
function vinyl(ctx: OfflineAudioContext, dest: AudioNode, seconds: number, level: number) {
  const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate)
  const d = buf.getChannelData(0)
  let seed = 99
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
  for (let i = 0; i < d.length; i++) {
    d[i] = (rnd() - 0.5) * 0.02
    if (rnd() < 0.0004) d[i] += (rnd() - 0.5) * 0.9
  }
  const src = ctx.createBufferSource()
  src.buffer = buf
  const f = ctx.createBiquadFilter()
  f.type = 'bandpass'
  f.frequency.value = 2500
  const g = ctx.createGain()
  g.gain.value = level
  src.connect(f).connect(g).connect(dest)
  src.start(0)
}

export function renderMusic(spec: MusicSpec): Promise<AudioBuffer> {
  const beat = 60 / spec.bpm
  const bar = beat * 4
  const step = beat / 4
  const bars = Math.ceil(spec.length / bar)
  const e = spec.energy
  return renderOffline(spec.length, (ctx, master) => {
    const fadeOut = Math.min(3, spec.length * 0.2)
    const mix = ctx.createGain()
    mix.gain.setValueAtTime(0.0001, 0)
    mix.gain.linearRampToValueAtTime(1, Math.min(1, spec.length * 0.1))
    mix.gain.setValueAtTime(1, Math.max(0, spec.length - fadeOut))
    mix.gain.linearRampToValueAtTime(0.0001, spec.length)
    mix.connect(master)
    const space = outBus(ctx, mix, spec.style === 'cinematic' ? 0.6 : spec.style === 'chill' || spec.style === 'lofi' ? 0.4 : 0.25)
    if (spec.style === 'hiphop' || spec.style === 'oldschool' || spec.style === 'lofi') vinyl(ctx, mix, spec.length, 0.5)

    for (let b = 0; b < bars; b++) {
      const t0 = b * bar
      const degree = spec.progression[b % spec.progression.length]
      const chord = chordNotes(spec.key, spec.mode, degree, 4)
      // cinematic: phần đầu chỉ pad, trống vào sau
      const intro = spec.style === 'cinematic' && b < 2

      if (spec.instruments.pad) {
        chord.forEach((m) => {
          for (const det of [-6, 6]) {
            const o = ctx.createOscillator()
            o.type = ['lofi', 'chill', 'hiphop', 'trap'].includes(spec.style) ? 'triangle' : 'sawtooth'
            o.frequency.value = midiToHz(m)
            o.detune.value = det
            const f = ctx.createBiquadFilter()
            f.type = 'lowpass'
            f.frequency.value = 900 + e * 1600
            const g = ctx.createGain()
            g.gain.setValueAtTime(0.0001, t0)
            g.gain.linearRampToValueAtTime(0.035 + e * 0.02, t0 + Math.min(0.4, bar * 0.2))
            g.gain.setValueAtTime(0.035 + e * 0.02, t0 + bar * 0.85)
            g.gain.linearRampToValueAtTime(0.0001, t0 + bar)
            o.connect(f).connect(g).connect(space)
            o.start(t0)
            o.stop(t0 + bar + 0.05)
          }
        })
      }

      if (spec.instruments.bass && !intro) {
        const root = chordNotes(spec.key, spec.mode, degree, 2)[0]
        if (spec.style === 'trap') {
          // 808: sine dài, trượt cao độ xuống nốt gốc
          ;[0, 1.75, 2.5].forEach((h, k) => {
            const tt = t0 + h * beat
            const o = ctx.createOscillator()
            o.type = 'sine'
            o.frequency.setValueAtTime(midiToHz(root + (k === 2 ? 7 : 0)), tt)
            if (k === 2) o.frequency.exponentialRampToValueAtTime(midiToHz(root), tt + 0.12)
            const sat = ctx.createWaveShaper()
            sat.curve = softClip
            const g = ctx.createGain()
            env(g.gain, tt, 0.005, 0.45 + e * 0.15, beat * (k === 0 ? 1.6 : 0.7))
            o.connect(sat).connect(g).connect(mix)
            o.start(tt)
            o.stop(tt + beat * 2)
          })
        } else {
          // [beat, độ lệch quãng tám]
          const hits: [number, number][] =
            spec.style === 'cinematic'
              ? [[0, 0]]
              : spec.style === 'chill' || spec.style === 'lofi'
                ? [[0, 0], [2.5, 0]]
                : spec.style === 'hiphop'
                  ? [[0, 0], [1.75, 0], [2.5, 0], [3.5, 12]]
                  : spec.style === 'oldschool'
                    ? [[0, 0], [0.75, 12], [1.5, 0], [2, 0], [2.75, 12], [3.25, 7], [3.5, 0]]
                    : spec.style === 'club'
                      ? [[0.5, 0], [1.5, 0], [2.5, 0], [3.5, 12]]
                      : [[0, 0], [1, 0], [2, 0], [3, 0]]
          hits.forEach(([h, oct]) => {
            const tt = t0 + h * beat
            const o = ctx.createOscillator()
            o.type = spec.style === 'tech' || spec.style === 'club' ? 'square' : spec.style === 'oldschool' ? 'sawtooth' : 'sine'
            o.frequency.value = midiToHz(root + oct)
            const f = ctx.createBiquadFilter()
            f.type = 'lowpass'
            f.frequency.value = spec.style === 'oldschool' ? 700 + e * 500 : 400 + e * 300
            const g = ctx.createGain()
            const len = spec.style === 'cinematic' ? 3.5 : spec.style === 'oldschool' || spec.style === 'club' ? 0.4 : 0.85
            env(g.gain, tt, 0.01, 0.22 + e * 0.1, beat * len)
            o.connect(f).connect(g).connect(mix)
            o.start(tt)
            o.stop(tt + beat * 4)
          })
        }
      }

      if (spec.instruments.arp && !intro) {
        const arp = [...chord, chord[0] + 12]
        const rate = e > 0.6 ? 1 : 2 // 16th hoặc 8th
        for (let i = 0; i < 16; i += rate) {
          const tt = t0 + i * step
          const o = ctx.createOscillator()
          o.type = spec.style === 'tech' ? 'square' : 'triangle'
          o.frequency.value = midiToHz(arp[(i / rate) % arp.length] + 12)
          const f = ctx.createBiquadFilter()
          f.type = 'lowpass'
          f.frequency.value = 2500 + e * 3000
          const g = ctx.createGain()
          env(g.gain, tt, 0.004, 0.05 + e * 0.03, step * rate * 1.6)
          o.connect(f).connect(g).connect(space)
          o.start(tt)
          o.stop(tt + step * rate * 2)
        }
      }

      if (spec.instruments.lead && !intro && spec.style === 'oldschool') {
        // kèn "stab" kiểu funk ở phách 2 lẻ và 4
        ;[1.5, 3].forEach((h) => {
          const tt = t0 + h * beat
          chord.forEach((m) => {
            const o = ctx.createOscillator()
            o.type = 'sawtooth'
            o.frequency.value = midiToHz(m + 12)
            const f = ctx.createBiquadFilter()
            f.type = 'lowpass'
            f.frequency.value = 2400
            const g = ctx.createGain()
            env(g.gain, tt, 0.01, 0.035, beat * 0.35)
            o.connect(f).connect(g).connect(space)
            o.start(tt)
            o.stop(tt + beat * 0.5)
          })
        })
      } else if (spec.instruments.lead && !intro && b % 2 === 1) {
        // câu giai điệu ngắn trên nốt hợp âm
        const motif = [0, 2, 1, 2]
        motif.forEach((k, i) => {
          const tt = t0 + i * beat
          const o = ctx.createOscillator()
          o.type = spec.style === 'lofi' ? 'sine' : 'square'
          o.frequency.value = midiToHz(chord[k] + 12)
          const f = ctx.createBiquadFilter()
          f.type = 'lowpass'
          f.frequency.value = 2000
          const g = ctx.createGain()
          env(g.gain, tt, 0.01, 0.045, beat * 0.9)
          o.connect(f).connect(g).connect(space)
          o.start(tt)
          o.stop(tt + beat)
        })
      }

      if (spec.instruments.drums && !intro) {
        const swing = (spec.swing ?? 0) * step
        const nightlife = ['hiphop', 'oldschool', 'trap', 'club'].includes(spec.style)
        for (let i = 0; i < 16; i++) {
          const tt = t0 + i * step + (i % 2 === 1 ? swing : 0)
          if (spec.drums.kick[i % spec.drums.kick.length] === 'x') {
            const o = ctx.createOscillator()
            // nightlife: kick đậm và dài hơn
            o.frequency.setValueAtTime(nightlife ? 170 : 150, tt)
            o.frequency.exponentialRampToValueAtTime(nightlife ? 42 : 45, tt + (nightlife ? 0.09 : 0.12))
            const g = ctx.createGain()
            env(g.gain, tt, 0.002, (0.5 + e * 0.3) * (nightlife ? 1.25 : 1), nightlife ? 0.36 : 0.28)
            o.connect(g).connect(mix)
            o.start(tt)
            o.stop(tt + 0.32)
          }
          if (spec.drums.snare[i % spec.drums.snare.length] === 'x' && (spec.style === 'club' || spec.style === 'oldschool' || spec.style === 'trap')) {
            // clap: 3 tiếng vỗ sát nhau
            for (let k = 0; k < 3; k++) {
              const n = noiseSrc(ctx, 0.2, b * 16 + i + k * 101)
              const f = ctx.createBiquadFilter()
              f.type = 'bandpass'
              f.frequency.value = 1300
              f.Q.value = 0.9
              const g = ctx.createGain()
              env(g.gain, tt + k * 0.011, 0.001, (0.3 + e * 0.15) * (k === 2 ? 1 : 0.6), k === 2 ? 0.16 : 0.02)
              n.connect(f).connect(g).connect(space)
              n.start(tt + k * 0.011)
              n.stop(tt + k * 0.011 + 0.2)
            }
          } else if (spec.drums.snare[i % spec.drums.snare.length] === 'x') {
            const n = noiseSrc(ctx, 0.25, b * 16 + i)
            const f = ctx.createBiquadFilter()
            f.type = 'bandpass'
            f.frequency.value = spec.style === 'lofi' ? 1400 : 2200
            const g = ctx.createGain()
            env(g.gain, tt, 0.002, 0.18 + e * 0.12, 0.18)
            n.connect(f).connect(g).connect(space)
            n.start(tt)
            n.stop(tt + 0.25)
            const o = ctx.createOscillator()
            o.frequency.value = 190
            const og = ctx.createGain()
            env(og.gain, tt, 0.002, 0.12, 0.09)
            o.connect(og).connect(mix)
            o.start(tt)
            o.stop(tt + 0.12)
          }
          // trap: hi-hat roll (móc tam) cuối mỗi 2 ô nhịp
          const roll = spec.style === 'trap' && b % 2 === 1 && i >= 12
          if (roll) {
            for (let k = 1; k < 3; k++) {
              const n = noiseSrc(ctx, 0.04, 9 + b * 16 + i + k * 37)
              const f = ctx.createBiquadFilter()
              f.type = 'highpass'
              f.frequency.value = 8000
              const g = ctx.createGain()
              const tk = tt + (k * step) / 3
              env(g.gain, tk, 0.001, 0.05 + e * 0.03, 0.03)
              n.connect(f).connect(g).connect(mix)
              n.start(tk)
              n.stop(tk + 0.04)
            }
          }
          if (spec.drums.hat[i % spec.drums.hat.length] === 'x') {
            const n = noiseSrc(ctx, 0.06, 7 + b * 16 + i)
            const f = ctx.createBiquadFilter()
            f.type = 'highpass'
            f.frequency.value = 7000
            const g = ctx.createGain()
            env(g.gain, tt, 0.001, (0.04 + e * 0.04) * (i % 2 ? 0.6 : 1), 0.045)
            n.connect(f).connect(g).connect(mix)
            n.start(tt)
            n.stop(tt + 0.06)
          }
        }
      }

      // cinematic: thêm tiếng trầm "boom" đầu mỗi 2 ô nhịp sau intro
      if (spec.style === 'cinematic' && !intro && b % 2 === 0) {
        scheduleSfx(ctx, mix, { kind: 'boom', duration: 2, pitch: 0.9, intensity: 0.6, brightness: 0.2, reverb: 0.3 }, t0, b)
      }
    }
  })
}

export function bufferToWav(b: AudioBuffer): Uint8Array {
  const chans = Array.from({ length: b.numberOfChannels }, (_, i) => b.getChannelData(i))
  return encodeWav(chans, b.sampleRate)
}

// ---------- nghe thử ----------

let live: { ctx: AudioContext; src: AudioBufferSourceNode } | null = null
export function playBuffer(b: AudioBuffer, onEnd?: () => void) {
  stopPlayback()
  const ctx = new AudioContext()
  const src = ctx.createBufferSource()
  src.buffer = b
  src.connect(ctx.destination)
  src.onended = () => {
    if (live?.src === src) stopPlayback()
    onEnd?.()
  }
  src.start()
  live = { ctx, src }
}
export function stopPlayback() {
  if (!live) return
  try {
    live.src.stop()
  } catch {
    /* đã dừng */
  }
  live.ctx.close()
  live = null
}
