import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('arduconfigDesktop', {
  platform: 'electron' as const,
  rtsp: {
    start: (url: string) => ipcRenderer.invoke('desktop:rtsp:start', url) as Promise<string>,
    stop: () => ipcRenderer.invoke('desktop:rtsp:stop') as Promise<void>
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
