import { createHash } from 'node:crypto'
import { mkdir, open, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { spawn } from 'node:child_process'

const owner = 'Myrchik409'
const repository = 'myrchifly-pilot'
const releaseApi = `https://api.github.com/repos/${owner}/${repository}/releases/latest`
const maxInstallerBytes = 600 * 1024 * 1024

export interface PilotUpdate {
  currentVersion: string
  latestVersion: string
  available: boolean
  releaseUrl: string
  installerBytes?: number
}

export interface PilotReleaseAsset {
  version: string
  url: string
  size: number
  digest: string
}

export function compareVersions(left: string, right: string): number {
  const parts = (version: string) => /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version)?.slice(1).map(Number)
  const a = parts(left)
  const b = parts(right)
  if (!a || !b) throw new Error('Некоректна версія оновлення.')
  for (let index = 0; index < 3; index++) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1
  }
  return 0
}

export function parseRelease(payload: unknown): { version: string; page: string; asset?: PilotReleaseAsset } {
  if (!payload || typeof payload !== 'object') throw new Error('GitHub повернув некоректні дані релізу.')
  const release = payload as Record<string, unknown>
  const version = String(release.tag_name ?? '').replace(/^v/, '')
  compareVersions(version, version)
  const page = String(release.html_url ?? '')
  if (page !== `https://github.com/${owner}/${repository}/releases/tag/v${version}`) throw new Error('Невірна адреса релізу.')
  const assets = Array.isArray(release.assets) ? release.assets as Record<string, unknown>[] : []
  const item = assets.find(asset => {
    const name = String(asset.name ?? '').toLowerCase()
    return name === `myrchifly pilot setup ${version}.exe` || name === `myrchifly.pilot.setup.${version}.exe`
  })
  if (!item) return { version, page }
  const url = String(item.browser_download_url ?? '')
  const size = Number(item.size)
  if (!url.startsWith(`https://github.com/${owner}/${repository}/releases/download/v${version}/`) || !Number.isSafeInteger(size) || size < 1024 || size > maxInstallerBytes) throw new Error('Реліз не має коректного інсталятора.')
  const digest = typeof item.digest === 'string' && /^sha256:[a-f\d]{64}$/i.test(item.digest) ? item.digest.slice(7).toLowerCase() : undefined
  if (!digest) throw new Error('GitHub не надав SHA-256 для перевірки інсталятора.')
  return { version, page, asset: { version, url, size, digest } }
}

export async function checkPilotUpdate(currentVersion: string): Promise<{ info: PilotUpdate; asset?: PilotReleaseAsset }> {
  const response = await fetch(releaseApi, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'MyRcHiFlY-Pilot-Updater', 'X-GitHub-Api-Version': '2022-11-28' },
    signal: AbortSignal.timeout(15000)
  })
  if (!response.ok) throw new Error(response.status === 404 ? 'Опублікованих оновлень ще немає.' : `GitHub не відповів: ${response.status}.`)
  const release = parseRelease(await response.json())
  const newer = compareVersions(release.version, currentVersion) > 0
  return {
    info: {
      currentVersion,
      latestVersion: release.version,
      available: newer && Boolean(release.asset),
      releaseUrl: release.page,
      installerBytes: release.asset?.size
    },
    asset: newer ? release.asset : undefined
  }
}

export async function downloadPilotUpdate(asset: PilotReleaseAsset, userData: string, onProgress: (percent: number) => void): Promise<string> {
  const updateDir = join(userData, 'updates')
  await mkdir(updateDir, { recursive: true })
  const installer = join(updateDir, `MyRcHiFlY-Pilot-Setup-${asset.version}.exe`)
  const partial = `${installer}.part`
  await rm(partial, { force: true })
  const response = await fetch(asset.url, { headers: { 'User-Agent': 'MyRcHiFlY-Pilot-Updater' }, signal: AbortSignal.timeout(900000) })
  if (!response.ok || !response.body) throw new Error(`Не вдалося завантажити інсталятор: ${response.status}.`)
  const file = await open(partial, 'w')
  const hash = createHash('sha256')
  let received = 0
  try {
    const reader = response.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.length
      if (received > asset.size || received > maxInstallerBytes) throw new Error('Розмір інсталятора не відповідає релізу.')
      hash.update(value)
      let offset = 0
      while (offset < value.length) {
        const { bytesWritten } = await file.write(value, offset, value.length - offset)
        if (!bytesWritten) throw new Error('Не вдалося записати інсталятор на диск.')
        offset += bytesWritten
      }
      onProgress(Math.min(99, Math.floor(received * 100 / asset.size)))
    }
  } catch (error) {
    await file.close()
    await rm(partial, { force: true })
    throw error
  }
  await file.close()
  if (received !== asset.size || hash.digest('hex') !== asset.digest) {
    await rm(partial, { force: true })
    throw new Error('Перевірка завантаженого інсталятора не пройшла.')
  }
  await rm(installer, { force: true })
  await rename(partial, installer)
  return installer
}

export async function startInstallerAfterExit(installer: string, digest: string, userData: string, applicationPid: number): Promise<void> {
  const updateDir = join(userData, 'updates')
  const script = join(updateDir, 'install-update.ps1')
  const psLiteral = (value: string) => `'${value.replaceAll("'", "''")}'`
  await writeFile(script, [
    `$targetPid = ${applicationPid}`,
    'while (Get-Process -Id $targetPid -ErrorAction SilentlyContinue) { Start-Sleep -Milliseconds 300 }',
    `if ((Get-FileHash -LiteralPath ${psLiteral(installer)} -Algorithm SHA256).Hash -ne '${digest.toUpperCase()}') { exit 1 }`,
    `Start-Process -FilePath ${psLiteral(installer)} -ArgumentList '/S' -Wait -WindowStyle Hidden`
  ].join('\r\n'), 'utf8')
  const helper = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', script], {
    detached: true, stdio: 'ignore', windowsHide: true
  })
  helper.unref()
}
