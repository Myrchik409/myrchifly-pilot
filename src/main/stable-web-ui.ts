import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { startHostedWebUi } from './web-ui-server.js'

export async function startStableWebUi(profileDirectory: string, webDistDir?: string) {
  const file = join(profileDirectory, 'ardupilot-host-port.json')
  let port = 0
  try {
    const value: unknown = JSON.parse(await readFile(file, 'utf8'))
    if (Number.isInteger(value) && Number(value) > 1024 && Number(value) < 65536) port = Number(value)
  } catch {}
  let host
  try { host = await startHostedWebUi({ webDistDir, port }) }
  catch (error) {
    if (!port || (error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error
    host = await startHostedWebUi({ webDistDir })
  }
  await writeFile(file, JSON.stringify(Number(new URL(host.url).port)))
  return host
}
