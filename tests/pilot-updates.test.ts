import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compareVersions, parseRelease } from '../src/main/pilot-updates.js'

test('newer releases are compared numerically', () => {
  assert.equal(compareVersions('1.0.10', '1.0.9'), 1)
  assert.equal(compareVersions('1.0.2', '1.0.2'), 0)
  assert.equal(compareVersions('1.0.1', '1.0.2'), -1)
})

test('only the named installer in the official release is accepted', () => {
  const release = parseRelease({
    tag_name: 'v1.0.2',
    html_url: 'https://github.com/Myrchik409/myrchifly-pilot/releases/tag/v1.0.2',
    assets: [{
      name: 'MyRcHiFlY.Pilot.Setup.1.0.2.exe',
      browser_download_url: 'https://github.com/Myrchik409/myrchifly-pilot/releases/download/v1.0.2/MyRcHiFlY.Pilot.Setup.1.0.2.exe',
      size: 218201522,
      digest: `sha256:${'a'.repeat(64)}`
    }]
  })
  assert.equal(release.asset?.version, '1.0.2')
  assert.equal(release.asset?.digest, 'a'.repeat(64))
  assert.throws(() => parseRelease({
    tag_name: 'v1.0.2',
    html_url: 'https://github.com/Myrchik409/myrchifly-pilot/releases/tag/v1.0.2',
    assets: [{ name: 'MyRcHiFlY Pilot Setup 1.0.2.exe', browser_download_url: 'https://example.com/installer.exe', size: 1000000, digest: `sha256:${'a'.repeat(64)}` }]
  }))
})
