import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { getDesktopBridge } from './desktop-bridge'
import { parseEndpoint, PilotRuntime, type PilotSnapshot } from './pilot-runtime'
import { JoystickPanel } from './JoystickPanel'
import './joystick.css'
import './pilot.css'

const endpointKey = 'myrchifly.pilot.repix-endpoint.v1'

function readEndpoint(): string {
  try { return localStorage.getItem(endpointKey) ?? '' } catch { return '' }
}

function PilotApp() {
  const bridge = getDesktopBridge()
  const [endpoint, setEndpoint] = useState(readEndpoint)
  const [activeEndpoint, setActiveEndpoint] = useState(readEndpoint)
  const [linkBusy, setLinkBusy] = useState(false)
  const [linkError, setLinkError] = useState('')
  const [rtspUrl, setRtspUrl] = useState('')
  const [stream, setStream] = useState('')
  const [videoBusy, setVideoBusy] = useState(false)
  const [videoError, setVideoError] = useState('')
  const [joystickActive, setJoystickActive] = useState(false)
  const frame = useRef<HTMLDivElement>(null)

  const runtime = useMemo(() => parseEndpoint(activeEndpoint) && bridge?.socket ? new PilotRuntime(activeEndpoint) : undefined, [activeEndpoint, bridge])
  const [snapshot, setSnapshot] = useState<PilotSnapshot>({ connection: { kind: 'idle' }, staleLink: true })
  const live = snapshot.connection.kind === 'connected' && Boolean(snapshot.vehicle) && !snapshot.staleLink
  const send = useCallback((channels: (number | null)[]) => runtime?.sendRcOverride(channels) ?? Promise.reject(new Error('Підключи REPIX.')), [runtime])
  const release = useCallback(() => runtime?.releaseRcOverrides() ?? Promise.resolve(), [runtime])

  useEffect(() => {
    if (!runtime) { setSnapshot({ connection: { kind: 'idle' }, staleLink: true }); return }
    const unsubscribe = runtime.subscribe(setSnapshot)
    void runtime.connect().catch(error => setLinkError(error instanceof Error ? error.message : 'Не вдалося підключитися до REPIX.'))
    return () => {
      unsubscribe()
      void runtime.disconnect().catch(() => {}).finally(() => runtime.destroy())
    }
  }, [runtime])

  useEffect(() => () => { void bridge?.rtsp?.stop().catch(() => {}) }, [bridge])

  const connect = async () => {
    const parsed = parseEndpoint(endpoint)
    if (!parsed) {
      setLinkError('Вкажи адресу REPIX у форматі IP:порт.'); return
    }
    setLinkBusy(true)
    setLinkError('')
    try {
      if (snapshot.connection.kind === 'connected') await runtime?.disconnect()
      if (activeEndpoint !== endpoint.trim()) {
        setActiveEndpoint(endpoint.trim())
      } else {
        await runtime?.connect()
      }
      localStorage.setItem(endpointKey, endpoint.trim())
    } catch (error) {
      setLinkError(error instanceof Error ? error.message : 'Не вдалося підключитися до REPIX.')
    } finally { setLinkBusy(false) }
  }

  const disconnect = async () => {
    setLinkBusy(true)
    try { await runtime?.disconnect() }
    catch (error) { setLinkError(error instanceof Error ? error.message : 'Не вдалося розірвати з’єднання.') }
    finally { setLinkBusy(false) }
  }

  const startVideo = async () => {
    if (!bridge?.rtsp || videoBusy) return
    setVideoBusy(true)
    setVideoError('')
    setStream('')
    try { setStream(await bridge.rtsp.start(rtspUrl.trim())) }
    catch (error) {
      setVideoError((error instanceof Error ? error.message : 'Не вдалося відкрити відео.').replace(/^Error invoking remote method ['"][^'"]+['"]: Error: /, ''))
    } finally { setVideoBusy(false) }
  }

  const stopVideo = async () => {
    setStream('')
    await bridge?.rtsp?.stop().catch(() => {})
  }

  return <main className="pilot-app">
    <header className="pilot-header">
      <div className="pilot-brand"><img src="/fpv-cat-goggles.png" alt="" /><div><strong>MyRcHiFlY <span>PILOT</span></strong><small>REPIX · ВІДЕО ТА ПУЛЬТ</small></div></div>
      <div className="pilot-statuses">
        <span className={`pilot-pill ${live ? 'is-live' : ''}`}>{live ? '● MAVLink ON' : snapshot.connection.kind === 'connected' ? 'Очікування дрона…' : '○ MAVLink OFF'}</span>
        <span className={`pilot-pill ${stream ? 'is-live' : ''}`}>{stream ? '● Відео ON' : '○ Відео OFF'}</span>
        <span className={`pilot-pill ${joystickActive ? 'is-live' : ''}`}>{joystickActive ? '● Пульт ON' : '○ Пульт OFF'}</span>
      </div>
    </header>

    <section className="pilot-connection" aria-label="Зв’язок REPIX">
      <label>REPIX MAVLink <input value={endpoint} onChange={event => setEndpoint(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void connect() }} placeholder="IP:порт, наприклад 203.0.113.10:14550" spellCheck={false} /></label>
      {snapshot.connection.kind === 'connected' ? <button type="button" className="pilot-button danger" onClick={() => void disconnect()} disabled={linkBusy}>Відключити</button>
        : <button type="button" className="pilot-button primary" onClick={() => void connect()} disabled={!bridge?.socket || linkBusy}>{linkBusy ? 'Підключення…' : 'Підключити'}</button>}
      <div className="pilot-telemetry"><b>{snapshot.vehicle?.flightMode ?? 'Режим —'}</b><span>{snapshot.vehicle ? snapshot.vehicle.armed ? 'ARMED' : 'DISARMED' : 'Немає телеметрії'}</span></div>
    </section>
    {linkError && <p className="pilot-error" role="alert">{linkError}</p>}
    {!bridge?.socket && <p className="pilot-error">Для UDP-зв’язку потрібна настільна версія MyRcHiFlY Pilot.</p>}

    <section className="pilot-content">
      <div className="pilot-video">
        <div className="pilot-section-title"><h1>Відео</h1><button type="button" className="pilot-button quiet" onClick={() => void frame.current?.requestFullscreen()} disabled={!stream}>⛶ На весь екран</button></div>
        <div className="pilot-video-controls"><label>RTSP-адреса<input type="url" value={rtspUrl} onChange={event => setRtspUrl(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void startVideo() }} placeholder="rtsp://…" spellCheck={false} autoComplete="off" /></label><button type="button" className="pilot-button primary" onClick={() => void startVideo()} disabled={!/^rtsps?:\/\//i.test(rtspUrl.trim()) || videoBusy || !bridge?.rtsp}>{videoBusy ? 'Запуск…' : stream ? 'Перепідключити' : 'Показати відео'}</button>{stream && <button type="button" className="pilot-button quiet" onClick={() => void stopVideo()}>Стоп</button>}</div>
        {videoError && <p className="pilot-error" role="alert">{videoError}</p>}
        <div ref={frame} className="pilot-frame" onDoubleClick={() => { if (stream) void frame.current?.requestFullscreen() }}>
          {stream.startsWith('http://127.0.0.1:') ? <img src={stream} alt="Відео REPIX" onError={() => { void stopVideo(); setVideoError('Потік перервався. Перевір мережу та підключи відео знову.') }} /> : <div className="pilot-frame-empty"><span>◉</span><b>Очікування відео</b><small>Встав RTSP-адресу й натисни «Показати відео»</small></div>}
        </div>
      </div>
      <section className="pilot-controller"><h2>Пульт · кнопки та канали</h2><JoystickPanel compact connected={live} onSend={send} onRelease={release} onActiveChange={setJoystickActive} /></section>
    </section>
  </main>
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(<React.StrictMode><PilotApp /></React.StrictMode>)
