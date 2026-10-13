import { test } from 'node:test'
import assert from 'node:assert/strict'
import { easeFn, valueAt } from '../src/engine/ease'
import { normScene } from '../src/engine/normalize'
import { applyPreset, moveKey, newTextLayer, setPropAt, splitLayer, toggleKeyAt, toggleStopwatch } from '../src/engine/edit'

test('ease curves hit endpoints and easyEase is symmetric', () => {
  for (const e of ['linear', 'easyEase', 'easeOutExpo', 'easeOutBack', 'easeOutElastic', 'easeOutBounce'] as const) {
    assert.ok(Math.abs(easeFn(e)(0)) < 1e-6, e)
    assert.ok(Math.abs(easeFn(e)(1) - 1) < 1e-6, e)
  }
  assert.ok(Math.abs(easeFn('easyEase')(0.5) - 0.5) < 1e-3)
  assert.ok(easeFn('easeOutBack')(0.7) > 1) // overshoot
  assert.equal(easeFn('hold')(0.99), 0)
})

test('valueAt interpolates between keyframes and clamps outside', () => {
  const p = { v: 0, keys: [{ t: 1, v: 0, ease: 'linear' as const }, { t: 3, v: 100, ease: 'linear' as const }] }
  assert.equal(valueAt(p, 0), 0)
  assert.equal(valueAt(p, 2), 50)
  assert.equal(valueAt(p, 9), 100)
})

test('stopwatch, set value and toggle keys behave like AE', () => {
  let p = toggleStopwatch({ v: 10 }, 0)
  assert.equal(p.keys!.length, 1)
  p = setPropAt(p, 2, 50)
  assert.equal(p.keys!.length, 2)
  assert.equal(valueAt(p, 1), 30) // easyEase symmetric at middle
  p = setPropAt(p, 2, 60)
  assert.equal(p.keys!.length, 2)
  p = moveKey(p, 2, 4)
  assert.deepEqual(p.keys!.map((k) => k.t), [0, 4])
  p = toggleKeyAt(p, 4)
  assert.equal(p.keys!.length, 1)
  const off = toggleStopwatch(p, 0)
  assert.equal(off.keys, undefined)
  assert.equal(off.v, 10)
})

test('normScene repairs messy Claude output', () => {
  const s = normScene(
    {
      background: '#000',
      layers: [
        { id: 'a', type: 'text', text: { content: 'Hi', animIn: { preset: 'mask', ease: 'nope' } }, transform: { x: 100, opacity: 300 } },
        { id: 'a', type: 'shape', parent: 'zzz', shape: { kind: 'ellipse' } },
        { type: 'video' },
        { id: 'c', type: 'code', code: { source: '' } },
        { id: 'p1', type: 'shape', parent: 'p2' },
        { id: 'p2', type: 'shape', parent: 'p1' }
      ]
    },
    4,
    1920,
    1080
  )
  assert.equal(s.layers.length, 4)
  const t = s.layers[0]
  assert.equal(t.transform.x.v, 100)
  assert.equal(t.transform.opacity.v, 100)
  assert.equal(t.type === 'text' && t.text.animIn?.ease, 'easyEase')
  assert.notEqual(s.layers[1].id, 'a')
  assert.equal(s.layers[1].parent, null)
  // vòng lặp parent bị cắt
  assert.ok(!(s.layers[2].parent === 'p2' && s.layers[3].parent === 'p1'))
})

test('presets write keyframes anchored on the rest value', () => {
  const l = newTextLayer(1920, 1080, 4)
  const r = applyPreset(l, 'slideUpIn', 1080)
  assert.equal(valueAt(r.transform.y, 0), 540 + 1080 * 0.08)
  assert.equal(valueAt(r.transform.y, 1), 540)
  assert.equal(valueAt(r.transform.opacity, 0), 0)
  const o = applyPreset(r, 'fadeOut', 1080)
  assert.equal(valueAt(o.transform.opacity, 2), 100)
  assert.ok(valueAt(o.transform.opacity, 3.999) < 1)
})

test('splitLayer cuts a layer into two at t', () => {
  const l = newTextLayer(100, 100, 4)
  const s = splitLayer({ background: null, layers: [l] }, l.id, 1.5)
  assert.equal(s.layers.length, 2)
  assert.deepEqual(s.layers.map((x) => [x.in, x.out]), [[1.5, 4], [0, 1.5]])
})
