import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseProbe } from '../electron/ffmpeg'

const dir = mkdtempSync(join(tmpdir(), 'probe-'))
const info = (f: string) => spawnSync('ffmpeg', ['-hide_banner', '-i', f]).stderr.toString()

test('parseProbe reads duration, size and audio from ffmpeg output', () => {
  const v = join(dir, 'v.mp4')
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30', '-f', 'lavfi', '-i', 'sine', '-t', '2.5', '-shortest', '-pix_fmt', 'yuv420p', v])
  const r = parseProbe(info(v))
  assert.ok(Math.abs(r.duration - 2.5) < 0.1, String(r.duration))
  assert.deepEqual([r.width, r.height, r.hasVideo, r.hasAudio], [1280, 720, true, true])
})

test('parseProbe: silent video and audio-only files', () => {
  const v = join(dir, 's.mp4')
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=24', '-t', '1', '-pix_fmt', 'yuv420p', v])
  const r = parseProbe(info(v))
  assert.equal(r.hasAudio, false)
  assert.equal(r.width, 640)
  const a = join(dir, 'a.mp3')
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine', '-t', '3', a])
  const ra = parseProbe(info(a))
  assert.equal(ra.hasVideo, false)
  assert.equal(ra.hasAudio, true)
  assert.ok(Math.abs(ra.duration - 3) < 0.1)
})
