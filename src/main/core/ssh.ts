import { Client, type ClientChannel, type ConnectConfig } from 'ssh2'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { createHash } from 'node:crypto'
import type { Connection, Host } from '../../shared/api'
import { Store } from './store'
import type { Duplex } from 'node:stream'
import { OpenSshConnection, type OpenSshOptions } from './openssh'

type Transport = Client | OpenSshConnection

type Entry = {
  client?: Transport
  dialing?: Transport
  pending?: Promise<Transport>
  wanted: boolean
  timer?: NodeJS.Timeout
  attempt: number
  status: Connection
}
export class SshManager {
  private entries = new Map<string, Entry>()
  constructor(
    private store: Store,
    private changed: () => void,
    private trust: (host: Host, fingerprint: string) => Promise<boolean>,
    private nativeOptions: (host: Host) => OpenSshOptions = () => ({})
  ) {}
  states(): Connection[] {
    return this.store.hosts().map(
      (h) =>
        this.entries.get(h.id)?.status ?? {
          hostId: h.id,
          status: 'disconnected',
          message: ''
        }
    )
  }
  private entry(id: string): Entry {
    let entry = this.entries.get(id)
    if (!entry) {
      entry = {
        wanted: false,
        attempt: 0,
        status: { hostId: id, status: 'disconnected', message: '' }
      }
      this.entries.set(id, entry)
    }
    return entry
  }
  async connect(id: string): Promise<Transport> {
    const entry = this.entry(id)
    entry.wanted = true
    if (entry.client) return entry.client
    if (entry.pending) return entry.pending
    clearTimeout(entry.timer)
    entry.pending = this.establish(id, entry).finally(() => {
      entry.pending = undefined
    })
    return entry.pending
  }
  private async establish(id: string, entry: Entry): Promise<Transport> {
    const host = this.store.host(id)
    entry.status = {
      hostId: id,
      status: entry.attempt ? 'reconnecting' : 'connecting',
      message: ''
    }
    this.changed()
    let connection: Transport | undefined
    try {
      if (host.sshAlias) {
        const native = new OpenSshConnection(
          host.sshAlias,
          this.nativeOptions(host)
        )
        connection = native
        entry.dialing = native
        await native.connect()
      } else {
        const secret = this.store.secret(id)
        const config: ConnectConfig = {
          host: host.hostname,
          port: host.port,
          username: host.username,
          readyTimeout: 30000,
          keepaliveInterval: 15000,
          keepaliveCountMax: 3,
          hostVerifier: (key: Buffer, callback: (valid: boolean) => void) => {
            const fingerprint = `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`
            const identity = `${host.hostname}:${host.port}`
            const previous = this.store.fingerprint(identity)
            if (previous) {
              if (previous !== fingerprint)
                entry.status.message =
                  '主机密钥已改变，连接被拒绝。请通过独立渠道核实服务器。'
              callback(previous === fingerprint)
              return
            }
            void this.trust(host, fingerprint)
              .then(async (accepted) => {
                if (accepted) await this.store.trust(identity, fingerprint)
                callback(accepted)
              })
              .catch(() => callback(false))
          }
        }
        if (host.auth === 'password') {
          if (!secret) throw new Error('请编辑主机并填写 SSH 密码')
          config.password = secret
        }
        if (host.auth === 'key') {
          if (!host.privateKeyPath) throw new Error('请选择 SSH 私钥文件')
          config.privateKey = await readFile(
            host.privateKeyPath.replace(/^~(?=\/)/, homedir())
          )
          if (secret) config.passphrase = secret
        }
        if (host.auth === 'agent') {
          const agent =
            process.env.SSH_AUTH_SOCK ||
            (process.platform === 'win32'
              ? String.raw`\\.\pipe\openssh-ssh-agent`
              : undefined)
          if (!agent)
            throw new Error('没有可用的 SSH agent；请添加密钥或改用私钥文件')
          config.agent = agent
        }
        if (host.jumpHostId)
          config.sock = await this.forward(
            host.jumpHostId,
            host.hostname,
            host.port
          )
        if (!entry.wanted) throw new Error('连接已取消')
        connection = new Client()
        entry.dialing = connection
        const client = connection
        await new Promise<void>((resolve, reject) => {
          const error = (err: Error): void => reject(err)
          client.once('error', error)
          client.once('close', () => reject(new Error('SSH 连接已关闭')))
          client.once('ready', () => {
            client.removeListener('error', error)
            resolve()
          })
          client.on('error', () => {})
          client.connect(config)
        })
      }
      const client = connection!
      if (!entry.wanted) {
        client.end()
        throw new Error('连接已取消')
      }
      entry.dialing = undefined
      entry.client = client
      entry.attempt = 0
      entry.status = { hostId: id, status: 'connected', message: '' }
      this.changed()
      client.on('close', () => {
        if (entry.client !== client) return
        entry.client = undefined
        entry.status = {
          hostId: id,
          status: entry.wanted ? 'reconnecting' : 'disconnected',
          message: entry.wanted ? '连接中断，正在重连…' : ''
        }
        this.changed()
        if (entry.wanted) this.retry(id, entry)
      })
      return client
    } catch (error) {
      entry.dialing = undefined
      connection?.destroy()
      const message =
        entry.status.message ||
        (error instanceof Error ? error.message : String(error))
      entry.status = {
        hostId: id,
        status: entry.wanted ? 'error' : 'disconnected',
        message
      }
      this.changed()
      // Initial authentication/host-key failures require user intervention; only established connections auto-retry.
      if (
        entry.wanted &&
        entry.attempt > 0 &&
        !/密钥已改变|verification failed|authentication/i.test(message)
      )
        this.retry(id, entry)
      throw new Error(message)
    }
  }
  private retry(id: string, entry: Entry): void {
    clearTimeout(entry.timer)
    const delay = Math.min(30000, 1000 * 2 ** Math.min(entry.attempt++, 5))
    entry.timer = setTimeout(() => {
      if (entry.wanted) void this.connect(id).catch(() => {})
    }, delay)
  }
  disconnect(id: string): void {
    for (const child of this.store.hosts().filter((h) => h.jumpHostId === id))
      this.disconnect(child.id)
    const entry = this.entry(id)
    entry.wanted = false
    entry.dialing?.destroy()
    clearTimeout(entry.timer)
    const client = entry.client
    entry.client = undefined
    client?.end()
    entry.attempt = 0
    entry.status = { hostId: id, status: 'disconnected', message: '' }
    this.changed()
  }
  close(): void {
    for (const id of this.entries.keys()) this.disconnect(id)
  }
  async forward(id: string, hostname: string, port: number): Promise<Duplex> {
    const client = await this.connect(id)
    if (client instanceof OpenSshConnection)
      return client.forward(hostname, port)
    return new Promise((resolve, reject) => {
      let expired = false
      const timer = setTimeout(() => {
        expired = true
        reject(new Error('远端端口连接超时'))
      }, 12000)
      client.forwardOut('127.0.0.1', 0, hostname, port, (error, channel) => {
        clearTimeout(timer)
        if (expired) {
          channel?.destroy()
          return
        }
        if (error) reject(error)
        else {
          channel.on('error', () => {})
          resolve(channel)
        }
      })
    })
  }
  async exec(
    id: string,
    command: string,
    timeout = 20000
  ): Promise<{ stdout: string; stderr: string; code: number }> {
    const client = await this.connect(id)
    if (client instanceof OpenSshConnection)
      return client.exec(command, timeout)
    return new Promise((resolve, reject) => {
      let stream: ClientChannel | undefined
      const timer = setTimeout(() => {
        stream?.close()
        reject(new Error('远程命令执行超时'))
      }, timeout)
      client.exec(command, (error, channel) => {
        if (error) {
          clearTimeout(timer)
          reject(error)
          return
        }
        stream = channel
        let stdout = '',
          stderr = '',
          size = 0
        const collect = (data: Buffer, isError: boolean): void => {
          size += data.length
          if (size > 2 * 1024 * 1024) {
            channel.close()
            clearTimeout(timer)
            reject(new Error('命令输出超过 2 MB'))
            return
          }
          if (isError) stderr += data.toString()
          else stdout += data.toString()
        }
        channel.on('data', (data: Buffer) => collect(data, false))
        channel.stderr.on('data', (data: Buffer) => collect(data, true))
        channel.on('error', (error: Error) => {
          clearTimeout(timer)
          reject(error)
        })
        channel.on('close', (code: number) => {
          clearTimeout(timer)
          resolve({ stdout, stderr, code: code ?? -1 })
        })
      })
    })
  }
}
