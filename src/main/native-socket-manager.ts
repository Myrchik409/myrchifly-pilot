import { createSocket, type RemoteInfo, type Socket } from 'node:dgram'
import type { TransportStatus } from '../transport-types.js'

export interface SocketOpenOptions { kind: 'udp'; remoteHost: string; remotePort: number }
export interface SocketEventSink {
  onFrame(frame: Uint8Array): void
  onStatus(status: TransportStatus): void
}
interface Connection { socket: Socket; sink: SocketEventSink; remoteHost: string; remotePort: number }

export class NativeSocketManager {
  private readonly connections = new Map<string, Connection>()

  async open(id: string, options: SocketOpenOptions, sink: SocketEventSink): Promise<void> {
    if (this.connections.has(id)) throw new Error('Цей канал уже відкритий.')
    if (options.kind !== 'udp' || !/^[a-zA-Z0-9_.-]+$/.test(options.remoteHost) ||
      !Number.isInteger(options.remotePort) || options.remotePort < 1 || options.remotePort > 65535) throw new Error('Невірна адреса MAVLink UDP.')
    const socket = createSocket('udp4')
    const connection: Connection = { socket, sink, remoteHost: options.remoteHost, remotePort: options.remotePort }
    this.connections.set(id, connection)
    socket.on('message', (frame: Buffer, remote: RemoteInfo) => {
      connection.remoteHost = remote.address
      connection.remotePort = remote.port
      sink.onFrame(new Uint8Array(frame))
    })
    socket.on('error', error => sink.onStatus({ kind: 'error', message: error.message }))
    sink.onStatus({ kind: 'connecting' })
    try {
      await new Promise<void>((resolve, reject) => {
        const fail = (error: Error) => { socket.off('error', fail); reject(error) }
        socket.once('error', fail)
        socket.bind(0, () => { socket.off('error', fail); resolve() })
      })
      sink.onStatus({ kind: 'connected' })
    } catch (error) {
      await this.close(id)
      throw error
    }
  }

  async send(id: string, frame: Uint8Array): Promise<void> {
    const connection = this.connections.get(id)
    if (!connection) throw new Error('З’єднання MAVLink закрите.')
    if (frame.length > 4096) throw new Error('MAVLink-кадр завеликий.')
    await new Promise<void>((resolve, reject) => connection.socket.send(frame, connection.remotePort, connection.remoteHost, error => error ? reject(error) : resolve()))
  }

  async close(id: string): Promise<void> {
    const connection = this.connections.get(id)
    if (!connection) return
    this.connections.delete(id)
    await new Promise<void>(resolve => connection.socket.close(() => resolve()))
    connection.sink.onStatus({ kind: 'disconnected', reason: 'З’єднання закрите.' })
  }

  async closeAll(): Promise<void> { await Promise.all([...this.connections.keys()].map(id => this.close(id))) }
}
