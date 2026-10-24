export const JOYSTICK_MONITOR_CHANNEL = 'myrchifly-joystick-monitor-v1'

export interface JoystickMonitorSample {
  connected: boolean
  enabled: boolean
  deviceId: string
  channels: (number | null)[]
}

export function parseJoystickMonitorSample(value: unknown): JoystickMonitorSample | undefined {
  if (!value || typeof value !== 'object') return undefined
  const sample = value as Partial<JoystickMonitorSample> & { type?: unknown }
  if (sample.type !== 'sample' || typeof sample.connected !== 'boolean' ||
    typeof sample.enabled !== 'boolean' || typeof sample.deviceId !== 'string' ||
    !Array.isArray(sample.channels) || sample.channels.length !== 16 ||
    sample.channels.some(channel => channel !== null && (!Number.isInteger(channel) || channel < 900 || channel > 2100))) return undefined
  return { connected: sample.connected, enabled: sample.enabled, deviceId: sample.deviceId, channels: sample.channels }
}
