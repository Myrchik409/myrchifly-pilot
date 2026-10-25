const { execFileSync } = require('node:child_process')
const { join, resolve } = require('node:path')

module.exports = async context => {
  if (context.electronPlatformName !== 'win32') return
  const root = resolve(__dirname, '..')
  const executable = join(context.appOutDir, 'MyRcHiFlY Pilot.exe')
  const icon = join(root, 'assets', 'myrchik.ico')
  const rcedit = join(__dirname, 'tools', 'rcedit-x64.exe')
  const version = require(join(root, 'package.json')).version
  execFileSync(rcedit, [
    executable,
    '--set-icon', icon,
    '--set-file-version', version,
    '--set-product-version', version,
    '--set-version-string', 'ProductName', 'MyRcHiFlY Pilot',
    '--set-version-string', 'FileDescription', 'MyRcHiFlY Pilot',
    '--set-version-string', 'InternalName', 'MyRcHiFlY Pilot'
  ], { stdio: 'inherit' })
}
