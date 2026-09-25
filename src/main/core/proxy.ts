import http from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { Duplex } from 'node:stream'
import type { Socket } from 'node:net'

export type Dial = () => Promise<Duplex>
// A credential-gated loopback proxy, restricted to one service. No direct-network fallback.
export class ServiceProxy {
  readonly username = 'portico'
  readonly password = randomBytes(32).toString('hex')
  private server = http.createServer()
  private sockets = new Set<Duplex>()
  private expected = Buffer.from(
    `Basic ${Buffer.from(`${this.username}:${this.password}`).toString('base64')}`
  )
  port = 0
  constructor(
    private hostname: string,
    private remotePort: number,
    private protocol: 'http' | 'https',
    private dial: Dial
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
      if (!this.allowed(url) || url.protocol !== 'http:') {
        res.writeHead(403).end()
        return
      }
      void this.dial()
        .then((channel) => {
          this.track(channel)
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
              hostname: this.hostname,
              port: this.remotePort,
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
            res.end('SSH service unavailable')
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
          res.end('SSH service unavailable')
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
      if (!this.allowed(url)) {
        socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n')
        return
      }
      void this.dial()
        .then((channel) => {
          this.track(channel)
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
      if (!this.allowed(url) || this.protocol !== 'http') {
        socket.destroy()
        return
      }
      void this.dial()
        .then((channel) => {
          this.track(channel)
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
  private track(channel: Duplex): void {
    this.sockets.add(channel)
    channel.on('close', () => this.sockets.delete(channel))
    channel.on('error', () => channel.destroy())
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
    for (const socket of this.sockets) socket.destroy()
    this.sockets.clear()
    this.server.close()
  }
}
