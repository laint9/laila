import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { parseFontFile } from '../electron/fonts'

test('parseFontFile đọc family/style giống fontconfig', () => {
  let list = ''
  try {
    list = execFileSync('fc-list', [':', 'file', 'family', 'style']).toString()
  } catch {
    return // máy không có fontconfig: bỏ qua
  }
  const rows = list.split('\n').filter((l) => /\.(ttf|otf)\s*:/i.test(l)).slice(0, 10)
  assert.ok(rows.length > 0)
  for (const row of rows) {
    const [file, fam] = row.split(':')
    const faces = parseFontFile(readFileSync(file.trim()))
    assert.equal(faces.length, 1, file)
    const families = fam.trim().split(',')
    assert.ok(families.includes(faces[0].family), `${file}: ${faces[0].family} ∉ ${families}`)
    assert.ok(faces[0].style.length > 0)
  }
})

test('parseFontFile bỏ qua file không phải font', () => {
  assert.deepEqual(parseFontFile(Buffer.from('not a font at all')), [])
  assert.deepEqual(parseFontFile(Buffer.alloc(4)), [])
})
