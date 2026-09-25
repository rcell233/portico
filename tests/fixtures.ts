import { Server, type Connection } from 'ssh2'
import {
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  createCipheriv,
  createDecipheriv
} from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import net from 'node:net'
import { spawn } from 'node:child_process'
import type { AddressInfo } from 'node:net'
import { Store } from '../src/main/core/store'
import { SshManager } from '../src/main/core/ssh'
import type { HostInput, RemoteApp } from '../src/shared/api'

export const key = randomBytes(32)
export const cipher = {
  encrypt: (value: string): string => {
    const iv = randomBytes(12),
      c = createCipheriv('aes-256-gcm', key, iv)
    const data = Buffer.concat([c.update(value), c.final()])
    return Buffer.concat([iv, c.getAuthTag(), data]).toString('base64')
  },
  decrypt: (value: string): string => {
    const bytes = Buffer.from(value, 'base64'),
      c = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12))
    c.setAuthTag(bytes.subarray(12, 28))
    return Buffer.concat([c.update(bytes.subarray(28)), c.final()]).toString()
  }
}
export function host(port = 22): HostInput {
  return {
    id: randomUUID(),
    name: 'Fixture host',
    hostname: '127.0.0.1',
    port,
    username: 'fixture',
    auth: 'password',
    secret: 'test-secret',
    privateKeyPath: '',
    jumpHostId: ''
  }
}
export function remoteApp(hostId: string, port: number): RemoteApp {
  return {
    id: randomUUID(),
    hostId,
    name: 'Fixture app',
    hostname: '127.0.0.1',
    port,
    protocol: 'http',
    path: '/',
    healthPath: '/',
    expectedText: '',
    startCommand: '',
    workingDirectory: '~',
    environment: {},
    readyTimeout: 10,
    autoStart: false
  }
}
export async function sshFixture(): Promise<{
  store: Store
  ssh: SshManager
  host: HostInput
  directory: string
  server: Server
  connections: Set<Connection>
  cleanup: () => Promise<void>
}> {
  const directory = await mkdtemp(join(tmpdir(), 'portico-test-'))
  const store = new Store(directory, cipher)
  await store.load()
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const connections = new Set<Connection>()
  const server = new Server(
    { hostKeys: [privateKey.export({ format: 'pem', type: 'pkcs1' })] },
    (client) => {
      connections.add(client)
      client.on('close', () => connections.delete(client))
      client.on('error', () => {})
      client.on('authentication', (ctx) => {
        if (
          ctx.method === 'password' &&
          ctx.username === 'fixture' &&
          ctx.password === 'test-secret'
        )
          ctx.accept()
        else ctx.reject()
      })
      client.on('ready', () => {
        client.on('tcpip', (accept, reject, info) => {
          if (info.destIP !== '127.0.0.1') {
            reject()
            return
          }
          const socket = net.connect(info.destPort, info.destIP)
          socket.once('error', () => reject())
          socket.once('connect', () => {
            const channel = accept()
            channel.on('error', () => socket.destroy())
            socket.on('error', () => channel.destroy())
            channel.on('close', () => socket.destroy())
            socket.pipe(channel).pipe(socket)
          })
        })
        client.on('session', (accept) => {
          const session = accept()
          session.on('exec', (accept, _reject, info) => {
            const stream = accept()
            const child = spawn('/bin/sh', ['-c', info.command], {
              env: { ...process.env, HOME: directory },
              cwd: directory
            })
            child.stdout.pipe(stream, { end: false })
            child.stderr.pipe(stream.stderr, { end: false })
            child.on('close', (code) => {
              stream.exit(code || 0)
              stream.end()
            })
            stream.on('close', () => child.kill())
          })
        })
      })
    }
  )
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const h = host((server.address() as AddressInfo).port)
  await store.saveHost(h)
  const ssh = new SshManager(
    store,
    () => {},
    async () => true
  )
  return {
    store,
    ssh,
    host: h,
    directory,
    server,
    connections,
    cleanup: async () => {
      ssh.close()
      for (const c of connections) c.end()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await rm(directory, { recursive: true, force: true })
    }
  }
}
