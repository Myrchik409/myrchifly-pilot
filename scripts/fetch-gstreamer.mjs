import { createHash } from 'node:crypto'
import { createWriteStream, existsSync } from 'node:fs'
import { mkdir, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { once } from 'node:events'

const expected = '31cbc21fa0950b5c1e79c80959b2799805cb05a7a35953a13a9f790776137605'
const url = 'https://gstreamer.freedesktop.org/data/pkg/windows/1.26.11/msvc/gstreamer-1.0-msvc-x86_64-1.26.11.msi'
const destination = fileURLToPath(new URL('../build/gstreamer-runtime-1.26.11.msi', import.meta.url))
const temporary = `${destination}.download`
async function sha256(path) {
  const { createReadStream } = await import('node:fs')
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}
if (existsSync(destination) && await sha256(destination) === expected) process.exit(0)
await mkdir(join(destination, '..'), { recursive: true })
try {
  const response = await fetch(url, { signal: AbortSignal.timeout(180_000) })
  if (!response.ok || !response.body || new URL(response.url).hostname !== 'gstreamer.freedesktop.org') throw new Error('GStreamer download failed')
  const output = createWriteStream(temporary)
  let bytes = 0
  for await (const chunk of response.body) {
    bytes += chunk.length
    if (bytes > 250 * 1024 * 1024) throw new Error('GStreamer installer too large')
    if (!output.write(chunk)) await once(output, 'drain')
  }
  output.end()
  await once(output, 'finish')
  if (await sha256(temporary) !== expected) throw new Error('GStreamer checksum mismatch')
  await rename(temporary, destination)
} catch (error) {
  await rm(temporary, { force: true })
  throw error
}
