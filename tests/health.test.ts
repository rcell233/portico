import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { ServiceManager } from '../src/main/core/services'
import { remoteApp, sshFixture } from './fixtures'

test(
  'health checks accept large pages and stream expected text through SSH',
  { timeout: 20000 },
  async () => {
    const fixture = await sshFixture()
    const server = http.createServer((req, res) => {
      if (req.url === '/error') {
        res.writeHead(503)
        res.end('not ready')
      } else if (req.url === '/headers-only') {
        res.writeHead(200)
        res.flushHeaders() // Deliberately never finish the body.
      } else {
        res.write('x'.repeat(512 * 1024))
        const marker = Buffer.from('服务已就绪')
        res.write(marker.subarray(0, 4))
        setTimeout(() => res.end(marker.subarray(4)), 20)
      }
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const app = remoteApp(
      fixture.host.id,
      (server.address() as AddressInfo).port
    )
    const manager = new ServiceManager(fixture.ssh)
    try {
      assert.equal(await manager.ensure(app, () => {}), '已连接现有服务')
      assert.equal(
        await manager.ensure({ ...app, healthPath: '/headers-only' }, () => {}),
        '已连接现有服务'
      )
      assert.equal(
        await manager.ensure({ ...app, expectedText: '服务已就绪' }, () => {}),
        '已连接现有服务'
      )
      await assert.rejects(
        manager.ensure({ ...app, expectedText: 'missing' }, () => {}),
        /响应未包含/
      )
      await assert.rejects(
        manager.ensure(
          { ...app, healthPath: '/error', autoStart: true },
          () => {}
        ),
        /端口已有服务.*HTTP 503/
      )
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await fixture.cleanup()
    }
  }
)
