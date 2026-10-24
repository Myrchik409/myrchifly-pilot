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

export function defaultJoystickProfile(): JoystickProfile {
  return {
    version: 1,
    channels: Array.from({ length: 16 }, (_, index) => ({
      source: (['axis:2', 'axis:3', 'axis:1', 'axis:0'][index] ?? 'none') as GamepadSource,
      reverse: index === 1 || index === 2,
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
export function gamepadRcChannels(input: GamepadInput, profile: JoystickProfile): (number | null)[] {
  return profile.channels.map((mapping) => {
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
    const strength = mapping.expo / 100
    normalized = normalized * (1 - strength) + normalized ** 3 * strength
    const pwm = normalized < 0
      ? mapping.trim + normalized * (mapping.trim - mapping.min)
      : mapping.trim + normalized * (mapping.max - mapping.trim)
    return Math.round(Math.max(mapping.min, Math.min(mapping.max, pwm)))
  })
}

export function gamepadRcReady(channels: readonly (number | null)[]): boolean {
  // The operator explicitly turns RC override on. Stick positions must not
  // silently veto that action; only missing primary channel mappings do.
  return channels.length === 16 && channels.slice(0, 4).every(value => value !== null)
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
