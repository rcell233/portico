import { test } from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  ServiceManager,
  serviceCommand,
  shellQuote
} from '../src/main/core/services'
import { remoteApp, sshFixture } from './fixtures'

test('shell quoting does not interpolate commands or apostrophes', async () => {
  const fixture = await sshFixture()
  try {
    const value = "hello ' $(echo injected) `uname`"
    assert.equal(
      (
        await fixture.ssh.exec(
          fixture.host.id,
          `printf %s ${shellQuote(value)}`
        )
      ).stdout,
      value
    )
  } finally {
    await fixture.cleanup()
  }
})
test(
  'managed service starts once, survives SSH disconnect, stops only owned processes',
  { skip: process.platform !== 'linux', timeout: 45000 },
  async () => {
    const fixture = await sshFixture()
    const reservation = net.createServer()
    await new Promise<void>((resolve) =>
      reservation.listen(0, '127.0.0.1', resolve)
    )
    const port = (reservation.address() as net.AddressInfo).port
    await new Promise<void>((resolve) => reservation.close(() => resolve()))
    const app = {
      ...remoteApp(fixture.host.id, port),
      autoStart: true,
      startCommand: `exec python3 -u -m http.server ${port} --bind 127.0.0.1`,
      workingDirectory: fixture.directory
    }
    const manager = new ServiceManager(fixture.ssh)
    let pid: number | undefined
    try {
      const messages = await Promise.all([
        manager.ensure(app, () => {}),
        manager.ensure(app, () => {})
      ])
      assert.equal(messages[0], messages[1])
      const statePath = join(
        fixture.directory,
        '.local/share/portico/services',
        app.id,
        'state.json'
      )
      const state = JSON.parse(await readFile(statePath, 'utf8'))
      pid = state.pid
      const again = await fixture.ssh.exec(
        app.hostId,
        serviceCommand(app, 'start')
      )
      assert.equal(JSON.parse(again.stdout).pid, pid)
      fixture.ssh.disconnect(app.hostId)
      await new Promise((resolve) => setTimeout(resolve, 200))
      process.kill(pid!, 0)
      assert.equal(await manager.ensure(app, () => {}), '已连接现有服务')
      assert.match(await manager.logs(app), /Serving HTTP/)
      await manager.stop(app)
      await assert.rejects(manager.stop(app), /没有可安全停止/)
    } finally {
      if (pid) {
        try {
          process.kill(-pid, 'SIGTERM')
        } catch {}
      }
      await fixture.cleanup()
    }
  }
)
