export interface ManualAxes { x: number; y: number; z: number; r: number }

const bounded = (value: number): number => Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0
const centered = (value: number): number => Math.abs(value) < 0.06 ? 0 : Math.round(value * 1000)

/** Standard gamepad, Mode 2: left stick yaw/throttle; right stick roll/pitch. */
export function gamepadManualAxes(axes: readonly number[]): ManualAxes | undefined {
  if (axes.length < 4) return undefined
  return {
    x: centered(-bounded(axes[3])),
    y: centered(bounded(axes[2])),
    z: Math.round((1 - bounded(axes[1])) * 500),
    r: centered(bounded(axes[0]))
  }
}

export type GamepadSource = `axis:${number}` | `button:${number}` | 'none'
const directInputAxisNames = ['X', 'Y', 'Z', 'Rx', 'Ry', 'Rz', 'Slider1', 'Slider2'] as const
const standardAxisNames = ['Лівий стік X', 'Лівий стік Y', 'Правий стік X', 'Правий стік Y'] as const

export function gamepadSourceLabel(source: GamepadSource, mapping: string): string {
  if (source === 'none') return 'Не призначено'
  const [kind, rawIndex] = source.split(':')
  const index = Number(rawIndex)
  if (kind === 'button') return `Кнопка ${index + 1}`
  const name = mapping === 'standard' ? standardAxisNames[index] : directInputAxisNames[index]
  return name ? `${name} · вісь ${index + 1}` : `Вісь ${index + 1}`
}
export interface RcChannelMapping {
  source: GamepadSource
  reverse: boolean
  expo: number
  min: number
  max: number
  trim: number
}
export interface JoystickProfile { version: 1; channels: RcChannelMapping[] }
export interface GamepadInput { axes: readonly number[]; buttons: readonly { value: number; pressed: boolean }[] }
export interface RcEndpoint { min: number; max: number; trim: number }

export function defaultJoystickProfile(): JoystickProfile {
  return {
    version: 1,
    channels: Array.from({ length: 16 }, (_, index) => ({
      source: (index < 4 ? `axis:${index}` : 'none') as GamepadSource,
      reverse: false,
      expo: 0, min: 1000, max: 2000, trim: 1500
    }))
  }
}

export function parseJoystickProfile(value: unknown): JoystickProfile {
  if (!value || typeof value !== 'object') throw new Error('Невірний профіль джойстика.')
  const candidate = value as Partial<JoystickProfile>
  if (candidate.version !== 1 || !Array.isArray(candidate.channels) || candidate.channels.length !== 16) {
    throw new Error('Профіль повинен містити RC1–RC16.')
  }
  const channels = candidate.channels.map((entry) => {
    if (!entry || typeof entry !== 'object' || !/^(none|axis:\d+|button:\d+)$/.test(entry.source) ||
      typeof entry.reverse !== 'boolean' || !Number.isInteger(entry.expo) || Math.abs(entry.expo) > 100 ||
      !Number.isInteger(entry.min) || !Number.isInteger(entry.max) || !Number.isInteger(entry.trim) ||
      entry.min < 900 || entry.max > 2100 || entry.max - entry.min < 200 ||
      entry.trim < entry.min || entry.trim > entry.max) throw new Error('У профілі є некоректні призначення RC.')
    return { ...entry }
  })
  return { version: 1, channels }
}

/** Unmapped channels remain null and are ignored by RC_CHANNELS_OVERRIDE. */
export function gamepadRcChannels(input: GamepadInput, profile: JoystickProfile, controllerEndpoints?: readonly (RcEndpoint | null)[], throttleChannel = 3): (number | null)[] {
  return profile.channels.map((mapping, channelIndex) => {
    if (mapping.source === 'none') return null
    const [kind, rawIndex] = mapping.source.split(':')
    const index = Number(rawIndex)
    let normalized: number
    if (kind === 'axis') {
      const axis = input.axes[index]
      if (!Number.isFinite(axis)) return null
      normalized = Math.abs(axis) < 0.04 ? 0 : bounded(axis)
    } else {
      const button = input.buttons[index]
      if (!button) return null
      normalized = bounded(button.value) * 2 - 1
    }
    if (mapping.reverse) normalized = -normalized
    const limits = controllerEndpoints?.[channelIndex] ?? mapping
    // Mission Planner's JoystickBase.pickchannel/Expo uses a triangular PWM
    // correction, rather than the usual cubic expo curve. Its throttle trim is
    // always the midpoint even when RC3_TRIM equals RC3_MIN on the vehicle.
    const trim = channelIndex + 1 === throttleChannel ? (limits.min + limits.max) / 2 : limits.trim
    const working = normalized * 500
    const linear = working < 0
      ? limits.min + (working + 500) * (trim - limits.min) / 500
      : trim + working * (limits.max - trim) / 500
    const factor = working < -250 ? -500 - working : working > 250 ? 500 - working : working
    const pwm = linear - factor * mapping.expo / 100
    return Math.round(Math.max(limits.min, Math.min(limits.max, pwm)))
  })
}

export function gamepadRcReady(channels: readonly (number | null)[], requiredChannels: readonly number[] = [1, 2, 3, 4]): boolean {
  // The operator explicitly turns RC override on. Stick positions must not
  // silently veto that action; only missing primary channel mappings do.
  return channels.length === 16 && requiredChannels.every(channel =>
    Number.isInteger(channel) && channel >= 1 && channel <= 16 && channels[channel - 1] !== null)
}

export function detectGamepadSource(before: GamepadInput, after: GamepadInput): GamepadSource | undefined {
  const pressed = after.buttons.findIndex((button, index) => button.value > 0.7 &&
    (before.buttons[index]?.value ?? 0) < 0.3)
  if (pressed >= 0) return `button:${pressed}`
  let strongest = 0.35
  let found: GamepadSource | undefined
  after.axes.forEach((axis, index) => {
    const delta = Math.abs(axis - (before.axes[index] ?? 0))
    if (delta > strongest) { strongest = delta; found = `axis:${index}` }
  })
  return found
}
