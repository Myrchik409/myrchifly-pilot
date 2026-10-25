import { useEffect, useRef, useState } from 'react'
import { defaultJoystickProfile, detectGamepadSource, gamepadRcChannels, gamepadRcReady, parseJoystickProfile, type GamepadInput, type GamepadSource, type JoystickProfile, type RcChannelMapping } from './gamepad-control'
import { JOYSTICK_MONITOR_CHANNEL } from './joystick-monitor'

const storageKey = 'myrchifly.joystick.profile.v1'
const presetsKey = 'myrchifly.joystick.presets.v1'
const primaryChannelLabels = ['Крен · Roll', 'Тангаж · Pitch', 'Газ · Throttle', 'Рискання · Yaw'] as const
interface JoystickPreset { id: string; name: string; profile: JoystickProfile }
const readPresets = (): JoystickPreset[] => {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(presetsKey) ?? '[]')
    if (!Array.isArray(value)) return []
    return value.filter(entry => entry && typeof entry.id === 'string' && typeof entry.name === 'string')
      .map(entry => ({ id: entry.id, name: entry.name, profile: parseJoystickProfile(entry.profile) }))
  } catch { return [] }
}
const readProfile = (): JoystickProfile => {
  try { return parseJoystickProfile(JSON.parse(localStorage.getItem(storageKey) ?? 'null')) }
  catch { return defaultJoystickProfile() }
}
const pads = (): Gamepad[] => typeof navigator.getGamepads === 'function'
  ? Array.from(navigator.getGamepads()).filter((pad): pad is Gamepad => !!pad?.connected) : []

export function JoystickPanel({ connected, onSend, onRelease, onPopout, onActiveChange, compact = false }: {
  connected: boolean
  onSend: (channels: (number | null)[]) => Promise<void>
  onRelease: () => Promise<void>
  onPopout?: () => void
  onActiveChange?: (active: boolean) => void
  compact?: boolean
}) {
  const [profile, setProfile] = useState(readProfile)
  const [presets, setPresets] = useState(readPresets)
  const [presetId, setPresetId] = useState('')
  const [presetName, setPresetName] = useState('')
  const [available, setAvailable] = useState<Gamepad[]>([])
  const [selected, setSelected] = useState<number | undefined>()
  const [channels, setChannels] = useState<(number | null)[]>(Array(16).fill(null))
  const [enabled, setEnabled] = useState(false)
  const [error, setError] = useState('')
  const [advancedOpen, setAdvancedOpen] = useState(true)
  const [detecting, setDetecting] = useState<number | null>(null)
  const detectBefore = useRef<GamepadInput | undefined>(undefined)
  const sending = useRef(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const monitor = useRef<BroadcastChannel | null>(null)

  useEffect(() => {
    if (typeof BroadcastChannel !== 'function') return
    const bus = new BroadcastChannel(JOYSTICK_MONITOR_CHANNEL)
    monitor.current = bus
    return () => {
      bus.postMessage({ type: 'sample', connected: false, enabled: false, deviceId: '', channels: Array(16).fill(null) })
      bus.close()
      monitor.current = null
    }
  }, [])

  useEffect(() => { onActiveChange?.(enabled); return () => onActiveChange?.(false) }, [enabled, onActiveChange])

  useEffect(() => { localStorage.setItem(storageKey, JSON.stringify(profile)) }, [profile])
  useEffect(() => { localStorage.setItem(presetsKey, JSON.stringify(presets)) }, [presets])
  useEffect(() => {
    if (!enabled) return
    return () => { void onRelease().catch(() => {}) }
  }, [enabled, onRelease])
  useEffect(() => { if (!connected && enabled) { setEnabled(false); setError('Зв’язок втрачено. Канали звільнено.') } }, [connected, enabled])
  useEffect(() => {
    const poll = () => {
      const list = pads()
      setAvailable(list)
      const exact = list.find(item => item.index === selected)
      if (selected !== undefined && !exact) {
        setChannels(Array(16).fill(null))
        monitor.current?.postMessage({ type: 'sample', connected: false, enabled: false, deviceId: '', channels: Array(16).fill(null) })
        if (enabled) { setEnabled(false); setError('Обраний пульт від’єднано. Канали звільнено.') }
        return
      }
      const pad = exact ?? list[0]
      if (pad && selected === undefined) setSelected(pad.index)
      if (!pad) {
        setChannels(Array(16).fill(null))
        monitor.current?.postMessage({ type: 'sample', connected: false, enabled: false, deviceId: '', channels: Array(16).fill(null) })
        if (enabled) { setEnabled(false); setError('Пульт від’єднано. Канали звільнено.') }
        return
      }
      if (detecting !== null && detectBefore.current) {
        const source = detectGamepadSource(detectBefore.current, pad)
        if (source) { change(detecting, { source }); setDetecting(null); detectBefore.current = undefined }
        else detectBefore.current = { axes: [...pad.axes], buttons: pad.buttons.map(button => ({ value: button.value, pressed: button.pressed })) }
      }
      const next = gamepadRcChannels(pad, profile)
      setChannels(next)
      monitor.current?.postMessage({ type: 'sample', connected: true, enabled, deviceId: pad.id, channels: next })
      if (enabled && next.slice(0, 4).some(value => value === null)) {
        setEnabled(false)
        setError('Основна вісь пульта зникла. Канали звільнено.')
      } else if (enabled && !connected) {
        setEnabled(false)
        setError('Зв’язок із платою втрачено. Канали звільнено.')
      } else if (enabled && !sending.current) {
        sending.current = true
        void onSend(next).catch((reason: unknown) => {
          setEnabled(false)
          setError(reason instanceof Error ? reason.message : 'Передача RC-каналів не вдалася.')
        }).finally(() => { sending.current = false })
      }
    }
    poll()
    const timer = window.setInterval(poll, 100)
    return () => window.clearInterval(timer)
  }, [selected, profile, enabled, connected, detecting, onSend])

  function change(index: number, update: Partial<RcChannelMapping>) {
    setEnabled(false)
    setProfile(previous => ({ ...previous, channels: previous.channels.map((item, at) => at === index ? { ...item, ...update } : item) }))
  }
  function enable() {
    if (enabled) { setEnabled(false); return }
    if (!connected) { setError('Під’єднай ArduPilot.'); return }
    if (!gamepadRcReady(channels)) { setError('Признач основні канали RC1–RC4 у профілі пульта.'); return }
    setError(''); setEnabled(true)
  }
  async function importProfile(file?: File) {
    if (!file) return
    try { setEnabled(false); setProfile(parseJoystickProfile(JSON.parse(await file.text()))); setError('Профіль імпортовано.') }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Не вдалося імпортувати профіль.') }
  }
  function exportProfile() {
    const blob = new Blob([JSON.stringify(profile, null, 2)], { type: 'application/json' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = 'MyRcHiFlY-joystick.json'
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(link.href), 1000)
  }
  function savePreset() {
    const name = presetName.trim().slice(0, 80)
    if (!name) { setError('Введи назву пресету.'); return }
    const existing = presets.find(item => item.id === presetId)
    const id = existing?.id ?? crypto.randomUUID()
    setPresets(previous => existing
      ? previous.map(item => item.id === id ? { id, name, profile } : item)
      : [...previous, { id, name, profile }])
    setPresetId(id)
    setError(`Пресет «${name}» збережено.`)
  }
  function choosePreset(id: string) {
    setEnabled(false)
    setPresetId(id)
    const preset = presets.find(item => item.id === id)
    if (preset) { setProfile(parseJoystickProfile(preset.profile)); setPresetName(preset.name) }
    else setPresetName('')
  }
  function deletePreset() {
    const preset = presets.find(item => item.id === presetId)
    if (!preset || !window.confirm(`Видалити пресет «${preset.name}»?`)) return
    setPresets(previous => previous.filter(item => item.id !== preset.id))
    setPresetId(''); setPresetName(''); setError('Пресет видалено.')
  }

  const pad = available.find(item => item.index === selected) ?? available[0]
  const sources: GamepadSource[] = pad
    ? ['none', ...pad.axes.map((_, index) => `axis:${index}` as const), ...pad.buttons.map((_, index) => `button:${index}` as const)] : ['none']
  return <div className="joystick-panel">
    <div className="joystick-toolbar">
      <label>Пульт <select value={selected ?? ''} onChange={event => { setEnabled(false); setSelected(Number(event.target.value)) }}>
        {!available.length && <option value="">Пульт не знайдено</option>}
        {available.map(item => <option value={item.index} key={item.index}>{item.id}</option>)}
      </select></label>
      <button type="button" className={enabled ? 'joystick-stop' : 'classic-control-primary'} onClick={enable} disabled={!enabled && (!connected || !pad)}>
        {enabled ? 'Вимкнути пульт' : 'Увімкнути пульт'}
      </button>
      {onPopout && <button type="button" onClick={() => { setEnabled(false); onPopout() }}>↗ Окреме вікно</button>}
      {!compact && <button type="button" onClick={exportProfile}>Експорт</button>}
      {!compact && <button type="button" onClick={() => fileInput.current?.click()}>Імпорт</button>}
      <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={event => { void importProfile(event.target.files?.[0]); event.target.value = '' }} />
    </div>
    <p className={enabled ? 'classic-control-live' : ''}>{enabled ? 'Передача RC1–RC16 · 10 Гц' : 'Передача вимкнена. Признач канали й натисни «Увімкнути пульт».'}</p>
    {error && <p className="classic-control-error" role="alert">{error}</p>}
    {compact && <div className="pilot-live-channels" aria-label="Живі канали пульта">
      {[0, 1, 2, 3, 5, 9].map(index => <div key={index}><span>RC{index + 1}{index < 4 && <small>{primaryChannelLabels[index]}</small>}</span><strong>{channels[index] ?? '—'}</strong></div>)}
    </div>}
    {compact && <button type="button" className="joystick-advanced-toggle" onClick={() => setAdvancedOpen(value => !value)} aria-expanded={advancedOpen}>{advancedOpen ? 'Сховати призначення кнопок і каналів' : 'Призначити кнопки й канали'}</button>}
    <div className="joystick-advanced-content" hidden={!advancedOpen}>
    {compact && <div className="joystick-advanced-actions"><button type="button" onClick={exportProfile}>Експорт профілю</button><button type="button" onClick={() => fileInput.current?.click()}>Імпорт профілю</button></div>}
    <div className="joystick-presets">
      <label>Збережені профілі <select value={presetId} onChange={event => choosePreset(event.target.value)}>
        <option value="">Поточне налаштування</option>
        {presets.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
      <label>Назва профілю <input value={presetName} onChange={event => setPresetName(event.target.value)} placeholder="Наприклад: Radiomaster TX16S" maxLength={80} /></label>
      <button type="button" onClick={savePreset}>Зберегти профіль</button>
      <button type="button" onClick={deletePreset} disabled={!presetId}>Видалити</button>
    </div>
    <p className="joystick-hint">RC1 крен · RC2 тангаж · RC3 газ · RC4 рискання. Решта каналів за замовчуванням вільні. Параметри профілю зберігаються на цьому комп’ютері.</p>
    <div className="joystick-table-wrap"><table className="joystick-table"><thead><tr>
      <th>Канал</th><th>Вісь / кнопка</th><th>Автовизначення</th><th>Вихід</th><th>Експо</th><th>Реверс</th>
    </tr></thead><tbody>{profile.channels.map((mapping, index) => <tr key={index}>
      <th className="joystick-channel-name">RC{index + 1}{index < 4 && <small>{primaryChannelLabels[index]}</small>}</th>
      <td><select aria-label={`Джерело RC${index + 1}`} value={mapping.source} onChange={event => change(index, { source: event.target.value as GamepadSource })}>
        {!sources.includes(mapping.source) && <option value={mapping.source}>{mapping.source} · відсутнє</option>}
        {sources.map(source => <option key={source} value={source}>{source === 'none' ? 'Не призначено' : source.startsWith('axis:') ? `Вісь ${Number(source.slice(5)) + 1}` : `Кнопка ${Number(source.slice(7)) + 1}`}</option>)}
      </select></td>
      <td><button type="button" className={detecting === index ? 'is-detecting' : ''} disabled={!pad} onClick={() => {
        if (!pad) return
        setEnabled(false); detectBefore.current = { axes: [...pad.axes], buttons: pad.buttons.map(button => ({ value: button.value, pressed: button.pressed })) }; setDetecting(index)
      }}>{detecting === index ? 'Рухай…' : 'Визначити'}</button></td>
      <td><output className="joystick-live-output" data-testid={`joystick-live-rc${index + 1}`}>
        <span className="joystick-live-output__track"><span style={{ width: `${channels[index] === null ? 0 : Math.max(0, Math.min(100, ((channels[index] ?? 900) - 900) / 12))}%` }} /></span>
        <span>{channels[index] ?? '—'}</span>
      </output></td>
      <td><input aria-label={`Експо RC${index + 1}`} type="number" min="-100" max="100" value={mapping.expo} onChange={event => change(index, { expo: Math.max(-100, Math.min(100, Number(event.target.value) || 0)) })} /></td>
      <td><input aria-label={`Реверс RC${index + 1}`} type="checkbox" checked={mapping.reverse} onChange={event => change(index, { reverse: event.target.checked })} /></td>
    </tr>)}</tbody></table></div>
    <p className="joystick-hint">Значення RC5–RC16 можуть перемикати режими або інші функції дрона. Призначай їх свідомо. При вимкненні пульта керування повертається до RC-приймача.</p>
    </div>
  </div>
}
