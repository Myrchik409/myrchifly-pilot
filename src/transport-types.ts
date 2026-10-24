export type Unsubscribe = () => void
export type TransportStatus =
  | { kind: 'idle' }
  | { kind: 'connecting' }
  | { kind: 'connected' }
  | { kind: 'disconnected'; reason?: string }
  | { kind: 'error'; message: string }
export type FrameListener = (frame: Uint8Array) => void
export type StatusListener = (status: TransportStatus) => void
export interface Transport {
  readonly id: string
  readonly kind: 'udp'
  getStatus(): TransportStatus
  connect(): Promise<void>
  disconnect(): Promise<void>
  send(frame: Uint8Array): Promise<void>
  onFrame(listener: FrameListener): Unsubscribe
  onStatus(listener: StatusListener): Unsubscribe
}
