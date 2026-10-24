import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { createServer, type Server, type ServerResponse } from 'node:http'
import { createServer as createTcpServer, type AddressInfo, type Server as TcpServer, type Socket } from 'node:net'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { ensurePrivateGstreamer, privateGstreamerBinary } from './gstreamer-runtime.js'

const require = createRequire(import.meta.url)
const jpegEnd = Buffer.from([0xff, 0xd9])

class RtspStreamError extends Error {}

export function describeRtspFailure(stderr: string, timedOut = false): string {
  if (/Option .*not found|Unrecognized option/i.test(stderr)) return 'Вбудований FFmpeg не підтримує параметр запуску. Онови програму.'
  if (/401|unauthorized|authentication failed/i.test(stderr)) return 'Камера відхилила доступ. Перевір логін, пароль або термін дії посилання.'
  if (/403|forbidden/i.test(stderr)) return 'Камера заборонила доступ до цього потоку.'
  if (/\b404\b|(?:stream|resource) not found/i.test(stderr)) return 'Потік за цією адресою не знайдено. Перевір шлях RTSP.'
  if (/connection refused/i.test(stderr)) return 'З’єднання відхилено. Перевір адресу, порт і чи працює камера.'
  if (/resolve hostname|name or service not known|no such host/i.test(stderr)) return 'Не вдалося знайти сервер камери. Перевір адресу та мережу.'
  if (timedOut || /timed out|timeout/i.test(stderr)) return 'Камера не відповіла вчасно або не передає кадри. Перевір мережу й доступ до потоку.'
  if (/invalid data|unsupported codec|decoder/i.test(stderr)) return 'Потік відкрився, але формат відео не вдалося декодувати.'
  return 'Кадри не надійшли. Перевір RTSP-адресу, доступ камери й мережу.'
}

function ffmpegBinary(): string {
  if (process.env.ARDUCONFIG_FFMPEG_PATH) return process.env.ARDUCONFIG_FFMPEG_PATH
  try {
    const bundled = require('ffmpeg-static') as string | null
    if (bundled) return bundled.replace('app.asar', 'app.asar.unpacked')
  } catch { /* An unpackaged development checkout can use PATH. */ }
  return 'ffmpeg'
}

/** Mission Planner installs GStreamer under ProgramData; standard installs use GSTREAMER_1_0_ROOT_X86_64. */
export function gstreamerBinary(): string | undefined {
  const candidates = [
    process.env.ARDUCONFIG_GSTREAMER_PATH,
    privateGstreamerBinary(),
    process.env.GSTREAMER_1_0_ROOT_X86_64 && join(process.env.GSTREAMER_1_0_ROOT_X86_64, 'bin', 'gst-launch-1.0.exe'),
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Programs', 'gstreamer', '1.0', 'msvc_x86_64', 'bin', 'gst-launch-1.0.exe'),
    process.env.ProgramData && join(process.env.ProgramData, 'Mission Planner', 'gstreamer', '1.0', 'x86_64', 'bin', 'gst-launch-1.0.exe')
  ]
  return candidates.find((candidate): candidate is string => Boolean(candidate && existsSync(candidate)))
}

/** Equivalent to Mission Planner's RTSP/decodebin pipeline, with MJPEG sent to a private loopback socket. */
export function gstreamerArguments(url: string, port: number): string[] {
  return [
    '-q', 'rtspsrc', `location=${url}`, 'latency=100', 'protocols=tcp',
    '!', 'application/x-rtp', '!', 'decodebin3',
    '!', 'queue', 'max-size-buffers=1', 'leaky=downstream',
    '!', 'videoconvert', '!', 'videoscale', '!', 'video/x-raw,width=960',
    '!', 'videorate', '!', 'video/x-raw,framerate=12/1',
    '!', 'jpegenc', 'quality=80', '!', 'multipartmux', 'boundary=frame',
    '!', 'tcpclientsink', 'host=127.0.0.1', `port=${port}`, 'sync=false'
  ]
}

export function validateRtspUrl(input: string): string {
  if (typeof input !== 'string' || input.length > 2048) throw new Error('Вкажи коректну RTSP-адресу.')
  let url: URL
  try { url = new URL(input) } catch { throw new Error('Вкажи коректну RTSP-адресу.') }
  if (!['rtsp:', 'rtsps:'].includes(url.protocol) || !url.hostname) {
    throw new Error('Підтримується адреса rtsp:// або rtsps://.')
  }
  return url.href
}

export function rtspTransportFor(url: string): string {
  // FFmpeg tries the listed transports in order when SETUP rejects one.
  return url.startsWith('rtsps:') ? 'tcp' : 'tcp+udp'
}

export function rtspDecoderArguments(url: string): string[] {
  return [
    '-hide_banner', '-loglevel', 'error', '-nostdin',
    '-rtsp_transport', rtspTransportFor(url), '-rtsp_flags', 'prefer_tcp',
    '-timeout', '5000000', '-i', url,
    '-an', '-vf', 'fps=12,scale=960:-2', '-q:v', '5',
    '-f', 'mpjpeg', '-boundary_tag', 'frame', 'pipe:1'
  ]
}

export function relayMjpegChunk(viewers: Set<ServerResponse>, chunk: Buffer): void {
  for (const viewer of viewers) {
    if (viewer.destroyed) { viewers.delete(viewer); continue }
    // write() returning false signals normal backpressure, not a broken
    // connection. A single JPEG can exceed Node's 16 KiB high-water mark.
    viewer.write(chunk)
    if (viewer.writableLength > 4 * 1024 * 1024) {
      viewer.destroy()
      viewers.delete(viewer)
    }
  }
}

/** Localhost-only MJPEG relay. The stream address carries an unguessable token. */
export class RtspPreviewSession {
  private server?: Server
  private gstServer?: TcpServer
  private gstSocket?: Socket
  private decoder?: ChildProcessWithoutNullStreams
  private initialFrame?: Buffer
  private readonly viewers = new Set<ServerResponse>()

  constructor(private readonly gstInstaller?: string) {}

  async start(input: string): Promise<string> {
    const url = validateRtspUrl(input)
    await this.stop()
    const token = randomBytes(20).toString('hex')
    const server = createServer((request, response) => {
      if (request.url !== `/${token}` || request.method !== 'GET') {
        response.writeHead(404).end()
        return
      }
      response.writeHead(200, {
        'Content-Type': 'multipart/x-mixed-replace; boundary=frame',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff'
      })
      this.viewers.add(response)
      response.on('close', () => this.viewers.delete(response))
      if (this.initialFrame) response.write(this.initialFrame)
    })
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve() })
      })
      this.server = server
      if (await this.tryStartGStreamer(url)) {
        const port = (server.address() as AddressInfo).port
        return `http://127.0.0.1:${port}/${token}`
      }
      const binary = ffmpegBinary()
      const decoder = spawn(binary, rtspDecoderArguments(url), {
        shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']
      })
      await new Promise<void>((resolve, reject) => {
        decoder.once('spawn', resolve)
        decoder.once('error', reject)
      })
      this.decoder = decoder
      // Wait for an actual JPEG before claiming the stream is live. Never expose
      // raw FFmpeg output: it may contain credentials from the RTSP address.
      let stderr = ''
      decoder.stderr.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString('utf8')).slice(-8192) })
      let firstFrame = Buffer.alloc(0)
      await new Promise<void>((resolve, reject) => {
        let settled = false
        const finish = (error?: Error) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          if (error) reject(error)
          else resolve()
        }
        const timer = setTimeout(() => finish(new RtspStreamError(describeRtspFailure(stderr, true))), 15000)
        decoder.stdout.on('data', (chunk: Buffer) => {
          if (!settled) {
            firstFrame = Buffer.concat([firstFrame, chunk])
            if (firstFrame.length > 4 * 1024 * 1024) {
              finish(new RtspStreamError('Кадр відео завеликий для попереднього перегляду.'))
              return
            }
            if (firstFrame.indexOf(jpegEnd) >= 0) {
              this.initialFrame = firstFrame
              finish()
            }
          }
          relayMjpegChunk(this.viewers, chunk)
        })
        decoder.once('close', () => {
          if (!settled) finish(new RtspStreamError(describeRtspFailure(stderr)))
          else if (this.decoder === decoder) void this.stop()
        })
      })
      const port = (server.address() as AddressInfo).port
      return `http://127.0.0.1:${port}/${token}`
    } catch (error) {
      await this.stop()
      throw new Error(error instanceof RtspStreamError ? error.message : error instanceof Error && 'code' in error && error.code === 'ENOENT'
        ? 'FFmpeg не знайдено на комп’ютері. Встанови FFmpeg для перегляду RTSP.'
        : 'Не вдалося відкрити локальний RTSP-переглядач.')
    }
  }

  private async tryStartGStreamer(url: string): Promise<boolean> {
    const binary = gstreamerBinary() ?? await ensurePrivateGstreamer(this.gstInstaller)
    if (!binary) return false

    let firstFrame = Buffer.alloc(0)
    let ready = false
    let decoder: ChildProcessWithoutNullStreams | undefined
    const gstServer = createTcpServer((socket) => {
      // Only the decoder launched below should connect to this private port.
      if (this.gstSocket) { socket.destroy(); return }
      this.gstSocket = socket
      socket.on('error', () => {})
      socket.on('data', (chunk: Buffer) => {
        if (!ready) {
          firstFrame = Buffer.concat([firstFrame, chunk])
          if (firstFrame.length > 4 * 1024 * 1024) { socket.destroy(); return }
          if (firstFrame.indexOf(jpegEnd) >= 0) {
            ready = true
            this.initialFrame = firstFrame
          }
        }
        relayMjpegChunk(this.viewers, chunk)
      })
      socket.on('close', () => { if (ready && this.gstSocket === socket) void this.stop() })
    })
    try {
      await new Promise<void>((resolve, reject) => {
        gstServer.once('error', reject)
        gstServer.listen(0, '127.0.0.1', () => { gstServer.off('error', reject); resolve() })
      })
      this.gstServer = gstServer
      const port = (gstServer.address() as AddressInfo).port
      const gstBin = dirname(binary)
      decoder = spawn(binary, gstreamerArguments(url, port), {
        shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PATH: `${gstBin}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH || ''}` }
      })
      this.decoder = decoder
      decoder.stderr.resume()
      // gst-launch -q has no useful stdout; decoded frames arrive through tcpclientsink.
      decoder.stdout.resume()
      await new Promise<void>((resolve, reject) => {
        const finish = (error?: Error) => {
          clearInterval(interval)
          clearTimeout(timeout)
          decoder!.off('close', onClose)
          decoder!.off('error', onError)
          if (error) reject(error)
          else resolve()
        }
        const onClose = () => finish(new Error('GStreamer exited'))
        const onError = () => finish(new Error('GStreamer failed'))
        const interval = setInterval(() => {
          if (ready) finish()
          else if (firstFrame.length > 4 * 1024 * 1024) finish(new Error('Frame too large'))
        }, 50)
        const timeout = setTimeout(() => finish(new Error('GStreamer timeout')), 12000)
        decoder!.once('close', onClose)
        decoder!.once('error', onError)
      })
      decoder.once('close', () => { if (this.decoder === decoder) void this.stop() })
      return true
    } catch {
      // A missing plugin, unsupported stream, or old runtime should not block
      // the bundled FFmpeg decoder. Never include GStreamer stderr: URLs may
      // contain private camera credentials or signed query tokens.
      if (this.decoder === decoder) this.decoder = undefined
      decoder?.kill()
      this.gstSocket?.destroy()
      this.gstSocket = undefined
      this.gstServer = undefined
      if (gstServer.listening) await new Promise<void>((resolve) => gstServer.close(() => resolve()))
      this.initialFrame = undefined
      return false
    }
  }

  async stop(): Promise<void> {
    const decoder = this.decoder
    this.decoder = undefined
    this.initialFrame = undefined
    decoder?.kill()
    this.gstSocket?.destroy()
    this.gstSocket = undefined
    const gstServer = this.gstServer
    this.gstServer = undefined
    if (gstServer) await new Promise<void>((resolve) => gstServer.close(() => resolve()))
    for (const viewer of this.viewers) viewer.destroy()
    this.viewers.clear()
    const server = this.server
    this.server = undefined
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}
