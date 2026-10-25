import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { RETRIK_MODEL } from '../shared/radio-model.js'

export async function readRetrikArchive(webRoot: string): Promise<Buffer> {
  const data = await readFile(join(webRoot, 'radio-models', RETRIK_MODEL.fileName))
  if (data.length !== RETRIK_MODEL.bytes || createHash('sha256').update(data).digest('hex') !== RETRIK_MODEL.sha256) {
    throw new Error('Пакет RETRIK пошкоджено. Перевстанови програму з офіційного інсталятора.')
  }
  return data
}

export async function saveRetrikArchive(webRoot: string, chooseFile: () => Promise<string | undefined>): Promise<boolean> {
  const data = await readRetrikArchive(webRoot)
  const path = await chooseFile()
  if (!path) return false
  await writeFile(path, data)
  return true
}
