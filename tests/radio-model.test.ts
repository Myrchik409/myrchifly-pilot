import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readRetrikArchive, saveRetrikArchive } from '../src/main/radio-model'
import { RETRIK_MODEL } from '../src/shared/radio-model'

test('exports the packaged archive unchanged to the selected destination', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'pilot-retrik-'))
  try {
    const destination = join(temp, 'model.zip')
    assert.equal(await saveRetrikArchive('assets', async () => destination), true)
    assert.deepEqual(await readFile(destination), await readRetrikArchive('assets'))
  } finally { await rm(temp, { recursive: true, force: true }) }
})
test('cancelled save writes no file', async () => {
  assert.equal(await saveRetrikArchive('assets', async () => undefined), false)
})
test('rejects a damaged model package before opening the save dialog', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'pilot-retrik-'))
  try {
    await mkdir(join(temp, 'radio-models'))
    const bytes = await readRetrikArchive('assets'); bytes[0] ^= 1
    await writeFile(join(temp, 'radio-models', RETRIK_MODEL.fileName), bytes)
    let called = false
    await assert.rejects(saveRetrikArchive(temp, async () => { called = true; return undefined }), /пошкоджено/)
    assert.equal(called, false)
  } finally { await rm(temp, { recursive: true, force: true }) }
})
