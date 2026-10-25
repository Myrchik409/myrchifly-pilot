import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { getDesktopBridge } from './desktop-bridge'
import { parseEndpoint, PilotRuntime, type PilotSnapshot } from './pilot-runtime'
import { JoystickPanel } from './JoystickPanel'
import './joystick.css'
import './pilot.css'

const endpointKey = 'myrchifly.pilot.repix-endpoint.v1'
const rtspKey = 'myrchifly.pilot.rtsp-url.v1'
const stickers = [
  { file: 'cyber-drone', name: 'Кібердрон' },
  { file: 'cyber-mascot', name: 'Кіберкіт' },
  { file: 'samurai', name: 'Самурай' },
  { file: 'pirate', name: 'Пірат' },
  { file: 'mechanic', name: 'Механік' },
  { file: 'neon-drone', name: 'Неоновий дрон' },
  { file: 'cleopatra', name: 'Клеопатра' },
  { file: 'pilot-cat', name: 'Пілотка' },
  { file: 'cleopatra-portrait', name: 'Клеопатра FPV' }
] as const
const splashScenes = [
  { image: '/splash/scene-1.webp', title: 'ЕКІПАЖ FPV', detail: 'Герої ангару чекають на твій відеопотік.' },
  { image: '/splash/scene-2.webp', title: 'АНГАР НРК', detail: 'Техніка й пілоти на стартовій позиції.' },
  { image: '/splash/scene-3.webp', title: 'НІЧНА ЗМІНА', detail: 'Наступний кадр почнеться з твого RTSP-потоку.' }
] as const

function readEndpoint(): string {
  try { return localStorage.getItem(endpointKey) ?? '' } catch { return '' }
}
function readRtspUrl(): string {
  try { return localStorage.getItem(rtspKey) ?? '' } catch { return '' }
}

function PilotApp() {
  const bridge = getDesktopBridge()
  const [endpoint, setEndpoint] = useState(readEndpoint)
  const [activeEndpoint, setActiveEndpoint] = useState('')
  const [linkBusy, setLinkBusy] = useState(false)
  const [linkError, setLinkError] = useState('')
  const [rtspUrl, setRtspUrl] = useState(readRtspUrl)
  const [stream, setStream] = useState('')
  const [videoBusy, setVideoBusy] = useState(false)
  const [videoError, setVideoError] = useState('')
  const [videoFullscreen, setVideoFullscreen] = useState(false)
  const [splashIndex, setSplashIndex] = useState(0)
  const [joystickActive, setJoystickActive] = useState(false)
  const [updateOpen, setUpdateOpen] = useState(false)
  const [updateBusy, setUpdateBusy] = useState(false)
  const [updateReady, setUpdateReady] = useState(false)
  const [updateProgress, setUpdateProgress] = useState<number | null>(null)
  const [updateError, setUpdateError] = useState('')
  const [updateInfo, setUpdateInfo] = useState<Awaited<ReturnType<NonNullable<typeof bridge>['updates']['check']>> | null>(null)
  const frame = useRef<HTMLDivElement>(null)

  const runtime = useMemo(() => parseEndpoint(activeEndpoint) && bridge?.socket ? new PilotRuntime(activeEndpoint) : undefined, [activeEndpoint, bridge])
  const [snapshot, setSnapshot] = useState<PilotSnapshot>({ connection: { kind: 'idle' }, staleLink: true })
  const live = snapshot.connection.kind === 'connected' && Boolean(snapshot.vehicle) && !snapshot.staleLink
  const send = useCallback((channels: (number | null)[]) => runtime?.sendRcOverride(channels) ?? Promise.reject(new Error('Підключи дрон.')), [runtime])
  const release = useCallback(() => runtime?.releaseRcOverrides() ?? Promise.resolve(), [runtime])

  useEffect(() => {
    if (!runtime) { setSnapshot({ connection: { kind: 'idle' }, staleLink: true }); return }
    const unsubscribe = runtime.subscribe(setSnapshot)
    void runtime.connect().catch(error => setLinkError(error instanceof Error ? error.message : 'Не вдалося підключитися до дрона.'))
    return () => {
      unsubscribe()
      void runtime.disconnect().catch(() => {}).finally(() => runtime.destroy())
    }
  }, [runtime])

  useEffect(() => () => { void bridge?.rtsp?.stop().catch(() => {}) }, [bridge])
  useEffect(() => bridge?.updates?.onProgress(setUpdateProgress), [bridge])
  useEffect(() => {
    if (stream) return
    const timer = window.setInterval(() => setSplashIndex(index => (index + 1) % splashScenes.length), 9000)
    return () => window.clearInterval(timer)
  }, [stream])
  useEffect(() => {
    const unsubscribe = bridge?.fullscreen?.onChanged(setVideoFullscreen)
    const syncBrowserFullscreen = () => setVideoFullscreen(document.fullscreenElement === frame.current)
    document.addEventListener('fullscreenchange', syncBrowserFullscreen)
    return () => { unsubscribe?.(); document.removeEventListener('fullscreenchange', syncBrowserFullscreen) }
  }, [bridge])
  useEffect(() => {
    if (!videoFullscreen || !bridge?.fullscreen) return
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') void bridge.fullscreen.set(false)
    }
    window.addEventListener('keydown', onEscape)
    return () => window.removeEventListener('keydown', onEscape)
  }, [bridge, videoFullscreen])

  const toggleVideoFullscreen = async () => {
    const next = !videoFullscreen
    try {
      if (bridge?.fullscreen) {
        await bridge.fullscreen.set(next)
        setVideoFullscreen(next)
      } else if (next) {
        await frame.current?.requestFullscreen()
      } else if (document.fullscreenElement) {
        await document.exitFullscreen()
      }
    } catch (error) {
      setVideoError(error instanceof Error ? error.message : 'Не вдалося змінити повноекранний режим.')
    }
  }

  const connect = async () => {
    const parsed = parseEndpoint(endpoint)
    if (!parsed) {
      setLinkError('Вкажи адресу MAVLink у форматі IP:порт.'); return
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
      setLinkError(error instanceof Error ? error.message : 'Не вдалося підключитися до дрона.')
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
    if (!/^rtsps?:\/\//i.test(rtspUrl.trim())) return
    setVideoBusy(true)
    setVideoError('')
    setStream('')
    try { localStorage.setItem(rtspKey, rtspUrl.trim()) } catch { /* The stream can still start without saved history. */ }
    try { setStream(await bridge.rtsp.start(rtspUrl.trim())) }
    catch (error) {
      setVideoError((error instanceof Error ? error.message : 'Не вдалося відкрити відео.').replace(/^Error invoking remote method ['"][^'"]+['"]: Error: /, ''))
    } finally { setVideoBusy(false) }
  }

  const stopVideo = async () => {
    setStream('')
    await bridge?.rtsp?.stop().catch(() => {})
  }

  const checkUpdate = async () => {
    if (!bridge?.updates || updateBusy) return
    setUpdateOpen(true)
    setUpdateBusy(true)
    setUpdateReady(false)
    setUpdateProgress(null)
    setUpdateInfo(null)
    setUpdateError('')
    try { setUpdateInfo(await bridge.updates.check()) }
    catch (error) { setUpdateError(error instanceof Error ? error.message : 'Не вдалося перевірити оновлення.') }
    finally { setUpdateBusy(false) }
  }

  const downloadUpdate = async () => {
    if (!bridge?.updates || updateBusy) return
    setUpdateBusy(true)
    setUpdateProgress(0)
    setUpdateError('')
    try { await bridge.updates.download(); setUpdateReady(true) }
    catch (error) { setUpdateError(error instanceof Error ? error.message : 'Не вдалося завантажити оновлення.') }
    finally { setUpdateBusy(false) }
  }

  const installUpdate = async () => {
    if (!bridge?.updates || updateBusy) return
    setUpdateBusy(true)
    setUpdateError('')
    try { await bridge.updates.apply() }
    catch (error) { setUpdateError(error instanceof Error ? error.message : 'Не вдалося запустити оновлення.'); setUpdateBusy(false) }
  }

  const updateNeedsIdle = snapshot.connection.kind !== 'idle' || joystickActive || Boolean(stream) || videoBusy || linkBusy

  return <main className={`pilot-app${videoFullscreen ? ' is-video-fullscreen' : ''}`}>
    <div className="pilot-comic-background" aria-hidden="true">{stickers.map(sticker => <div className="pilot-comic-panel" key={sticker.file}><img src={`/stickers/${sticker.file}.webp`} alt="" /></div>)}</div>
    <header className="pilot-header">
      <div className="pilot-brand"><img src="/pilot-icon.png" alt="" /><div><strong>MyRcHiFlY <span>PILOT</span></strong><small>ВІДЕО · ПУЛЬТ</small></div></div>
      <div className="pilot-statuses">
        <button type="button" className="pilot-button pilot-update-button" onClick={() => void checkUpdate()} disabled={!bridge?.updates || updateBusy}>↻ Оновлення</button>
        <span className={`pilot-pill ${live ? 'is-live' : ''}`}>{live ? '● MAVLink ON' : snapshot.connection.kind === 'connected' ? 'Очікування дрона…' : '○ MAVLink OFF'}</span>
        <span className={`pilot-pill ${stream ? 'is-live' : ''}`}>{stream ? '● Відео ON' : '○ Відео OFF'}</span>
        <span className={`pilot-pill ${joystickActive ? 'is-live' : ''}`}>{joystickActive ? '● Пульт ON' : '○ Пульт OFF'}</span>
      </div>
    </header>

    {updateOpen && <section className="pilot-update-panel" aria-label="Оновлення програми">
      <div className="pilot-update-heading"><strong>Оновлення MyRcHiFlY Pilot</strong><button type="button" className="pilot-update-close" onClick={() => setUpdateOpen(false)} aria-label="Закрити">✕</button></div>
      {updateBusy && updateProgress === null && <p>Перевіряю релізи на GitHub…</p>}
      {updateInfo && <p>Встановлено {updateInfo.currentVersion} · Останній реліз {updateInfo.latestVersion}</p>}
      {updateInfo && !updateInfo.available && !updateBusy && <p>У тебе актуальна версія програми.</p>}
      {updateInfo?.available && <>
        <p>Доступна нова версія {updateInfo.latestVersion}{updateInfo.installerBytes ? ` · ${(updateInfo.installerBytes / 1048576).toFixed(0)} МБ` : ''}.</p>
        {updateBusy && updateProgress !== null && <p>Завантаження: {updateProgress}%</p>}
        {!updateReady && <button type="button" className="pilot-button primary" onClick={() => void downloadUpdate()} disabled={updateBusy}>Завантажити оновлення</button>}
        {updateReady && <><button type="button" className="pilot-button primary" onClick={() => void installUpdate()} disabled={updateBusy || updateNeedsIdle}>Встановити й перезапустити</button>
          {updateNeedsIdle && <p>Перед встановленням вимкни пульт, відео та відключи MAVLink.</p>}</>}
      </>}
      {updateError && <p className="pilot-error" role="alert">{updateError}</p>}
    </section>}

    <section className="pilot-connection" aria-label="Зв’язок MAVLink">
      <label>MAVLink UDP <input value={endpoint} onChange={event => setEndpoint(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void connect() }} placeholder="IP:порт, наприклад 203.0.113.10:14550" spellCheck={false} /></label>
      {snapshot.connection.kind === 'connected' ? <button type="button" className="pilot-button danger" onClick={() => void disconnect()} disabled={linkBusy}>Відключити</button>
        : <button type="button" className="pilot-button primary" onClick={() => void connect()} disabled={!bridge?.socket || linkBusy}>{linkBusy ? 'Підключення…' : 'Підключити'}</button>}
      <div className="pilot-telemetry"><b>{snapshot.vehicle?.flightMode ?? 'Режим —'}</b><span>{snapshot.vehicle ? snapshot.vehicle.armed ? 'ARMED' : 'DISARMED' : 'Немає телеметрії'}</span></div>
    </section>
    {linkError && <p className="pilot-error" role="alert">{linkError}</p>}
    {!bridge?.socket && <p className="pilot-error">Для UDP-зв’язку потрібна настільна версія MyRcHiFlY Pilot.</p>}

    <section className="pilot-content">
      <div className="pilot-video">
        <div className="pilot-section-title"><h1>Відео</h1><button type="button" className="pilot-button quiet" onClick={() => void toggleVideoFullscreen()}>{videoFullscreen ? '✕ Вийти з повного екрана' : '⛶ На весь екран'}</button></div>
        <div className="pilot-video-controls"><label>RTSP-адреса<input type="url" value={rtspUrl} onChange={event => setRtspUrl(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void startVideo() }} placeholder="rtsp://…" spellCheck={false} autoComplete="off" /></label><button type="button" className="pilot-button primary" onClick={() => void startVideo()} disabled={!/^rtsps?:\/\//i.test(rtspUrl.trim()) || videoBusy || !bridge?.rtsp}>{videoBusy ? 'Запуск…' : stream ? 'Перепідключити' : 'Показати відео'}</button>{stream && <button type="button" className="pilot-button quiet" onClick={() => void stopVideo()}>Стоп</button>}</div>
        {videoError && <p className="pilot-error" role="alert">{videoError}</p>}
        <div ref={frame} className="pilot-frame" onDoubleClick={() => { if (stream) void toggleVideoFullscreen() }}>
          {stream.startsWith('http://127.0.0.1:') ? <img src={stream} alt="Відеопотік" onError={() => { void stopVideo(); setVideoError('Потік перервався. Перевір мережу та підключи відео знову.') }} /> :
            <div className="pilot-splash">
              {splashScenes.map((scene, index) => <img key={scene.image} className={index === splashIndex ? 'pilot-splash-scene is-active' : 'pilot-splash-scene'} src={scene.image} alt="" aria-hidden="true" />)}
              <div className="pilot-splash-copy" aria-live="off"><span>MYRCHIFLY // PILOT</span><strong>{splashScenes[splashIndex].title}</strong><p>{splashScenes[splashIndex].detail}</p><small>Встав RTSP-адресу вище й натисни «Показати відео»</small></div>
              <div className="pilot-splash-pages" aria-label="Кадри заставки">{splashScenes.map((scene, index) => <button key={scene.image} type="button" className={index === splashIndex ? 'is-active' : ''} onClick={() => setSplashIndex(index)} aria-label={`Показати кадр ${index + 1}`} aria-pressed={index === splashIndex} />)}</div>
            </div>}
        </div>
      </div>
      <section className="pilot-controller"><h2>Пульт · кнопки та канали</h2><JoystickPanel compact connected={live} onSend={send} onRelease={release} onActiveChange={setJoystickActive} /></section>
    </section>
  </main>
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(<React.StrictMode><PilotApp /></React.StrictMode>)
