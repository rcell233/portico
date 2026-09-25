import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { appSchema, hostSchema } from './schema'
import { pageName } from '../../shared/app-name'
import type { Host, HostInput, RemoteApp } from '../../shared/api'

export interface Cipher {
  encrypt(value: string): string
  decrypt(value: string): string
}
interface Data {
  version: 1
  hosts: Host[]
  apps: RemoteApp[]
  secrets: Record<string, string>
  fingerprints: Record<string, string>
}
const dataSchema = z.object({
  version: z.literal(1),
  hosts: z.array(
    hostSchema.omit({ secret: true }).extend({ hasSecret: z.boolean() })
  ),
  apps: z.array(appSchema),
  secrets: z.record(z.string(), z.string()),
  fingerprints: z.record(z.string(), z.string())
})
export class Store {
  private data: Data = {
    version: 1,
    hosts: [],
    apps: [],
    secrets: {},
    fingerprints: {}
  }
  private queue: Promise<unknown> = Promise.resolve()
  constructor(
    private directory: string,
    private cipher: Cipher
  ) {}
  async load(): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    try {
      this.data = dataSchema.parse(
        JSON.parse(
          this.cipher.decrypt(
            await readFile(join(this.directory, 'workspace.enc'), 'utf8')
          )
        )
      )
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw new Error(
          `无法解密或读取工作空间；原文件已保留。${String(error)}`
        )
    }
  }
  hosts(): Host[] {
    return structuredClone(this.data.hosts)
  }
  apps(): RemoteApp[] {
    return structuredClone(this.data.apps)
  }
  host(id: string): Host {
    const h = this.data.hosts.find((h) => h.id === id)
    if (!h) throw new Error('主机不存在')
    return structuredClone(h)
  }
  app(id: string): RemoteApp {
    const a = this.data.apps.find((a) => a.id === id)
    if (!a) throw new Error('应用不存在')
    return structuredClone(a)
  }
  secret(id: string): string | undefined {
    return this.data.secrets[id]
  }
  fingerprint(key: string): string | undefined {
    return this.data.fingerprints[key]
  }
  private mutate(change: (next: Data) => void): Promise<void> {
    const operation = this.queue.then(async () => {
      const next = structuredClone(this.data)
      change(next)
      const encoded = this.cipher.encrypt(JSON.stringify(next))
      const path = join(this.directory, 'workspace.enc')
      await writeFile(`${path}.tmp`, encoded, { mode: 0o600 })
      await rename(`${path}.tmp`, path)
      this.data = next
    })
    this.queue = operation.catch(() => {})
    return operation
  }
  trust(key: string, fingerprint: string): Promise<void> {
    return this.mutate((d) => {
      d.fingerprints[key] = fingerprint
    })
  }
  saveHost(input: HostInput): Promise<void> {
    const value = hostSchema.parse(input)
    return this.mutate((d) => {
      if (value.sshAlias) {
        value.jumpHostId = ''
        value.privateKeyPath = ''
        value.auth = 'agent'
        value.secret = ''
      }
      let parent = value.jumpHostId
      const visited = new Set([value.id])
      while (parent) {
        if (visited.has(parent)) throw new Error('跳板机配置形成循环')
        visited.add(parent)
        const h = d.hosts.find((h) => h.id === parent)
        if (!h) throw new Error('跳板机不存在')
        parent = h.jumpHostId
      }
      const old = d.hosts.find((h) => h.id === value.id)
      if (old && old.auth !== value.auth) delete d.secrets[value.id]
      if (value.secret !== undefined) {
        if (value.secret) d.secrets[value.id] = value.secret
        else delete d.secrets[value.id]
      }
      const { secret: _secret, ...fields } = value
      const host = { ...fields, hasSecret: Boolean(d.secrets[value.id]) }
      d.hosts = [...d.hosts.filter((h) => h.id !== host.id), host]
    })
  }
  deleteHost(id: string): Promise<void> {
    return this.mutate((d) => {
      if (d.apps.some((a) => a.hostId === id))
        throw new Error('请先删除此主机下的应用')
      if (d.hosts.some((h) => h.jumpHostId === id))
        throw new Error('此主机仍被用作跳板机')
      d.hosts = d.hosts.filter((h) => h.id !== id)
      delete d.secrets[id]
    })
  }
  saveApp(input: RemoteApp): Promise<void> {
    const app = appSchema.parse(input)
    return this.mutate((d) => {
      if (!d.hosts.some((h) => h.id === app.hostId))
        throw new Error('主机不存在')
      d.apps = [...d.apps.filter((a) => a.id !== app.id), app]
    })
  }
  nameAppFromPage(opened: RemoteApp, title: string): Promise<void> {
    const name = pageName(title)
    if (!name) return Promise.resolve()
    return this.mutate((d) => {
      const saved = d.apps.find((a) => a.id === opened.id)
      // A delayed page event must not overwrite a user name or an edited target.
      if (
        !saved ||
        saved.name ||
        saved.hostId !== opened.hostId ||
        saved.hostname !== opened.hostname ||
        saved.port !== opened.port ||
        saved.protocol !== opened.protocol ||
        saved.path !== opened.path
      )
        return
      saved.name = name
    })
  }
  deleteApp(id: string): Promise<void> {
    return this.mutate((d) => {
      d.apps = d.apps.filter((a) => a.id !== id)
    })
  }
}
