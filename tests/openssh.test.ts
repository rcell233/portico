import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFile, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createServer, type AddressInfo } from 'node:net'
import http from 'node:http'
import { once } from 'node:events'
import { sshFixture, remoteApp } from './fixtures'
import { SshManager } from '../src/main/core/ssh'
import {
  OpenSshConnection,
  type OpenSshOptions
} from '../src/main/core/openssh'
import { ServiceManager } from '../src/main/core/services'
import { ServiceProxy } from '../src/main/core/proxy'
import { shellQuote } from '../src/main/core/services'
import { WebSocket, WebSocketServer } from 'ws'

const native = { skip: process.platform === 'win32', timeout: 30000 }

test(
  'system SSH uses original ProxyCommand, askpass and known_hosts; forwards HTTP/WS and executes over one master',
  native,
  async () => {
    const fixture = await sshFixture()
    const configPath = join(fixture.directory, 'ssh_config')
    const marker = join(fixture.directory, 'proxy-invoked')
    const relay = join(fixture.directory, 'relay.cjs')
    await writeFile(
      relay,
      `const net = require('node:net'); require('node:fs').appendFileSync(${JSON.stringify(marker)}, 'called\\n'); const s = net.connect(${fixture.host.port}, '127.0.0.1'); process.stdin.pipe(s).pipe(process.stdout); s.on('error', () => process.exit(1)); s.on('close', () => process.exit());`
    )
    await writeFile(
      configPath,
      `Host native-fixture\n  HostName intentionally-unresolvable.invalid\n  User fixture\n  ProxyCommand ${shellQuote(process.execPath)} ${shellQuote(relay)}\n  UserKnownHostsFile ${fixture.directory}/known_hosts\n  StrictHostKeyChecking ask\n  PreferredAuthentications password\n  IdentityAgent none\n  RequestTTY force\n  RemoteCommand echo should-not-run\n  LocalForward 127.0.0.1:1 127.0.0.1:1\n`
    )
    const prompts: string[] = []
    const options: OpenSshOptions = {
      configPath,
      askpass: {
        nodePath: process.execPath,
        scriptPath: resolve('resources/ssh-askpass.cjs'),
        prompt: async (request) => {
          prompts.push(request.message)
          return /yes\/no/.test(request.message) ? 'yes' : 'test-secret'
        }
      }
    }
    const ssh = new SshManager(
      fixture.store,
      () => {},
      async () => {
        throw new Error('Must use system host verification')
      },
      () => options
    )
    await fixture.store.saveHost({
      ...fixture.host,
      sshAlias: 'native-fixture',
      hostname: 'wrong-snapshot.invalid',
      port: 1,
      username: 'wrong',
      secret: 'must-not-be-used'
    })
    const web = http.createServer((_req, res) => res.end('native-service'))
    const wss = new WebSocketServer({ server: web })
    wss.on('connection', (socket) =>
      socket.on('message', (data) => socket.send(data))
    )
    web.listen(0, '127.0.0.1')
    await once(web, 'listening')
    const port = (web.address() as AddressInfo).port
    const proxy = new ServiceProxy('127.0.0.1', port, 'http', () =>
      ssh.forward(fixture.host.id, '127.0.0.1', port)
    )
    try {
      const clients = await Promise.all([
        ssh.connect(fixture.host.id),
        ssh.connect(fixture.host.id)
      ])
      assert.equal(clients[0], clients[1])
      assert.equal(fixture.connections.size, 1)
      assert.equal(fixture.store.secret(fixture.host.id), undefined)
      assert.ok(prompts.some((p) => /yes\/no/.test(p)))
      assert.ok(prompts.some((p) => /password/i.test(p)))
      assert.match(
        await readFile(join(fixture.directory, 'known_hosts'), 'utf8'),
        /intentionally-unresolvable/
      )
      assert.deepEqual(
        await ssh.exec(
          fixture.host.id,
          'printf native-exec; printf native-error >&2; exit 7'
        ),
        { stdout: 'native-exec', stderr: 'native-error', code: 7 }
      )
      await proxy.start()
      const auth =
        'Basic ' +
        Buffer.from(`${proxy.username}:${proxy.password}`).toString('base64')
      const body = await new Promise<string>((resolve, reject) => {
        http
          .get(
            {
              host: '127.0.0.1',
              port: proxy.port,
              path: `http://127.0.0.1:${port}/`,
              headers: { 'Proxy-Authorization': auth }
            },
            (res) => {
              let body = ''
              res.on('data', (data) => {
                body += data
              })
              res.on('end', () => resolve(body))
            }
          )
          .on('error', reject)
      })
      assert.equal(body, 'native-service')
      const ws = new WebSocket(`ws://127.0.0.1:${proxy.port}/`, {
        headers: { Host: `127.0.0.1:${port}`, 'Proxy-Authorization': auth }
      })
      await once(ws, 'open')
      ws.send('native-ws')
      assert.equal(String((await once(ws, 'message'))[0]), 'native-ws')
      ws.close()
      await once(ws, 'close')
      const services = new ServiceManager(ssh)
      assert.equal(
        await services.ensure(remoteApp(fixture.host.id, port), () => {}),
        '已连接现有服务'
      )
      const closed = createServer()
      closed.listen(0, '127.0.0.1')
      await once(closed, 'listening')
      const closedPort = (closed.address() as AddressInfo).port
      await new Promise<void>((resolve) => closed.close(() => resolve()))
      await assert.rejects(
        ssh.forward(fixture.host.id, '127.0.0.1', closedPort)
      )
      await assert.rejects(ssh.exec(fixture.host.id, 'sleep 5', 50), /超时/)
      assert.equal((await readFile(marker, 'utf8')).trim(), 'called')
      ssh.disconnect(fixture.host.id)
      assert.equal(ssh.states()[0].status, 'disconnected')
      let cancellations = 0
      const cancelled = new OpenSshConnection('native-fixture', {
        ...options,
        askpass: {
          ...options.askpass!,
          prompt: async () => {
            cancellations++
            return null
          }
        }
      })
      try {
        await assert.rejects(cancelled.connect(), /取消/)
        assert.equal(cancellations, 1)
      } finally {
        cancelled.destroy()
      }
    } finally {
      proxy.close()
      ssh.close()
      wss.close()
      await new Promise<void>((resolve) => web.close(() => resolve()))
      await fixture.cleanup()
    }
  }
)

test(
  'system SSH follows ProxyJump with independent authentication and observes config edits on reconnect',
  native,
  async () => {
    const jump = await sshFixture(),
      target = await sshFixture()
    const configPath = join(target.directory, 'ssh_config')
    const config = (username: string): string =>
      `Host target\n  HostName 127.0.0.1\n  Port ${target.host.port}\n  User ${username}\n  ProxyJump jump\nHost jump\n  HostName 127.0.0.1\n  Port ${jump.host.port}\n  User fixture\nHost *\n  UserKnownHostsFile ${target.directory}/known_hosts\n  StrictHostKeyChecking ask\n  PreferredAuthentications password\n  IdentityAgent none\n`
    await writeFile(configPath, config('fixture'))
    const options: OpenSshOptions = {
      configPath,
      askpass: {
        nodePath: process.execPath,
        scriptPath: resolve('resources/ssh-askpass.cjs'),
        prompt: async (request) =>
          /yes\/no/.test(request.message) ? 'yes' : 'test-secret'
      }
    }
    const client = new OpenSshConnection('target', options)
    let next: OpenSshConnection | undefined
    try {
      await client.connect()
      assert.equal((await client.exec('printf jumped', 3000)).stdout, 'jumped')
      assert.equal(jump.connections.size, 1)
      assert.equal(target.connections.size, 1)
      client.end()
      await writeFile(configPath, config('wrong-user'))
      next = new OpenSshConnection('target', options)
      await assert.rejects(next.connect(), /Permission denied/)
    } finally {
      client.destroy()
      next?.destroy()
      await jump.cleanup()
      await target.cleanup()
    }
  }
)

test(
  'cancelling a system SSH authentication closes the pending prompt and connection',
  native,
  async () => {
    const fixture = await sshFixture()
    const configPath = join(fixture.directory, 'config')
    await writeFile(
      configPath,
      `Host cancel\n HostName 127.0.0.1\n Port ${fixture.host.port}\n User fixture\n UserKnownHostsFile ${fixture.directory}/known_hosts\n StrictHostKeyChecking ask\n`
    )
    let prompted!: () => void
    const waiting = new Promise<void>((resolve) => {
      prompted = resolve
    })
    let aborted = false
    const client = new OpenSshConnection('cancel', {
      configPath,
      askpass: {
        nodePath: process.execPath,
        scriptPath: resolve('resources/ssh-askpass.cjs'),
        prompt: async (_request, signal) => {
          prompted()
          return new Promise((resolve) =>
            signal.addEventListener(
              'abort',
              () => {
                aborted = true
                resolve(null)
              },
              { once: true }
            )
          )
        }
      }
    })
    try {
      const connecting = client.connect()
      const rejected = assert.rejects(connecting, /关闭|取消/)
      await waiting
      client.destroy()
      await rejected
      await new Promise((resolve) => setTimeout(resolve, 50))
      assert.equal(aborted, true)
    } finally {
      client.destroy()
      await fixture.cleanup()
    }
  }
)
