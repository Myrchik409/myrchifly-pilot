import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, ipcMain } from 'electron'
import { createDesktopWebPreferences } from './electron-window-options.js'
import { NativeSocketManager, type SocketOpenOptions } from './native-socket-manager.js'
import { RtspPreviewSession } from './rtsp-preview.js'
import { type HostedWebUi } from './web-ui-server.js'
import { startStableWebUi } from './stable-web-ui.js'

const preload = fileURLToPath(new URL('./pilot-preload.cjs', import.meta.url))
const sockets = new NativeSocketManager()
let hosted: HostedWebUi | undefined
let mainWindow: BrowserWindow | undefined
let rtsp: RtspPreviewSession | undefined

app.name = 'MyRcHiFlY Pilot'
const singleInstance = app.requestSingleInstanceLock()
if (!singleInstance) app.quit()

app.on('second-instance', () => {
  if (mainWindow?.isMinimized()) mainWindow.restore()
  mainWindow?.focus()
})

if (singleInstance) void app.whenReady().then(async () => {
  const webDistDir = app.isPackaged
    ? join(process.resourcesPath, 'pilot-web')
    : fileURLToPath(new URL('../web-dist', import.meta.url))
  hosted = await startStableWebUi(app.getPath('userData'), webDistDir)
  const origin = hosted.url
  mainWindow = new BrowserWindow({
    width: 1600, height: 960, minWidth: 1050, minHeight: 640,
    title: 'MyRcHiFlY Pilot', autoHideMenuBar: true, backgroundColor: '#061018',
    webPreferences: { ...createDesktopWebPreferences(preload), backgroundThrottling: false }
  })
  mainWindow.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin !== origin) event.preventDefault()
  })
  const valid = (event: Electron.IpcMainInvokeEvent) => event.sender === mainWindow?.webContents && event.senderFrame === event.sender.mainFrame

  ipcMain.handle('desktop:socket:open', async (event, id: unknown, options: unknown) => {
    if (!valid(event) || typeof id !== 'string' || id.length > 100 || !options || typeof options !== 'object') throw new Error('Невірний запит з’єднання.')
    const target = options as SocketOpenOptions
    if (target.kind !== 'udp' || !target.remoteHost || !target.remotePort) throw new Error('Доступне лише підключення REPIX через UDP.')
    await sockets.open(id, target, {
      onFrame: frame => { if (!event.sender.isDestroyed()) event.sender.send('desktop:socket:frame', id, frame) },
      onStatus: status => { if (!event.sender.isDestroyed()) event.sender.send('desktop:socket:status', id, status) }
    })
  })
  ipcMain.handle('desktop:socket:send', async (event, id: unknown, frame: unknown) => {
    if (!valid(event) || typeof id !== 'string' || !(frame instanceof Uint8Array)) throw new Error('Невірні дані MAVLink.')
    await sockets.send(id, frame)
  })
  ipcMain.handle('desktop:socket:close', async (event, id: unknown) => {
    if (!valid(event) || typeof id !== 'string') throw new Error('Невірний запит відключення.')
    await sockets.close(id)
  })
  ipcMain.handle('desktop:rtsp:start', async (event, url: unknown) => {
    if (!valid(event) || typeof url !== 'string') throw new Error('Невірна адреса відео.')
    await rtsp?.stop()
    const gstInstaller = app.isPackaged
      ? join(process.resourcesPath, 'gstreamer-runtime.msi')
      : fileURLToPath(new URL('../build/gstreamer-runtime-1.26.11.msi', import.meta.url))
    const session = new RtspPreviewSession(gstInstaller)
    rtsp = session
    try { return await session.start(url) }
    catch (error) { if (rtsp === session) rtsp = undefined; throw error }
  })
  ipcMain.handle('desktop:rtsp:stop', async event => {
    if (!valid(event)) throw new Error('Невірний запит відео.')
    const session = rtsp
    rtsp = undefined
    await session?.stop()
  })
  mainWindow.once('closed', () => {
    mainWindow = undefined
    void sockets.closeAll()
    void rtsp?.stop()
    rtsp = undefined
  })
  await mainWindow.loadURL(origin)
}).catch(error => { console.error('MyRcHiFlY Pilot startup failed:', error); app.quit() })

app.on('window-all-closed', () => app.quit())
app.on('before-quit', () => {
  void sockets.closeAll()
  void rtsp?.stop()
  void hosted?.close()
})
