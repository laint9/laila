// Dò nhịp bài nhạc: tempo (BPM), vị trí từng beat, phách mạnh đầu ô nhịp và độ sôi động theo beat.
// Thuần tính toán trên mẫu âm thanh mono để chạy được cả trong renderer lẫn trong test.

export interface BeatInfo {
  bpm: number
  /** thời điểm các beat (giây) */
  beats: number[]
  /** beat đầu ô nhịp 4/4 */
  downbeats: number[]
  /** độ sôi động 0..1 của từng beat (theo âm lượng + lực đánh) */
  energy: number[]
  duration: number
}

const FRAME_RATE = 100 // khung phân tích mỗi giây

/** Đường bao "onset": chỗ âm thanh bật lên (trống, bass), nén log để không bị nốt to lấn át */
export function onsetEnvelope(samples: Float32Array, sampleRate: number) {
  const hop = Math.max(1, Math.round(sampleRate / FRAME_RATE))
  const n = Math.floor(samples.length / hop)
  const full = new Float32Array(n)
  const low = new Float32Array(n)
  // lọc thông thấp 1 cực ~150Hz để tách kick / bass
  const a = Math.exp((-2 * Math.PI * 150) / sampleRate)
  let lp = 0
  for (let i = 0; i < n; i++) {
    let e = 0,
      el = 0
    for (let j = i * hop; j < (i + 1) * hop; j++) {
      const x = samples[j]
      lp = (1 - a) * x + a * lp
      e += x * x
      el += lp * lp
    }
    full[i] = Math.log1p(1000 * (e / hop))
    low[i] = Math.log1p(1000 * (el / hop))
  }
  const onset = new Float32Array(n)
  const kick = new Float32Array(n)
  for (let i = 1; i < n; i++) {
    onset[i] = Math.max(0, full[i] - full[i - 1]) + 0.6 * Math.max(0, low[i] - low[i - 1])
    kick[i] = Math.max(0, low[i] - low[i - 1])
  }
  // bỏ thành phần trung bình trượt (~0.5s) để chỉ còn các đỉnh
  const win = 25
  const out = new Float32Array(n)
  let acc = 0
  for (let i = 0; i < n; i++) {
    acc += onset[i]
    if (i >= win) acc -= onset[i - win]
    out[i] = Math.max(0, onset[i] - acc / Math.min(i + 1, win))
  }
  // fps thật theo bước nhảy đã làm tròn (vd 22050/221), không phải FRAME_RATE danh nghĩa
  return { onset: out, kick, loud: full, fps: sampleRate / hop }
}

/** Ước lượng tempo bằng tự tương quan, ưu tiên vùng 85–135 BPM (hip hop, old school, house) */
export function estimateTempo(onset: Float32Array, fps: number, minBpm = 65, maxBpm = 180): number {
  const minLag = Math.floor((60 * fps) / maxBpm)
  const maxLag = Math.ceil((60 * fps) / minBpm)
  let best = 0,
    bestLag = minLag
  const score = (lag: number) => {
    let s = 0
    for (let i = lag; i < onset.length; i++) s += onset[i] * onset[i - lag]
    return s / (onset.length - lag)
  }
  for (let lag = minLag; lag <= maxLag; lag++) {
    const bpm = (60 * fps) / lag
    // prior log-gauss quanh 110 BPM; cộng thêm điểm của bội 2 (beat đôi) cho ổn định
    const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 110) / 0.6, 2))
    const s = (score(lag) + (2 * lag < onset.length ? 0.5 * score(2 * lag) : 0)) * prior
    if (s > best) {
      best = s
      bestLag = lag
    }
  }
  // tinh chỉnh lag lẻ bằng nội suy parabol
  const y0 = score(bestLag - 1),
    y1 = score(bestLag),
    y2 = score(bestLag + 1)
  const d = y0 - 2 * y1 + y2
  const off = d !== 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (y0 - y2)) / d)) : 0
  return (60 * fps) / (bestLag + off)
}

/** Tinh chỉnh tempo ±2% (bước 0.02 BPM): chọn chu kỳ mà lưới beat đè lên nhiều đỉnh onset nhất trên cả bài */
export function fineTempo(onset: Float32Array, fps: number, bpm: number): number {
  let best = -1,
    bestBpm = bpm
  for (let b = bpm * 0.98; b <= bpm * 1.02; b += 0.02) {
    const P = (60 * fps) / b
    for (let ph = 0; ph < P; ph += 1) {
      let s = 0
      for (let t = ph; t < onset.length - 1; t += P) {
        const i = Math.floor(t)
        s += Math.max(onset[i], onset[i + 1])
      }
      if (s > best) {
        best = s
        bestBpm = b
      }
    }
  }
  return bestBpm
}

/** Dò beat bằng quy hoạch động (Ellis 2007): beat rơi vào đỉnh onset và cách đều quanh chu kỳ tempo */
export function trackBeats(onset: Float32Array, fps: number, bpm: number, tightness = 120): number[] {
  const period = (60 * fps) / bpm
  const n = onset.length
  const score = new Float32Array(n)
  const back = new Int32Array(n).fill(-1)
  for (let t = 0; t < n; t++) {
    let best = 0,
      arg = -1
    const lo = Math.max(0, Math.round(t - 2 * period))
    const hi = Math.round(t - period / 2)
    for (let p = lo; p <= hi; p++) {
      const pen = -tightness * Math.pow(Math.log((t - p) / period), 2)
      const v = score[p] + pen
      if (v > best || arg < 0) {
        best = v
        arg = p
      }
    }
    score[t] = onset[t] + (arg >= 0 ? Math.max(0, best) : 0)
    back[t] = arg >= 0 && best > 0 ? arg : -1
  }
  // điểm kết thúc: điểm cao nhất trong chu kỳ cuối
  let end = n - 1
  for (let t = Math.max(0, Math.floor(n - period)); t < n; t++) if (score[t] > score[end]) end = t
  const out: number[] = []
  for (let t = end; t >= 0; t = back[t]) {
    out.push(t / fps)
    if (back[t] < 0) break
  }
  out.reverse()
  // bù các beat đầu bài bị thiếu (đoạn intro nhỏ tiếng)
  const sp = 60 / bpm
  while (out.length && out[0] - sp > -0.02) out.unshift(Math.max(0, out[0] - sp))
  return out
}

/** Kéo từng beat về đúng đỉnh onset gần nhất (±40ms), nội suy để mịn hơn 1 khung */
function refine(beats: number[], onset: Float32Array, fps: number): number[] {
  const r = Math.round(0.04 * fps)
  return beats.map((t) => {
    const c = Math.round(t * fps)
    let m = c
    for (let k = Math.max(1, c - r); k <= Math.min(onset.length - 2, c + r); k++) if (onset[k] > onset[m]) m = k
    if (!(onset[m] > 0) || m <= 0 || m >= onset.length - 1) return t
    const y0 = onset[m - 1],
      y1 = onset[m],
      y2 = onset[m + 1]
    const d = y0 - 2 * y1 + y2
    const off = d !== 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (y0 - y2)) / d)) : 0
    return Math.max(0, (m + off) / fps)
  })
}

/** Phân tích đầy đủ */
export function analyzeBeats(samples: Float32Array, sampleRate: number): BeatInfo {
  const duration = samples.length / sampleRate
  const { onset, kick, loud, fps } = onsetEnvelope(samples, sampleRate)
  const bpm = fineTempo(onset, fps, estimateTempo(onset, fps))
  const beats = refine(trackBeats(onset, fps, bpm), onset, fps).filter((t) => t < duration)
  // phách mạnh: chọn pha (0..3) mà beat có kick mạnh nhất
  const near = (arr: Float32Array, t: number) => {
    const i = Math.round(t * fps)
    let m = 0
    for (let k = Math.max(0, i - 3); k <= Math.min(arr.length - 1, i + 3); k++) m = Math.max(m, arr[k])
    return m
  }
  const phaseScore = [0, 0, 0, 0]
  beats.forEach((t, i) => (phaseScore[i % 4] += near(kick, t) + 0.5 * near(onset, t)))
  // kick hip hop thường ở phách 1 và 3: ghép 2 pha cách nhau 2 beat, phách 1 là pha mạnh hơn
  const pair = [0, 1].map((p) => phaseScore[p] + phaseScore[p + 2])
  const base = pair[0] >= pair[1] ? 0 : 1
  const phase = phaseScore[base] >= phaseScore[base + 2] ? base : base + 2
  const downbeats = beats.filter((_, i) => i % 4 === phase)
  // độ sôi động: âm lượng trung bình quanh beat (chuẩn hoá 0..1 theo bài)
  const raw = beats.map((t, i) => {
    const a = Math.round(t * fps)
    const b = Math.round((beats[i + 1] ?? t + 60 / bpm) * fps)
    let s = 0,
      c = 0
    for (let k = a; k < Math.min(loud.length, b); k++) {
      s += loud[k] + 2 * onset[k]
      c++
    }
    return c ? s / c : 0
  })
  const lo = Math.min(...raw),
    hi = Math.max(...raw)
  const energy = raw.map((v) => (hi > lo ? (v - lo) / (hi - lo) : 0.5))
  // làm mượt 4 beat để ra "đoạn" chứ không phải từng nốt
  const smooth = energy.map((_, i) => {
    let s = 0,
      c = 0
    for (let k = i - 2; k <= i + 2; k++)
      if (k >= 0 && k < energy.length) {
        s += energy[k]
        c++
      }
    return s / c
  })
  return { bpm: Math.round(bpm * 10) / 10, beats, downbeats, energy: smooth, duration }
}

/** Beat đều cho nhạc tự tạo (biết trước tempo) */
export function gridBeats(bpm: number, duration: number, energy = 0.8): BeatInfo {
  const sp = 60 / bpm
  const beats: number[] = []
  for (let t = 0; t < duration - 0.01; t += sp) beats.push(Math.round(t * 1000) / 1000)
  return { bpm, beats, downbeats: beats.filter((_, i) => i % 4 === 0), energy: beats.map(() => energy), duration }
}
