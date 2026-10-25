export interface PilotBridge {
  platform: 'electron'
  radioModel: { save(): Promise<boolean> }
  fullscreen: {
    set(enabled: boolean): Promise<boolean>
    onChanged(listener: (enabled: boolean) => void): () => void
  }
  rtsp: { start(url: string): Promise<string>; stop(): Promise<void> }
  updates: {
    check(): Promise<{ currentVersion: string; latestVersion: string; available: boolean; releaseUrl: string; installerBytes?: number }>
    download(): Promise<boolean>
    apply(): Promise<boolean>
    onProgress(listener: (percent: number) => void): () => void
  }
  socket: {
    open(id: string, options: { kind: 'udp'; remoteHost: string; remotePort: number }): Promise<void>
    send(id: string, frame: Uint8Array): Promise<void>
    close(id: string): Promise<void>
    subscribe(id: string, onFrame: (frame: Uint8Array) => void, onStatus: (status: unknown) => void): () => void
  }
}
declare global { interface Window { arduconfigDesktop?: PilotBridge } }
export const getDesktopBridge = (): PilotBridge | undefined => window.arduconfigDesktop
