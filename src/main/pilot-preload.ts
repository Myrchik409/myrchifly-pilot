import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('arduconfigDesktop', {
  platform: 'electron' as const,
  fullscreen: {
    set: (enabled: boolean) => ipcRenderer.invoke('desktop:video-fullscreen:set', enabled) as Promise<boolean>,
    onChanged: (listener: (enabled: boolean) => void) => {
      const handler = (_event: unknown, enabled: boolean) => listener(enabled)
      ipcRenderer.on('desktop:video-fullscreen:changed', handler)
      return () => ipcRenderer.removeListener('desktop:video-fullscreen:changed', handler)
    }
  },
  rtsp: {
    start: (url: string) => ipcRenderer.invoke('desktop:rtsp:start', url) as Promise<string>,
    stop: () => ipcRenderer.invoke('desktop:rtsp:stop') as Promise<void>
  },
  updates: {
    check: () => ipcRenderer.invoke('desktop:update:check'),
    download: () => ipcRenderer.invoke('desktop:update:download') as Promise<boolean>,
    apply: () => ipcRenderer.invoke('desktop:update:apply') as Promise<boolean>,
    onProgress: (listener: (percent: number) => void) => {
      const handler = (_event: unknown, percent: number) => listener(percent)
      ipcRenderer.on('desktop:update:progress', handler)
      return () => ipcRenderer.removeListener('desktop:update:progress', handler)
    }
  },
  socket: {
    open: (id: string, options: unknown) => ipcRenderer.invoke('desktop:socket:open', id, options) as Promise<void>,
    send: (id: string, frame: Uint8Array) => ipcRenderer.invoke('desktop:socket:send', id, frame) as Promise<void>,
    close: (id: string) => ipcRenderer.invoke('desktop:socket:close', id) as Promise<void>,
    subscribe: (id: string, onFrame: (frame: Uint8Array) => void, onStatus: (status: unknown) => void) => {
      const frameHandler = (_event: unknown, socketId: string, frame: Uint8Array) => { if (socketId === id) onFrame(frame) }
      const statusHandler = (_event: unknown, socketId: string, status: unknown) => { if (socketId === id) onStatus(status) }
      ipcRenderer.on('desktop:socket:frame', frameHandler)
      ipcRenderer.on('desktop:socket:status', statusHandler)
      return () => {
        ipcRenderer.removeListener('desktop:socket:frame', frameHandler)
        ipcRenderer.removeListener('desktop:socket:status', statusHandler)
      }
    }
  }
})
