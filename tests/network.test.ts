import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import net, { type AddressInfo } from 'node:net'
import { WebSocket, WebSocketServer } from 'ws'
import { ServiceProxy } from '../src/main/core/proxy'
import { ServiceManager } from '../src/main/core/services'
import { remoteApp, sshFixture } from './fixtures'

function request(
  port: number,
  url: string,
  auth?: string
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get(
      {
        hostname: '127.0.0.1',
        port,
        path: url,
        headers: auth ? { 'Proxy-Authorization': auth } : {}
      },
      (res) => {
        let body = ''
        res.on('data', (c) => (body += c))
        res.on('end', () => resolve({ status: res.statusCode || 0, body }))
      }
    )
    req.on('error', reject)
    req.setTimeout(8000, () => req.destroy(new Error('request timeout')))
  })
}
test(
  'SSH multiplexing, gated HTTP proxy, WebSocket, cookie and redirect transport',
  { timeout: 25000 },
  async () => {
    const fixture = await sshFixture()
    const web = http.createServer((req, res) => {
      if (req.url === '/redirect') {
        res.writeHead(302, { location: '/' }).end()
        return
      }
      assert.equal(req.headers['proxy-authorization'], undefined)
      res.setHeader('Set-Cookie', 'session=fixture; HttpOnly')
      res.end('fixture-service')
    })
    const ws = new WebSocketServer({ server: web })
    ws.on('connection', (socket) =>
      socket.on('message', (data) => socket.send(data))
    )
    await new Promise<void>((resolve) => web.listen(0, '127.0.0.1', resolve))
    const port = (web.address() as AddressInfo).port
    const proxy = new ServiceProxy('127.0.0.1', port, 'http', () =>
      fixture.ssh.forward(fixture.host.id, '127.0.0.1', port)
    )
    try {
      const clients = await Promise.all([
        fixture.ssh.connect(fixture.host.id),
        fixture.ssh.connect(fixture.host.id)
      ])
      assert.equal(clients[0], clients[1])
      assert.equal(fixture.connections.size, 1)
      await proxy.start()
      const auth = `Basic ${Buffer.from(`${proxy.username}:${proxy.password}`).toString('base64')}`
      assert.equal(
        (await request(proxy.port, `http://127.0.0.1:${port}/`)).status,
        407
      )
      assert.equal(
        (await request(proxy.port, 'http://example.com/', auth)).status,
        403
      )
      assert.deepEqual(
        await request(proxy.port, `http://127.0.0.1:${port}/`, auth),
        { status: 200, body: 'fixture-service' }
      )
      assert.equal(
        (await request(proxy.port, `http://127.0.0.1:${port}/redirect`, auth))
          .status,
        302
      )
      // WebSocket uses an HTTP proxy absolute-form request, as Chromium does.
      await new Promise<void>((resolve, reject) => {
        const socket = net.connect(proxy.port, '127.0.0.1')
        const client = new WebSocket(`ws://127.0.0.1:${port}/`, {
          createConnection: () => socket,
          headers: { 'Proxy-Authorization': auth },
          path: `http://127.0.0.1:${port}/`
        })
        client.on('open', () => client.send('hello-through-ssh'))
        client.on('message', (data) => {
          assert.equal(data.toString(), 'hello-through-ssh')
          client.close()
          resolve()
        })
        client.on('error', reject)
      })
      const service = new ServiceManager(fixture.ssh),
        app = remoteApp(fixture.host.id, port)
      assert.equal(await service.ensure(app, () => {}), '已连接现有服务')
      await assert.rejects(
        service.ensure(
          {
            ...app,
            expectedText: 'not-this-service',
            autoStart: true,
            startCommand: 'false'
          },
          () => {}
        ),
        /不会重复启动/
      )
      fixture.ssh.disconnect(fixture.host.id)
      await new Promise((resolve) => setTimeout(resolve, 100))
      assert.equal(fixture.ssh.states()[0].status, 'disconnected')
      assert.equal(fixture.connections.size, 0)
    } finally {
      proxy.close()
      ws.close()
      web.closeAllConnections()
      await new Promise<void>((resolve) => web.close(() => resolve()))
      await fixture.cleanup()
    }
  }
)
test(
  'SSH refuses changed host keys and supports a saved jump host',
  { timeout: 20000 },
  async () => {
    const fixture = await sshFixture(),
      target = await sshFixture()
    try {
      await fixture.ssh.connect(fixture.host.id)
      fixture.ssh.disconnect(fixture.host.id)
      await fixture.store.trust(
        `127.0.0.1:${fixture.host.port}`,
        'SHA256:wrong'
      )
      await assert.rejects(fixture.ssh.connect(fixture.host.id), /密钥已改变/)
      const jump = { ...target.host, jumpHostId: '' }
      await fixture.store.saveHost(jump)
      await fixture.store.saveHost({ ...fixture.host, jumpHostId: jump.id })
      // Restore the original pinned key via the fixture's independently generated key.
      await target.ssh.connect(target.host.id)
      const command = await target.ssh.exec(target.host.id, 'printf portico')
      assert.equal(command.stdout, 'portico')
      const second = {
        ...target.host,
        id: crypto.randomUUID(),
        jumpHostId: jump.id
      }
      await fixture.store.saveHost(second)
      assert.equal(
        (await fixture.ssh.exec(second.id, 'printf jumped')).stdout,
        'jumped'
      )
    } finally {
      await fixture.cleanup()
      await target.cleanup()
    }
  }
)

test(
  'CONNECT tunnels support Chromium WebSocket transport and reject unauthenticated callers',
  { timeout: 15000 },
  async () => {
    const fixture = await sshFixture()
    const echo = net.createServer((socket) => socket.pipe(socket))
    await new Promise<void>((resolve) => echo.listen(0, '127.0.0.1', resolve))
    const port = (echo.address() as AddressInfo).port
    const proxy = new ServiceProxy('127.0.0.1', port, 'http', () =>
      fixture.ssh.forward(fixture.host.id, '127.0.0.1', port)
    )
    try {
      await proxy.start()
      const auth = `Basic ${Buffer.from(`${proxy.username}:${proxy.password}`).toString('base64')}`
      const connect = (authorized: boolean): Promise<string> =>
        new Promise((resolve, reject) => {
          const socket = net.connect(proxy.port, '127.0.0.1')
          let data = '',
            sent = false
          socket.on('connect', () =>
            socket.write(
              `CONNECT 127.0.0.1:${port} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n${authorized ? `Proxy-Authorization: ${auth}\r\n` : ''}\r\n`
            )
          )
          socket.on('data', (chunk) => {
            data += chunk
            if (!authorized || data.includes('through-connect')) {
              socket.destroy()
              resolve(data)
            } else if (data.includes('\r\n\r\n') && !sent) {
              sent = true
              socket.write('through-connect')
            }
          })
          socket.on('error', reject)
          socket.setTimeout(5000, () =>
            socket.destroy(new Error('CONNECT timeout'))
          )
        })
      assert.match(await connect(false), /407/)
      assert.match(
        await connect(true),
        /200 Connection Established[\s\S]*through-connect/
      )
    } finally {
      proxy.close()
      await new Promise<void>((resolve) => echo.close(() => resolve()))
      await fixture.cleanup()
    }
  }
)

test(
  'connection loss reconnects once and explicit disconnect stops retrying',
  { timeout: 15000 },
  async () => {
    const fixture = await sshFixture()
    try {
      await fixture.ssh.connect(fixture.host.id)
      for (const client of fixture.connections) client.end()
      await new Promise((resolve) => setTimeout(resolve, 1800))
      assert.equal(fixture.ssh.states()[0].status, 'connected')
      assert.equal(fixture.connections.size, 1)
      fixture.ssh.disconnect(fixture.host.id)
      await new Promise((resolve) => setTimeout(resolve, 1300))
      assert.equal(fixture.ssh.states()[0].status, 'disconnected')
      assert.equal(fixture.connections.size, 0)
    } finally {
      await fixture.cleanup()
    }
  }
)
