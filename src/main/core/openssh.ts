import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdtemp, chmod, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Duplex } from 'node:stream'
import { createServer, type Socket } from 'node:net'
import { randomBytes } from 'node:crypto'

export interface SshPrompt {
  message: string
  hint: string
}
export interface OpenSshOptions {
  executable?: string
  configPath?: string // Internal test seam; production always reads the user's config.
  env?: NodeJS.ProcessEnv
  askpass?: {
    nodePath: string
    scriptPath: string
    prompt: (request: SshPrompt, signal: AbortSignal) => Promise<string | null>
  }
}

// Private Unix socket: no credentials in argv, files, logs or TCP listeners.
class AskpassBridge {
  private server = createServer((socket) => this.accept(socket))
  private sockets = new Set<Socket>()
  private token = randomBytes(32).toString('hex')
  constructor(
    private options: NonNullable<OpenSshOptions['askpass']>,
    private cancel: () => void
  ) {}
  private accept(socket: Socket): void {
    this.sockets.add(socket)
    const controller = new AbortController()
    socket.on('error', () => {})
    socket.on('close', () => {
      this.sockets.delete(socket)
      controller.abort()
    })
    let input = '',
      handled = false
    socket.setTimeout(180000, () => socket.destroy())
    socket.on('data', (data: Buffer) => {
      if (handled) return
      input += data.toString()
      if (input.length > 65536) {
        socket.destroy()
        return
      }
      if (!input.includes('\n')) return
      handled = true
      try {
        const request = JSON.parse(input.split('\n')[0])
        if (
          request.token !== this.token ||
          typeof request.message !== 'string' ||
          typeof request.hint !== 'string'
        ) {
          socket.destroy()
          return
        }
        void this.options
          .prompt(
            { message: request.message, hint: request.hint },
            controller.signal
          )
          .then((answer) => {
            if (answer === null && !controller.signal.aborted) {
              this.cancel()
              return
            }
            if (!socket.destroyed) socket.end(JSON.stringify({ answer }) + '\n')
          })
          .catch(() => socket.destroy())
      } catch {
        socket.destroy()
      }
    })
  }
  async start(directory: string): Promise<NodeJS.ProcessEnv> {
    const socket = join(directory, 'ask')
    this.server.on('error', () => {})
    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject)
      this.server.listen(socket, () => {
        this.server.removeListener('error', reject)
        resolve()
      })
    })
    const launcher = join(directory, 'askpass')
    await writeFile(
      launcher,
      '#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "$PORTICO_NODE" "$PORTICO_ASKPASS_SCRIPT" "$@"\n',
      { mode: 0o700 }
    )
    return {
      SSH_ASKPASS: launcher,
      SSH_ASKPASS_REQUIRE: 'force',
      DISPLAY: process.env.DISPLAY || 'portico',
      PORTICO_NODE: this.options.nodePath,
      PORTICO_ASKPASS_SCRIPT: this.options.scriptPath,
      PORTICO_ASKPASS_SOCKET: socket,
      PORTICO_ASKPASS_TOKEN: this.token
    }
  }
  close(): void {
    for (const socket of this.sockets) socket.destroy()
    this.server.close()
  }
}
function terminate(child: ChildProcessWithoutNullStreams): void {
  if (child.exitCode !== null || child.signalCode !== null) return
  const kill = (signal: NodeJS.Signals): void => {
    try {
      if (child.pid) process.kill(-child.pid, signal)
    } catch {
      child.kill(signal)
    }
  }
  kill('SIGTERM')
  const timer = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) kill('SIGKILL')
  }, 2000)
  timer.unref()
  child.once('exit', () => clearTimeout(timer))
}

/** A system OpenSSH master owns authentication and all user config semantics. */
export class OpenSshConnection extends EventEmitter {
  private directory = ''
  private socket = ''
  private master?: ChildProcessWithoutNullStreams
  private children = new Set<ChildProcessWithoutNullStreams>()
  private streams = new Set<Duplex>()
  private bridge?: AskpassBridge
  private stopped = false
  private ready = false
  private environment: NodeJS.ProcessEnv
  private startupError = ''
  constructor(
    readonly alias: string,
    private options: OpenSshOptions = {}
  ) {
    super()
    if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(alias))
      throw new Error('无效的 SSH Host 别名')
    this.environment = { ...process.env, ...options.env }
  }
  private spawn(args: string[]): ChildProcessWithoutNullStreams {
    const child = spawn(this.options.executable || '/usr/bin/ssh', args, {
      env: this.environment,
      stdio: 'pipe',
      detached: true
    })
    this.children.add(child)
    child.on('error', () => {})
    child.stdin.on('error', () => {})
    child.on('close', () => this.children.delete(child))
    return child
  }
  // Slaves use only our private master. If it disappears, fail rather than dialing a different route.
  private slaveArgs(): string[] {
    return [
      '-F',
      'none',
      '-S',
      this.socket,
      '-o',
      'ControlMaster=no',
      '-o',
      'ProxyCommand=false',
      '-o',
      'BatchMode=yes',
      '-T'
    ]
  }
  async connect(): Promise<void> {
    if (process.platform === 'win32')
      throw new Error('本机 SSH Config 连接目前需要 macOS 或 Linux 的 OpenSSH')
    try {
      this.directory = await mkdtemp(
        join(process.platform === 'darwin' ? '/tmp' : tmpdir(), 'portico-ssh-')
      )
      await chmod(this.directory, 0o700)
      this.socket = join(this.directory, 'ctl')
      if (this.options.askpass) {
        this.bridge = new AskpassBridge(this.options.askpass, () => {
          this.startupError = 'SSH 认证已取消'
          this.destroy()
        })
        Object.assign(this.environment, await this.bridge.start(this.directory))
      }
      if (this.stopped) throw new Error('连接已取消')
      const args = this.options.configPath
        ? ['-F', this.options.configPath]
        : []
      args.push(
        '-M',
        '-N',
        '-T',
        '-S',
        this.socket,
        '-o',
        'ControlMaster=yes',
        '-o',
        'ControlPersist=no',
        '-o',
        'ForkAfterAuthentication=no',
        '-o',
        'ClearAllForwardings=yes',
        '-o',
        'RemoteCommand=none',
        '--',
        this.alias
      )
      const child = (this.master = this.spawn(args))
      child.stdin.end()
      child.stdout.resume()
      child.stderr.on('data', (data: Buffer) => {
        this.startupError = (this.startupError + data.toString()).slice(-16384)
      })
      child.on('error', (error) => {
        this.startupError = error.message
      })
      child.once('close', () => {
        const wasReady = this.ready
        this.ready = false
        this.destroy()
        if (wasReady) this.emit('close')
      })
      const deadline = Date.now() + 180000
      while (!this.stopped && Date.now() < deadline) {
        if (
          await stat(this.socket).then(
            () => true,
            () => false
          )
        ) {
          const check = await this.run(['-O', 'check'], '', 3000)
          if (check.code === 0 && !this.stopped) {
            this.ready = true
            return
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      throw new Error(
        this.startupError.trim() ||
          (this.stopped ? 'SSH 连接已关闭或取消' : 'SSH 连接超时')
      )
    } catch (error) {
      this.destroy()
      throw error
    }
  }
  async forward(hostname: string, port: number): Promise<Duplex> {
    if (!this.ready || this.stopped) throw new Error('SSH 连接已关闭')
    if (
      !/^[a-zA-Z0-9_.:\-]+$/.test(hostname) ||
      !Number.isInteger(port) ||
      port < 1 ||
      port > 65535
    )
      throw new Error('无效的远端地址')
    const address = hostname.includes(':')
      ? `[${hostname}]:${port}`
      : `${hostname}:${port}`
    const child = this.spawn([
      ...this.slaveArgs(),
      '-v',
      '-W',
      address,
      '--',
      this.alias
    ])
    const stream = Duplex.from({
      writable: child.stdin,
      readable: child.stdout
    })
    this.streams.add(stream)
    stream.on('error', () => {})
    stream.once('close', () => {
      this.streams.delete(stream)
      terminate(child)
    })
    return new Promise((resolve, reject) => {
      let settled = false,
        stderr = ''
      const timer = setTimeout(() => fail(new Error('远端端口连接超时')), 12000)
      const fail = (error: Error): void => {
        clearTimeout(timer)
        if (!settled) {
          settled = true
          reject(error)
        }
        stream.destroy(error)
        terminate(child)
      }
      child.on('error', fail)
      child.stderr.on('data', (data: Buffer) => {
        stderr = (stderr + data.toString()).slice(-16384)
        // OpenSSH emits this only after MUX_S_SESSION_OPENED (remote TCP open confirmed).
        // Never treat merely spawning ssh or opening the control socket as a reachable service.
        if (
          !settled &&
          /mux_client_request_stdio_fwd: master session id: \d+/.test(stderr)
        ) {
          settled = true
          clearTimeout(timer)
          resolve(stream)
        }
      })
      child.once('close', (code) => {
        if (!settled || code) fail(new Error(stderr.trim() || 'SSH 转发已关闭'))
      })
    })
  }
  private run(
    args: string[],
    command: string,
    timeout: number
  ): Promise<{ stdout: string; stderr: string; code: number }> {
    const child = this.spawn([
      ...this.slaveArgs(),
      ...args,
      '--',
      this.alias,
      ...(command ? [command] : [])
    ])
    child.stdin.end()
    return new Promise((resolve, reject) => {
      let stdout = '',
        stderr = '',
        bytes = 0
      const fail = (error: Error): void => {
        clearTimeout(timer)
        terminate(child)
        reject(error)
      }
      const timer = setTimeout(
        () => fail(new Error('远程命令执行超时')),
        timeout
      )
      const collect = (data: Buffer, error: boolean): void => {
        bytes += data.length
        if (bytes > 2 * 1024 * 1024) {
          fail(new Error('命令输出超过 2 MB'))
          return
        }
        if (error) stderr += data.toString()
        else stdout += data.toString()
      }
      child.stdout.on('data', (data: Buffer) => collect(data, false))
      child.stderr.on('data', (data: Buffer) => collect(data, true))
      child.once('error', fail)
      child.once('close', (code) => {
        clearTimeout(timer)
        resolve({ stdout, stderr, code: code ?? -1 })
      })
    })
  }
  exec(
    command: string,
    timeout: number
  ): Promise<{ stdout: string; stderr: string; code: number }> {
    if (!this.ready || this.stopped)
      return Promise.reject(new Error('SSH 连接已关闭'))
    return this.run([], command, timeout)
  }
  end(): void {
    this.destroy()
  }
  destroy(): void {
    this.stopped = true
    this.ready = false
    this.bridge?.close()
    for (const stream of this.streams) stream.destroy()
    for (const child of this.children) terminate(child)
    if (this.directory) {
      const directory = this.directory
      this.directory = ''
      void rm(directory, { recursive: true, force: true }).catch(() => {})
    }
  }
}
