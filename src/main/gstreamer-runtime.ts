import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const EXPECTED_SHA256 = '31cbc21fa0950b5c1e79c80959b2799805cb05a7a35953a13a9f790776137605'
let pendingInstall: Promise<string | undefined> | undefined

export function privateGstreamerBinary(): string | undefined {
  if (process.platform !== 'win32') return undefined
  const local = process.env.LOCALAPPDATA
  if (!local) return undefined
  const binary = join(local, 'MyRcHiFlY', 'gstreamer-1.26.11', 'PFiles64', 'gstreamer', '1.0', 'msvc_x86_64', 'bin', 'gst-launch-1.0.exe')
  return existsSync(binary) ? binary : undefined
}

/** Extract the verified official runtime privately, without registry writes or administrator prompts. */
export async function ensurePrivateGstreamer(installerPath: string | undefined): Promise<string | undefined> {
  const existing = privateGstreamerBinary()
  if (existing || !installerPath || !existsSync(installerPath) || !process.env.LOCALAPPDATA) return existing
  const installer = resolve(installerPath)
  if (pendingInstall) return pendingInstall
  pendingInstall = (async () => {
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(installer)) hash.update(chunk)
    if (hash.digest('hex') !== EXPECTED_SHA256) return undefined
    const destination = join(process.env.LOCALAPPDATA!, 'MyRcHiFlY', 'gstreamer-1.26.11')
    const child = spawn('msiexec.exe', [
      '/a', installer, '/qn', `TARGETDIR=${destination}`
    ], { shell: false, windowsHide: true, stdio: 'ignore' })
    const exitCode = await new Promise<number | null>((resolve) => {
      child.once('error', () => resolve(null))
      child.once('close', (code) => resolve(code))
    })
    return exitCode === 0 ? privateGstreamerBinary() : undefined
  })().catch(() => undefined).finally(() => { pendingInstall = undefined })
  return pendingInstall
}
