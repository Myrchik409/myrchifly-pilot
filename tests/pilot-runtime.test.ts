import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MAV_AUTOPILOT, MAV_MODE_FLAG, MAV_TYPE } from '../src/mavlink/constants.js'
import { MavlinkV2Codec } from '../src/mavlink/mavlink-v2-codec.js'
import { PilotRuntime } from '../src/renderer/pilot-runtime.js'

test('Pilot sends mapped RC values and releases them when disconnected', async () => {
  let frameListener: ((frame: Uint8Array) => void) | undefined
  let statusListener: ((status: unknown) => void) | undefined
  const sent: Uint8Array[] = []
  const socket = {
    async open() { statusListener?.({ kind: 'connected' }) },
    async send(_id: string, frame: Uint8Array) { sent.push(frame) },
    async close() { statusListener?.({ kind: 'disconnected' }) },
    subscribe(_id: string, onFrame: (frame: Uint8Array) => void, onStatus: (status: unknown) => void) {
      frameListener = onFrame
      statusListener = onStatus
      return () => { frameListener = undefined; statusListener = undefined }
    }
  }
  Object.assign(globalThis, { window: { arduconfigDesktop: { socket } } })
  const runtime = new PilotRuntime('127.0.0.1:14550')
  try {
    await runtime.connect()
    await assert.rejects(runtime.sendRcOverride([1500, ...Array(15).fill(null)]), /MAVLink-зв’язку/)
    const codec = new MavlinkV2Codec()
    const heartbeat = codec.encode({
      header: { systemId: 1, componentId: 1, sequence: 0 }, timestampMs: Date.now(),
      message: { type: 'HEARTBEAT', autopilot: MAV_AUTOPILOT.ARDUPILOTMEGA,
        vehicleType: MAV_TYPE.QUADROTOR, baseMode: MAV_MODE_FLAG.CUSTOM_MODE_ENABLED,
        customMode: 16, systemStatus: 4, mavlinkVersion: 3 }
    })
    frameListener?.(heartbeat)
    assert.equal(runtime.getSnapshot().vehicle?.flightMode, 'PosHold')
    const boardParameters: Record<string, number> = {
      RC1_MIN: 988, RC1_MAX: 2011, RC1_TRIM: 1500,
      RC2_MIN: 988, RC2_MAX: 2011, RC2_TRIM: 1500,
      RCMAP_ROLL: 1, RCMAP_PITCH: 2, RCMAP_THROTTLE: 3, RCMAP_YAW: 4
    }
    Object.entries(boardParameters).forEach(([paramId, paramValue], index) => frameListener?.(codec.encode({
      header: { systemId: 1, componentId: 1, sequence: index + 1 }, timestampMs: Date.now(),
      message: { type: 'PARAM_VALUE', paramId, paramValue, paramType: 9, paramCount: 1000, paramIndex: index }
    })))
    assert.deepEqual(runtime.getSnapshot().rcMap, { roll: 1, pitch: 2, throttle: 3, yaw: 4 })
    assert.deepEqual(runtime.getSnapshot().rcEndpoints?.[0], { min: 988, max: 2011, trim: 1500 })
    frameListener?.(codec.encode({
      header: { systemId: 1, componentId: 1, sequence: 20 }, timestampMs: Date.now(),
      message: { type: 'RC_CHANNELS', timeBootMs: 1000, channelCount: 4,
        channels: [1800, 1200, 988, 1500, ...Array(14).fill(0)], rssi: 100 }
    }))
    assert.deepEqual(runtime.getSnapshot().rcInput?.channels.slice(0, 5), [1800, 1200, 988, 1500, null])
    const channels = Array<number | null>(16).fill(null)
    channels[0] = 1500
    channels[5] = 1000
    channels[9] = 2000
    await runtime.sendRcOverride(channels)
    await runtime.disconnect()
    const outbound = new MavlinkV2Codec()
    const overrides = sent.flatMap(frame => outbound.push(frame))
      .map(envelope => envelope.message).filter(message => message.type === 'RC_CHANNELS_OVERRIDE')
    assert.equal(overrides.length, 2)
    assert.deepEqual(overrides[0].channels.slice(0, 6), [1500, 65535, 65535, 65535, 65535, 1000])
    assert.equal(overrides[0].channels[9], 2000)
    assert.equal(overrides[1].channels[0], 0)
    assert.equal(overrides[1].channels[5], 0)
    assert.equal(overrides[1].channels[9], 65534)
  } finally { runtime.destroy() }
})
