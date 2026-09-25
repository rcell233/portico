import http from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { Duplex } from 'node:stream'
import type { Socket } from 'node:net'

export type Dial = () => Promise<Duplex>
// Credential-gated proxy: the saved service always uses SSH; external resources
// use a separate public-network dialer, never as a fallback for the service.
export class ServiceProxy {
  readonly username = 'portico'
  readonly password = randomBytes(32).toString('hex')
  private server = http.createServer()
  private sockets = new Set<Duplex>()
  private closed = false
  private expected = Buffer.from(
    `Basic ${Buffer.from(`${this.username}:${this.password}`).toString('base64')}`
  )
  port = 0
  constructor(
    private hostname: string,
    private remotePort: number,
    private protocol: 'http' | 'https',
    private dial: Dial,
    private externalDial?: (url: URL) => Promise<Duplex>
  ) {
    this.server.on('connection', (socket) => {
      this.sockets.add(socket)
      socket.on('close', () => this.sockets.delete(socket))
      socket.on('error', () => {})
    })
    this.server.on('clientError', (_error, socket) => socket.destroy())
    this.server.on('request', (req, res) => {
      if (!this.auth(req)) {
        res.writeHead(407, { 'Proxy-Authenticate': 'Basic realm="Portico"' })
        res.end()
        return
      }
      let url: URL
      try {
        url = new URL(req.url || '', `http://${req.headers.host || ''}`)
      } catch {
        res.writeHead(400).end()
        return
      }
      if (!this.canRequest(url) || url.protocol !== 'http:') {
        res.writeHead(403).end()
        return
      }
      void this.connect(url)
        .then((channel) => {
          if (!this.track(channel)) return
          if (req.destroyed) {
            channel.destroy()
            return
          }
          const agent = new http.Agent({ keepAlive: false })
          agent.createConnection = () => channel as Socket
          const headers = { ...req.headers }
          delete headers['proxy-authorization']
          delete headers['proxy-connection']
          const upstream = http.request(
            {
              hostname: url.hostname,
              port: Number(url.port || 80),
              method: req.method,
              path: url.pathname + url.search,
              headers,
              agent
            },
            (response) => {
              res.writeHead(response.statusCode || 502, response.headers)
              response.pipe(res)
              response.on('error', () => res.destroy())
            }
          )
          upstream.on('error', () => {
            if (!res.headersSent) res.writeHead(502)
            res.end(
              this.allowed(url)
                ? 'SSH service unavailable'
                : 'External resource unavailable'
            )
          })
          res.on('close', () => {
            upstream.destroy()
            agent.destroy()
            channel.destroy()
          })
          req.pipe(upstream)
        })
        .catch(() => {
          if (!res.headersSent) res.writeHead(502)
          res.end(
            this.allowed(url)
              ? 'SSH service unavailable'
              : 'External resource unavailable'
          )
        })
    })
    this.server.on('connect', (req, socket, head) => {
      if (!this.auth(req)) {
        socket.end(
          'HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="Portico"\r\nContent-Length: 0\r\n\r\n'
        )
        return
      }
      let url: URL
      try {
        url = new URL(`https://${req.url}`)
      } catch {
        socket.destroy()
        return
      }
      if (!this.canRequest(url)) {
        socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n')
        return
      }
      void this.connect(url)
        .then((channel) => {
          if (!this.track(channel)) return
          if (socket.destroyed) {
            channel.destroy()
            return
          }
          socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
          if (head.length) channel.write(head)
          this.bridge(socket, channel)
        })
        .catch(() => socket.destroy())
    })
    this.server.on('upgrade', (req, socket, head) => {
      if (!this.auth(req)) {
        socket.end(
          'HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="Portico"\r\nContent-Length: 0\r\n\r\n'
        )
        return
      }
      let url: URL
      try {
        url = new URL(req.url || '', `http://${req.headers.host || ''}`)
      } catch {
        socket.destroy()
        return
      }
      if (!this.canRequest(url) || !['http:', 'ws:'].includes(url.protocol)) {
        socket.destroy()
        return
      }
      void this.connect(url)
        .then((channel) => {
          if (!this.track(channel)) return
          if (socket.destroyed) {
            channel.destroy()
            return
          }
          const headers = Object.entries(req.headers)
            .filter(
              ([key]) =>
                !['proxy-authorization', 'proxy-connection'].includes(key)
            )
            .map(
              ([key, value]) =>
                `${key}: ${Array.isArray(value) ? value.join(', ') : value}`
            )
            .join('\r\n')
          channel.write(
            `${req.method} ${url.pathname}${url.search} HTTP/1.1\r\n${headers}\r\n\r\n`
          )
          if (head.length) channel.write(head)
          this.bridge(socket, channel)
        })
        .catch(() => socket.destroy())
    })
  }
  private auth(req: http.IncomingMessage): boolean {
    const given = Buffer.from(req.headers['proxy-authorization'] || '')
    return (
      given.length === this.expected.length &&
      timingSafeEqual(given, this.expected)
    )
  }
  allowed(url: URL): boolean {
    return (
      url.hostname.replace(/^\[|\]$/g, '') ===
        this.hostname.replace(/^\[|\]$/g, '') &&
      Number(
        url.port || (['https:', 'wss:'].includes(url.protocol) ? 443 : 80)
      ) === this.remotePort &&
      ['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)
    )
  }
  canRequest(url: URL): boolean {
    return (
      this.allowed(url) ||
      Boolean(
        this.externalDial &&
        ['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) &&
        url.hostname.replace(/^\[|\]$/g, '') !==
          this.hostname.replace(/^\[|\]$/g, '')
      )
    )
  }
  private connect(url: URL): Promise<Duplex> {
    if (this.allowed(url)) return this.dial()
    if (this.canRequest(url) && this.externalDial) return this.externalDial(url)
    return Promise.reject(new Error('Destination not allowed'))
  }
  private track(channel: Duplex): boolean {
    if (this.closed) {
      channel.destroy()
      return false
    }
    this.sockets.add(channel)
    channel.on('close', () => this.sockets.delete(channel))
    channel.on('error', () => channel.destroy())
    return true
  }
  private bridge(a: Duplex, b: Duplex): void {
    a.pipe(b).pipe(a)
    a.on('error', () => b.destroy())
    b.on('error', () => a.destroy())
    a.on('close', () => b.destroy())
    b.on('close', () => a.destroy())
  }
  async start(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject)
      this.server.listen(0, '127.0.0.1', () => {
        this.server.removeListener('error', reject)
        this.port = (this.server.address() as { port: number }).port
        resolve()
      })
    })
  }
  close(): void {
    this.closed = true
    for (const socket of this.sockets) socket.destroy()
    this.sockets.clear()
    this.server.close()
  }
}
