import assert from 'node:assert/strict'
import { test } from 'node:test'
import { defaultJoystickProfile, gamepadRcChannels, gamepadSourceLabel } from '../src/renderer/gamepad-control.js'

test('Ardu-style axis names keep the actual Gamepad source index', () => {
  assert.equal(gamepadSourceLabel('axis:0', ''), 'X · вісь 1')
  assert.equal(gamepadSourceLabel('axis:3', ''), 'Rx · вісь 4')
  assert.equal(gamepadSourceLabel('axis:7', ''), 'Slider2 · вісь 8')
  assert.equal(gamepadSourceLabel('axis:0', 'standard'), 'Лівий стік X · вісь 1')
})

test('Mission Planner default X/Y/Z/Rx mapping and ArduPilot endpoints', () => {
  const profile = defaultJoystickProfile()
  assert.deepEqual(profile.channels.slice(0, 4).map(channel => channel.source),
    ['axis:0', 'axis:1', 'axis:2', 'axis:3'])
  const boardValues = gamepadRcChannels({ axes: [1, -1, 0, 0], buttons: [] }, profile,
    [{ min: 988, trim: 1500, max: 2011 }, { min: 988, trim: 1500, max: 2011 }])
  assert.equal(boardValues[0], 2011)
  assert.equal(boardValues[1], 988)
  const throttleAtCenter = gamepadRcChannels({ axes: [0, 0, 0, 0], buttons: [] }, profile,
    [null, null, { min: 988, trim: 988, max: 2011 }])
  assert.equal(throttleAtCenter[2], 1500)
})

test('Mission Planner expo uses a triangular correction, and reverse flips an axis', () => {
  const profile = defaultJoystickProfile()
  profile.channels[0].expo = 100
  const values = gamepadRcChannels({ axes: [0.5, 0, 0, 0], buttons: [] }, profile)
  assert.equal(values[0], 1500)
  profile.channels[0].reverse = true
  const reversed = gamepadRcChannels({ axes: [0.5, 0, 0, 0], buttons: [] }, profile)
  assert.equal(reversed[0], 1500)
  profile.channels[0].expo = 0
  assert.equal(gamepadRcChannels({ axes: [0.5, 0, 0, 0], buttons: [] }, profile)[0], 1250)
})
