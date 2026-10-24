export interface PilotBridge {
  platform: 'electron'
  rtsp: { start(url: string): Promise<string>; stop(): Promise<void> }
  socket: {
    open(id: string, options: { kind: 'udp'; remoteHost: string; remotePort: number }): Promise<void>
    send(id: string, frame: Uint8Array): Promise<void>
    close(id: string): Promise<void>
    subscribe(id: string, onFrame: (frame: Uint8Array) => void, onStatus: (status: unknown) => void): () => void
  }
}
declare global { interface Window { arduconfigDesktop?: PilotBridge } }
export const getDesktopBridge = (): PilotBridge | undefined => window.arduconfigDesktop
