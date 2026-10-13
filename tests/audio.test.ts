import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chordNotes, encodeWav, normMusic, normSfx } from '../src/audio/spec'
import { dedupe, sceneEvents, timelineEvents } from '../src/audio/autosfx'
import { applyPreset, newShapeLayer, newTextLayer } from '../src/engine/edit'
import { defaultAnimator } from '../src/engine/normalize'

test('encodeWav writes a valid 16-bit PCM header', () => {
  const wav = encodeWav([new Float32Array([0, 1, -1]), new Float32Array([0, 0.5, -0.5])], 48000)
  const v = new DataView(wav.buffer)
  assert.equal(String.fromCharCode(...wav.slice(0, 4)), 'RIFF')
  assert.equal(String.fromCharCode(...wav.slice(8, 12)), 'WAVE')
  assert.equal(v.getUint16(22, true), 2)
  assert.equal(v.getUint32(24, true), 48000)
  assert.equal(v.getUint32(40, true), 3 * 2 * 2)
  assert.equal(v.getInt16(44 + 4, true), 32767)
})

test('chordNotes builds diatonic triads', () => {
  assert.deepEqual(chordNotes('C', 'major', 1, 4), [60, 64, 67])
  assert.deepEqual(chordNotes('C', 'major', 5, 4), [67, 71, 74])
  assert.deepEqual(chordNotes('A', 'minor', 1, 4), [69, 72, 76])
})

test('normSfx / normMusic clamp junk from Claude', () => {
  const s = normSfx({ kind: 'laser', duration: 99, pitch: 'x' })
  assert.equal(s.kind, 'whoosh')
  assert.equal(s.duration, 8)
  assert.equal(s.pitch, 1)
  const m = normMusic({ style: 'tech', bpm: 999, key: 'H', progression: [1, 9, 'a'], drums: { kick: 'x--x', hat: 'nope' } }, 20)
  assert.equal(m.bpm, 180)
  assert.equal(m.key, 'A')
  assert.deepEqual(m.progression, [1, 7, 1])
  assert.equal(m.drums.kick, 'x--x')
  assert.equal(m.length, 20)
})

test('sceneEvents finds text reveals, pops and big moves', () => {
  const t = newTextLayer(1920, 1080, 4)
  t.text.animIn = defaultAnimator('typewriter')
  const pop = applyPreset(newShapeLayer(1920, 1080, 4, 'rect', '#fff'), 'popIn', 1080)
  const mover = newShapeLayer(1920, 1080, 4, 'ellipse', '#fff')
  mover.transform.x = { v: 0, keys: [{ t: 1, v: 0, ease: 'linear' }, { t: 1.3, v: 1500, ease: 'linear' }] }
  const kinds = sceneEvents({ background: null, layers: [t, pop, mover] }, 1920, 1080).map((e) => e.spec.kind).sort()
  assert.deepEqual(kinds, ['pop', 'swish', 'typing'])
})

test('dedupe drops events closer than the gap', () => {
  const e = (t: number) => ({ t, spec: normSfx({}), why: '' })
  assert.deepEqual(dedupe([e(0), e(0.05), e(0.5)]).map((x) => x.t), [0, 0.5])
})

test('timelineEvents maps scene time through clip in/speed and adds transition whooshes', () => {
  const text = newTextLayer(100, 100, 4)
  text.in = 2
  text.text.animIn = defaultAnimator('slideUp')
  const p: any = {
    settings: { width: 100, height: 100, fps: 30 },
    scenes: [{ id: 's', duration: 4, motion: { background: null, layers: [text] } }],
    media: [{ id: 'm', sceneId: 's', duration: 4 }, { id: 'v', duration: 3 }],
    timeline: [
      { id: 'a', mediaId: 'v', in: 0, out: 3, volume: 1, transition: 'fade', transitionDuration: 0.5 },
      { id: 'b', mediaId: 'm', in: 1, out: 4, volume: 1, speed: 2 }
    ],
    tracks: []
  }
  const ts = timelineEvents(p).map((e) => [+e.t.toFixed(2), e.spec.kind])
  // chuyển cảnh tại 2.5s; chữ ở scene t=2 -> clip bắt đầu 2.5 + (2-1)/2 = 3.0
  assert.deepEqual(ts, [[2.5, 'whoosh'], [3, 'swish']])
})
