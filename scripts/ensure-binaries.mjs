import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)
const root = process.cwd()
const binaries = [
  { path: join(root, 'node_modules', 'electron', 'dist', 'electron.exe'), script: join(root, 'node_modules', 'electron', 'install.js') },
  { path: join(root, 'node_modules', 'ffmpeg-static', 'ffmpeg.exe'), script: join(root, 'node_modules', 'ffmpeg-static', 'install.js') }
]
for (const binary of binaries) {
  if (existsSync(binary.path)) continue
  await run(process.execPath, [binary.script], { cwd: root, timeout: 180_000 })
  if (!existsSync(binary.path)) throw new Error(`Missing runtime binary: ${binary.path}`)
}
