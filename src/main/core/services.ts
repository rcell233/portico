import http from 'node:http'
import https from 'node:https'
import tls from 'node:tls'
import { isIP, type Socket } from 'node:net'
import { remoteRunner } from './remote-runner'
import { SshManager } from './ssh'
import type { RemoteApp } from '../../shared/api'

export function shellQuote(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'"
}
export function serviceCommand(
  app: RemoteApp,
  action: 'start' | 'stop' | 'logs'
): string {
  const payload = Buffer.from(JSON.stringify({ ...app, action })).toString(
    'base64'
  )
  return `python3 -c ${shellQuote(remoteRunner)} ${shellQuote(payload)}`
}
export class ServiceManager {
  private starts = new Map<
    string,
    { promise: Promise<string>; controller: AbortController }
  >()
  constructor(private ssh: SshManager) {}
  ensure(app: RemoteApp, progress: (message: string) => void): Promise<string> {
    const current = this.starts.get(app.id)
    if (current) {
      if (current.controller.signal.aborted)
        return current.promise
          .catch(() => '')
          .then(() => this.ensure(app, progress))
      return current.promise
    }
    const controller = new AbortController()
    const promise = this.prepare(app, progress, controller.signal).finally(
      () => {
        if (this.starts.get(app.id)?.promise === promise)
          this.starts.delete(app.id)
      }
    )
    this.starts.set(app.id, { promise, controller })
    return promise
  }
  cancel(id: string): void {
    this.starts.get(id)?.controller.abort(new Error('打开已取消'))
  }
  private async probe(
    app: RemoteApp
  ): Promise<{ reachable: boolean; ready: boolean; error?: string }> {
    let channel
    try {
      channel = await this.ssh.forward(app.hostId, app.hostname, app.port)
    } catch {
      return { reachable: false, ready: false }
    }
    return new Promise((resolve) => {
      const secure = app.protocol === 'https'
      const agent = secure
        ? new https.Agent({ keepAlive: false })
        : new http.Agent({ keepAlive: false })
      agent.createConnection = () =>
        secure
          ? tls.connect({
              socket: channel,
              servername: isIP(app.hostname) ? undefined : app.hostname,
              rejectUnauthorized: true
            })
          : (channel as unknown as Socket)
      let settled = false
      const finish = (ready: boolean, error?: string): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        agent.destroy()
        channel.destroy()
        resolve({ reachable: true, ready, error })
      }
      const request = (secure ? https : http).request(
        {
          hostname: app.hostname,
          port: app.port,
          method: 'GET',
          path: app.healthPath,
          agent
        },
        (response) => {
          let body = '',
            bytes = 0
          response.on('data', (chunk: Buffer) => {
            bytes += chunk.length
            if (bytes <= 256 * 1024) body += chunk.toString()
            if (bytes > 256 * 1024) {
              request.destroy()
              finish(false, '健康检查响应超过 256 KB')
            }
          })
          response.on('end', () => {
            const status = response.statusCode || 500
            finish(
              status >= 200 &&
                status < 500 &&
                (!app.expectedText || body.includes(app.expectedText)),
              `HTTP ${status} 或响应内容不匹配`
            )
          })
          response.on('error', (error) => finish(false, error.message))
        }
      )
      const timer = setTimeout(() => {
        request.destroy()
        finish(false, '健康检查超时')
      }, 5000)
      request.on('error', (error) => finish(false, error.message))
      request.end()
    })
  }
  private async prepare(
    app: RemoteApp,
    progress: (message: string) => void,
    signal: AbortSignal
  ): Promise<string> {
    progress('正在连接主机…')
    await this.ssh.connect(app.hostId)
    signal.throwIfAborted()
    progress('正在检查远端服务…')
    const initial = await this.probe(app)
    signal.throwIfAborted()
    if (initial.ready) return '已连接现有服务'
    if (initial.reachable)
      throw new Error(
        `端口已有服务但健康检查未通过，不会重复启动。${initial.error || ''}`
      )
    if (!app.autoStart)
      throw new Error(
        '服务未运行。请启动远端服务，或在应用设置中启用按需启动。'
      )
    progress('正在后台启动服务…')
    const result = await this.ssh.exec(app.hostId, serviceCommand(app, 'start'))
    signal.throwIfAborted()
    if (result.code !== 0)
      throw new Error(
        `启动失败（托管启动需要远端 Linux 和 Python 3）：${result.stderr.slice(-1500)}`
      )
    const state = JSON.parse(result.stdout) as { status: string }
    progress(
      state.status === 'existing'
        ? '端口已由其他服务占用，正在检查…'
        : '等待服务就绪…'
    )
    const deadline = Date.now() + app.readyTimeout * 1000
    while (Date.now() < deadline) {
      signal.throwIfAborted()
      const check = await this.probe(app)
      signal.throwIfAborted()
      if (check.ready)
        return state.status === 'existing'
          ? '已连接现有服务'
          : '服务已就绪 · 关闭页面后继续运行'
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
    throw new Error(
      `服务未在 ${app.readyTimeout} 秒内就绪。进程可能仍在启动，请查看日志后重试。`
    )
  }
  async logs(app: RemoteApp): Promise<string> {
    const result = await this.ssh.exec(app.hostId, serviceCommand(app, 'logs'))
    if (result.code !== 0) throw new Error(result.stderr || '读取日志失败')
    return result.stdout
  }
  async stop(app: RemoteApp): Promise<void> {
    const start = this.starts.get(app.id)
    if (start) {
      start.controller.abort(new Error('启动等待已取消'))
      await start.promise.catch(() => {})
    }
    const result = await this.ssh.exec(app.hostId, serviceCommand(app, 'stop'))
    if (result.code !== 0) throw new Error(result.stderr || '停止失败')
    const state = JSON.parse(result.stdout) as {
      status: string
      message?: string
    }
    if (state.status !== 'stopped')
      throw new Error(state.message || '没有可安全停止的托管进程')
  }
}
