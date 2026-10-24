import { MAV_AUTOPILOT, MAV_MODE_FLAG, MAV_TYPE } from '../mavlink/constants.js'
import { MavlinkSession } from '../mavlink/mavlink-session.js'
import { MavlinkV2Codec } from '../mavlink/mavlink-v2-codec.js'
import type { TransportStatus } from '../transport-types.js'
import { DesktopSocketTransport } from './desktop-socket-transport.js'
import { getDesktopBridge } from './desktop-bridge.js'

export interface PilotSnapshot {
  connection: TransportStatus
  vehicle?: { systemId: number; armed: boolean; flightMode: string }
  staleLink: boolean
}

const copterModes: Record<number, string> = {
  0: 'Stabilize', 1: 'Acro', 2: 'AltHold', 3: 'Auto', 4: 'Guided', 5: 'Loiter',
  6: 'RTL', 7: 'Circle', 9: 'Land', 16: 'PosHold', 17: 'Brake', 18: 'Throw',
  19: 'Avoid ADSB', 20: 'Guided NoGPS', 21: 'SmartRTL', 24: 'ZigZag'
}
const copterTypes = new Set<number>([MAV_TYPE.QUADROTOR, MAV_TYPE.HEXAROTOR, MAV_TYPE.OCTOROTOR,
  MAV_TYPE.TRICOPTER, MAV_TYPE.DODECAROTOR, MAV_TYPE.DECAROTOR, MAV_TYPE.HELICOPTER, MAV_TYPE.COAXIAL])

export function parseEndpoint(value: string): { remoteHost: string; remotePort: number } | undefined {
  const match = /^([a-zA-Z0-9_.-]+):(\d{1,5})$/.exec(value.trim())
  if (!match) return undefined
  const port = Number(match[2])
  return port > 0 && port <= 65535 ? { remoteHost: match[1], remotePort: port } : undefined
}

export class PilotRuntime {
  private readonly listeners = new Set<(snapshot: PilotSnapshot) => void>()
  private readonly transport: DesktopSocketTransport
  private readonly session: MavlinkSession
  private readonly timer: ReturnType<typeof setInterval>
  private readonly controlled = new Set<number>()
  private lastHeartbeat = 0
  private snapshot: PilotSnapshot = { connection: { kind: 'idle' }, staleLink: true }

  constructor(endpoint: string) {
    const bridge = getDesktopBridge()
    const target = parseEndpoint(endpoint)
    if (!bridge?.socket || !target) throw new Error('Вкажи адресу REPIX у форматі IP:порт.')
    this.transport = new DesktopSocketTransport('repix', { bridge: bridge.socket, ...target })
    this.session = new MavlinkSession(this.transport, new MavlinkV2Codec())
    this.session.onStatus(connection => {
      if (connection.kind !== 'connected') {
        this.lastHeartbeat = 0
        this.update({ connection, vehicle: undefined, staleLink: true })
      } else this.update({ ...this.snapshot, connection })
    })
    this.session.onMessage(envelope => {
      const message = envelope.message
      if (message.type !== 'HEARTBEAT' || message.autopilot !== MAV_AUTOPILOT.ARDUPILOTMEGA ||
        message.vehicleType === MAV_TYPE.GCS || envelope.header.systemId === 255 || envelope.header.componentId !== 1) return
      const current = this.snapshot.vehicle
      if (current && current.systemId !== envelope.header.systemId) return
      this.lastHeartbeat = Date.now()
      const isCopter = copterTypes.has(message.vehicleType)
      const flightMode = isCopter
        ? copterModes[message.customMode] ?? `Режим №${message.customMode}`
        : `Режим №${message.customMode}`
      this.update({ ...this.snapshot, staleLink: false, vehicle: {
        systemId: envelope.header.systemId,
        armed: Boolean(message.baseMode & MAV_MODE_FLAG.SAFETY_ARMED),
        flightMode
      } })
    })
    this.timer = setInterval(() => {
      if (this.lastHeartbeat && Date.now() - this.lastHeartbeat > 4000 && !this.snapshot.staleLink) {
        this.update({ ...this.snapshot, staleLink: true })
      }
    }, 500)
  }

  private update(snapshot: PilotSnapshot) {
    this.snapshot = snapshot
    for (const listener of this.listeners) listener(snapshot)
  }
  getSnapshot() { return this.snapshot }
  subscribe(listener: (snapshot: PilotSnapshot) => void) {
    this.listeners.add(listener)
    listener(this.snapshot)
    return () => { this.listeners.delete(listener) }
  }
  async connect() { await this.session.connect() }
  async disconnect() { await this.releaseRcOverrides(); await this.session.disconnect() }
  destroy() { clearInterval(this.timer); this.session.destroy() }

  async sendRcOverride(channels: readonly (number | null)[]) {
    const vehicle = this.snapshot.vehicle
    if (this.snapshot.connection.kind !== 'connected' || this.snapshot.staleLink || !vehicle) throw new Error('Немає активного MAVLink-зв’язку з дроном.')
    if (channels.length !== 16 || channels.some(value => value !== null && (!Number.isInteger(value) || value < 900 || value > 2100))) throw new Error('Некоректні значення каналів RC1–RC16.')
    const values = channels.map((value, index) => {
      if (value !== null) this.controlled.add(index)
      return value ?? 65535
    })
    await this.session.send({ type: 'RC_CHANNELS_OVERRIDE', targetSystem: vehicle.systemId, targetComponent: 0, channels: values })
  }
  async releaseRcOverrides() {
    const controlled = [...this.controlled]
    this.controlled.clear()
    const vehicle = this.snapshot.vehicle
    if (!controlled.length || this.snapshot.connection.kind !== 'connected' || this.snapshot.staleLink || !vehicle) return
    const channels = Array.from({ length: 16 }, (_, index) => controlled.includes(index) ? index < 8 ? 0 : 65534 : 65535)
    await this.session.send({ type: 'RC_CHANNELS_OVERRIDE', targetSystem: vehicle.systemId, targetComponent: 0, channels })
  }
}
