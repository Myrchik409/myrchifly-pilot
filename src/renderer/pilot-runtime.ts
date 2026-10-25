import { MAV_AUTOPILOT, MAV_MODE_FLAG, MAV_TYPE } from '../mavlink/constants.js'
import { MavlinkSession } from '../mavlink/mavlink-session.js'
import { MavlinkV2Codec } from '../mavlink/mavlink-v2-codec.js'
import type { TransportStatus } from '../transport-types.js'
import { DesktopSocketTransport } from './desktop-socket-transport.js'
import { getDesktopBridge } from './desktop-bridge.js'
import type { RcEndpoint } from './gamepad-control.js'

export interface RcMap { roll: number; pitch: number; throttle: number; yaw: number }

export interface PilotSnapshot {
  connection: TransportStatus
  vehicle?: { systemId: number; armed: boolean; flightMode: string }
  rcInput?: { channels: (number | null)[]; receivedAt: number }
  rcEndpoints?: (RcEndpoint | null)[]
  rcMap?: RcMap
  staleLink: boolean
}

const copterModes: Record<number, string> = {
  0: 'Stabilize', 1: 'Acro', 2: 'AltHold', 3: 'Auto', 4: 'Guided', 5: 'Loiter',
  6: 'RTL', 7: 'Circle', 9: 'Land', 16: 'PosHold', 17: 'Brake', 18: 'Throw',
  19: 'Avoid ADSB', 20: 'Guided NoGPS', 21: 'SmartRTL', 24: 'ZigZag'
}
const copterTypes = new Set<number>([MAV_TYPE.QUADROTOR, MAV_TYPE.HEXAROTOR, MAV_TYPE.OCTOROTOR,
  MAV_TYPE.TRICOPTER, MAV_TYPE.DODECAROTOR, MAV_TYPE.DECAROTOR, MAV_TYPE.HELICOPTER, MAV_TYPE.COAXIAL])
const rcParameterNames = [1, 2, 3, 4].flatMap(index => [`RC${index}_MIN`, `RC${index}_MAX`, `RC${index}_TRIM`])
  .concat(['RCMAP_ROLL', 'RCMAP_PITCH', 'RCMAP_THROTTLE', 'RCMAP_YAW'])

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
  private lastFullRc = 0
  private lastParamRequest = 0
  private readonly rcParams = new Map<string, number>()
  private readonly paramTimers = new Set<ReturnType<typeof setTimeout>>()
  private snapshot: PilotSnapshot = { connection: { kind: 'idle' }, staleLink: true }

  constructor(endpoint: string) {
    const bridge = getDesktopBridge()
    const target = parseEndpoint(endpoint)
    if (!bridge?.socket || !target) throw new Error('Вкажи адресу MAVLink у форматі IP:порт.')
    this.transport = new DesktopSocketTransport('repix', { bridge: bridge.socket, ...target })
    this.session = new MavlinkSession(this.transport, new MavlinkV2Codec())
    this.session.onStatus(connection => {
      if (connection.kind !== 'connected') {
        this.lastHeartbeat = 0
        this.lastFullRc = 0
        this.lastParamRequest = 0
        this.rcParams.clear()
        this.clearParamTimers()
        this.update({ connection, vehicle: undefined, rcInput: undefined, rcEndpoints: undefined, rcMap: undefined, staleLink: true })
      } else this.update({ ...this.snapshot, connection })
    })
    this.session.onMessage(envelope => {
      const message = envelope.message
      if (message.type === 'PARAM_VALUE') {
        if (envelope.header.systemId !== this.snapshot.vehicle?.systemId || envelope.header.componentId !== 1 ||
          !rcParameterNames.includes(message.paramId) || !Number.isFinite(message.paramValue)) return
        this.rcParams.set(message.paramId, message.paramValue)
        const rcEndpoints = Array.from({ length: 16 }, (_, index): RcEndpoint | null => {
          if (index >= 4) return null
          const min = this.rcParams.get(`RC${index + 1}_MIN`)
          const max = this.rcParams.get(`RC${index + 1}_MAX`)
          const trim = this.rcParams.get(`RC${index + 1}_TRIM`)
          return min !== undefined && max !== undefined && trim !== undefined &&
            min >= 800 && max <= 2200 && max - min >= 200 && trim >= min && trim <= max
            ? { min, max, trim } : null
        })
        const names = ['ROLL', 'PITCH', 'THROTTLE', 'YAW'] as const
        const mapValues = names.map(name => this.rcParams.get(`RCMAP_${name}`))
        const rcMap = mapValues.every(value => Number.isInteger(value) && value! >= 1 && value! <= 16) &&
          new Set(mapValues).size === 4
          ? { roll: mapValues[0]!, pitch: mapValues[1]!, throttle: mapValues[2]!, yaw: mapValues[3]! }
          : undefined
        this.update({ ...this.snapshot, rcEndpoints, rcMap })
        return
      }
      if (message.type === 'RC_CHANNELS' || message.type === 'RC_CHANNELS_RAW') {
        if (envelope.header.systemId !== this.snapshot.vehicle?.systemId || envelope.header.componentId !== 1) return
        if (message.type === 'RC_CHANNELS_RAW' && (message.port !== 0 || Date.now() - this.lastFullRc < 3000)) return
        if (message.type === 'RC_CHANNELS') this.lastFullRc = Date.now()
        const raw = message.type === 'RC_CHANNELS' ? message.channels.slice(0, 16) : message.channels
        const count = message.type === 'RC_CHANNELS' ? message.channelCount : 8
        const channels = Array.from({ length: 16 }, (_, index) => {
          const value = raw[index]
          return index < count && Number.isInteger(value) && value >= 800 && value <= 2200 ? value : null
        })
        this.update({ ...this.snapshot, rcInput: { channels, receivedAt: Date.now() } })
        return
      }
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
      if (Date.now() - this.lastParamRequest > 10000 && this.rcParams.size < rcParameterNames.length) {
        this.requestRcParameters(envelope.header.systemId)
      }
    })
    this.timer = setInterval(() => {
      if (this.snapshot.rcInput && Date.now() - this.snapshot.rcInput.receivedAt > 3000) {
        this.update({ ...this.snapshot, rcInput: undefined })
      }
      if (this.lastHeartbeat && Date.now() - this.lastHeartbeat > 4000 && !this.snapshot.staleLink) {
        this.update({ ...this.snapshot, staleLink: true })
      }
    }, 500)
  }

  private update(snapshot: PilotSnapshot) {
    this.snapshot = snapshot
    for (const listener of this.listeners) listener(snapshot)
  }
  private clearParamTimers() {
    for (const timer of this.paramTimers) clearTimeout(timer)
    this.paramTimers.clear()
  }
  private requestRcParameters(systemId: number) {
    this.lastParamRequest = Date.now()
    this.clearParamTimers()
    rcParameterNames.filter(name => !this.rcParams.has(name)).forEach((paramId, index) => {
      const timer = setTimeout(() => {
        this.paramTimers.delete(timer)
        if (this.snapshot.connection.kind !== 'connected' || this.snapshot.vehicle?.systemId !== systemId) return
        void this.session.send({ type: 'PARAM_REQUEST_READ', targetSystem: systemId,
          targetComponent: 1, paramId, paramIndex: -1 }).catch(() => {})
      }, index * 70)
      this.paramTimers.add(timer)
    })
  }
  getSnapshot() { return this.snapshot }
  subscribe(listener: (snapshot: PilotSnapshot) => void) {
    this.listeners.add(listener)
    listener(this.snapshot)
    return () => { this.listeners.delete(listener) }
  }
  async connect() { await this.session.connect() }
  async disconnect() { await this.releaseRcOverrides(); await this.session.disconnect() }
  destroy() { clearInterval(this.timer); this.clearParamTimers(); this.session.destroy() }

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
