import { test } from 'node:test'
import assert from 'node:assert/strict'
import { locate, moveClip, splitAt, totalDuration, trimClip } from '../src/lib/timeline'

const mk = (id: string, len: number) => ({ id, mediaId: 'm' + id, in: 0, out: len, volume: 1 })
let n = 0
const newId = () => 'n' + ++n

test('locate finds the clip under the playhead', () => {
  const clips = [mk('a', 2), mk('b', 3)]
  assert.deepEqual(locate(clips, 0.5), { index: 0, local: 0.5 })
  assert.deepEqual(locate(clips, 2.5), { index: 1, local: 0.5 })
  assert.deepEqual(locate(clips, 99), { index: 1, local: 3 })
})

test('splitAt cuts one clip into two with matching in/out', () => {
  const out = splitAt([mk('a', 2), mk('b', 3)], 3, newId)
  assert.equal(out.length, 3)
  assert.deepEqual([out[1].in, out[1].out, out[2].in, out[2].out], [0, 1, 1, 3])
  assert.equal(out[1].mediaId, out[2].mediaId)
  assert.equal(totalDuration(out), 5)
})

test('splitAt ignores cuts right at an edge', () => {
  const clips = [mk('a', 2)]
  assert.equal(splitAt(clips, 0.02, newId), clips)
})

test('trimClip clamps to media and minimum length', () => {
  const clips = [mk('a', 2)]
  assert.equal(trimClip(clips, 'a', 'out', 10, 4)[0].out, 4)
  assert.equal(trimClip(clips, 'a', 'in', 1.99, 4)[0].in, 1.9)
})

test('moveClip reorders', () => {
  const ids = (c: { id: string }[]) => c.map((x) => x.id).join('')
  const clips = [mk('a', 1), mk('b', 1), mk('c', 1)]
  assert.equal(ids(moveClip(clips, 'a', 3)), 'bca')
  assert.equal(ids(moveClip(clips, 'c', 0)), 'cab')
})

import { activeClips, clipStarts, trimLeftAt, trimRightAt } from '../src/lib/timeline'

test('speed changes clip length and split maps to source time', () => {
  const c = { ...mk('a', 4), speed: 2 }
  assert.equal(totalDuration([c]), 2)
  const out = splitAt([c], 1, newId)
  assert.deepEqual([out[0].in, out[0].out, out[1].in, out[1].out], [0, 2, 2, 4])
})

test('transitions overlap clips and shorten the total', () => {
  const a = { ...mk('a', 2), transition: 'fade' as const, transitionDuration: 0.5 }
  const b = mk('b', 2)
  assert.deepEqual(clipStarts([a, b]), [0, 1.5])
  assert.equal(totalDuration([a, b]), 3.5)
  assert.equal(activeClips([a, b], 1.7).length, 2)
  assert.equal(activeClips([a, b], 2.5).length, 1)
})

test('Q / W trim the clip under the playhead (CapCut)', () => {
  const clips = [mk('a', 2), mk('b', 3)]
  assert.deepEqual(trimLeftAt(clips, 3)[1], { ...clips[1], in: 1 })
  assert.deepEqual(trimRightAt(clips, 3)[1], { ...clips[1], out: 1 })
})

import { freeStart, migrateProject, projectDuration, splitTrackClip, trimTrackClip, tEnd } from '../src/lib/timeline'

const tc = (id: string, start: number, len: number) => ({ id, mediaId: 'm', start, in: 0, out: len, volume: 1 })

test('freeStart pushes a clip past occupied ranges', () => {
  const clips = [tc('a', 0, 2), tc('b', 2, 1)]
  assert.equal(freeStart(clips, 1, 1), 3)
  assert.equal(freeStart(clips, 5, 1), 5)
})

test('track clip split and left trim keep content in place', () => {
  const t = { id: 't', kind: 'video' as const, name: 'V1', clips: [tc('a', 1, 4)] }
  const s = splitTrackClip(t, 'a', 3, newId)
  assert.deepEqual(s.clips.map((c) => [c.start, c.in, c.out]), [[1, 0, 2], [3, 2, 4]])
  const tr = trimTrackClip(tc('a', 1, 4), 'in', 1, 10)
  assert.deepEqual([tr.start, tr.in, tEnd(tr)], [2, 1, 5])
})

test('projectDuration covers overlay/audio tracks; music migrates to an audio track', () => {
  const p = { timeline: [mk('a', 2)], tracks: [{ id: 't', kind: 'audio' as const, name: 'A', clips: [tc('x', 3, 4)] }] }
  assert.equal(projectDuration(p), 7)
  const old: any = { version: 1, name: 'x', settings: { width: 1, height: 1, fps: 1 }, elements: [], scenes: [], media: [], timeline: [], music: { mediaId: 'mu', in: 1, volume: 0.5 } }
  const m = migrateProject(old, newId, () => 10)
  assert.equal(m.music, undefined)
  assert.deepEqual(m.tracks![0].clips[0].out, 10)
})
