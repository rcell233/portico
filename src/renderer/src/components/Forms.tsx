import { useState, type FormEvent, type ReactNode } from 'react'
import { FolderKey, Info } from 'lucide-react'
import type { Host, HostInput, RemoteApp } from '../../../shared/api'

export function Field({
  label,
  children,
  hint
}: {
  label: string
  children: ReactNode
  hint?: string
}): React.JSX.Element {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  )
}
export function HostForm({
  host,
  hosts,
  save,
  cancel
}: {
  host?: Host
  hosts: Host[]
  save: (value: HostInput) => Promise<void>
  cancel: () => void
}): React.JSX.Element {
  const [value, set] = useState<HostInput>(
    host
      ? { ...host }
      : {
          id: crypto.randomUUID(),
          name: '',
          hostname: '',
          port: 22,
          username: '',
          auth: 'agent',
          privateKeyPath: '',
          jumpHostId: ''
        }
  )
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const update = (patch: Partial<HostInput>): void =>
    set((v) => ({ ...v, ...patch }))
  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await save(value)
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <form onSubmit={(event) => void submit(event)}>
      <div className="form-grid">
        <Field label="主机名称">
          <input
            autoFocus
            required
            placeholder="例如：GPU 工作站"
            value={value.name}
            onChange={(e) => update({ name: e.target.value })}
          />
        </Field>
        <Field label="SSH 地址">
          <input
            required
            placeholder="192.168.1.100 或 server.example.com"
            value={value.hostname}
            onChange={(e) => update({ hostname: e.target.value })}
          />
        </Field>
        <Field label="用户名">
          <input
            required
            placeholder="ubuntu"
            value={value.username}
            onChange={(e) => update({ username: e.target.value })}
          />
        </Field>
        <Field label="SSH 端口">
          <input
            type="number"
            required
            min="1"
            max="65535"
            value={value.port}
            onChange={(e) => update({ port: Number(e.target.value) })}
          />
        </Field>
        <Field label="认证方式">
          <select
            value={value.auth}
            onChange={(e) =>
              update({
                auth: e.target.value as HostInput['auth'],
                secret: undefined
              })
            }
          >
            <option value="agent">SSH agent</option>
            <option value="key">私钥文件</option>
            <option value="password">密码</option>
          </select>
        </Field>
        <Field label="跳板主机">
          <select
            value={value.jumpHostId}
            onChange={(e) => update({ jumpHostId: e.target.value })}
          >
            <option value="">直接连接</option>
            {hosts
              .filter((h) => h.id !== value.id)
              .map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
          </select>
        </Field>
      </div>
      {value.auth === 'key' && (
        <Field label="私钥文件">
          <div className="input-action">
            <input
              required
              placeholder="~/.ssh/id_ed25519"
              value={value.privateKeyPath}
              onChange={(e) => update({ privateKeyPath: e.target.value })}
            />
            <button
              type="button"
              className="icon-button"
              title="选择私钥文件"
              onClick={() =>
                void window.portico
                  .pickKey()
                  .then((path) => path && update({ privateKeyPath: path }))
                  .catch((e) => setError(String(e)))
              }
            >
              <FolderKey size={18} />
            </button>
          </div>
        </Field>
      )}
      {value.auth !== 'agent' && (
        <Field
          label={value.auth === 'password' ? 'SSH 密码' : '私钥口令（可选）'}
          hint={
            host?.hasSecret
              ? '已安全保存。留空保持原值，输入新值即可替换。'
              : '使用操作系统安全存储加密，不会写入明文配置。'
          }
        >
          <input
            type="password"
            autoComplete="new-password"
            value={value.secret || ''}
            onChange={(e) => update({ secret: e.target.value || undefined })}
          />
        </Field>
      )}
      {value.auth === 'agent' && (
        <div className="note">
          <Info size={16} />
          使用当前系统 SSH agent 中已加载的密钥。
        </div>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button type="button" className="secondary" onClick={cancel}>
          取消
        </button>
        <button className="primary" disabled={busy}>
          {busy ? '正在保存…' : '保存主机'}
        </button>
      </div>
    </form>
  )
}

export function newApp(hostId: string): RemoteApp {
  return {
    id: crypto.randomUUID(),
    hostId,
    name: '',
    hostname: '127.0.0.1',
    port: 6006,
    protocol: 'http',
    path: '/',
    startCommand: '',
    workingDirectory: '~',
    environment: {},
    healthPath: '/',
    expectedText: '',
    readyTimeout: 60,
    autoStart: false
  }
}
export function AppForm({
  initial,
  hosts,
  save,
  cancel
}: {
  initial: RemoteApp
  hosts: Host[]
  save: (value: RemoteApp) => Promise<void>
  cancel: () => void
}): React.JSX.Element {
  const [value, set] = useState(initial),
    [environment, setEnvironment] = useState(
      Object.entries(initial.environment)
        .map(([k, v]) => `${k}=${v}`)
        .join('\n')
    )
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const update = (patch: Partial<RemoteApp>): void =>
    set((v) => ({ ...v, ...patch }))
  function template(kind: string): void {
    if (kind === 'tensorboard')
      update({
        name: 'TensorBoard',
        port: 6006,
        path: '/',
        startCommand:
          'exec tensorboard --logdir ./runs --host 127.0.0.1 --port 6006'
      })
    if (kind === 'jupyter')
      update({
        name: 'JupyterLab',
        port: 8888,
        path: '/lab',
        startCommand: 'exec jupyter lab --no-browser --ip=127.0.0.1 --port=8888'
      })
    if (kind === 'streamlit')
      update({
        name: 'Streamlit',
        port: 8501,
        path: '/',
        startCommand:
          'exec streamlit run app.py --server.address 127.0.0.1 --server.port 8501'
      })
  }
  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    setError('')
    setBusy(true)
    try {
      const env: Record<string, string> = {}
      for (const line of environment
        .split('\n')
        .filter((line) => line.trim())) {
        const index = line.indexOf('=')
        if (index < 1) throw new Error('环境变量每行格式应为 KEY=value')
        env[line.slice(0, index).trim()] = line.slice(index + 1)
      }
      await save({ ...value, environment: env })
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <form onSubmit={(event) => void submit(event)}>
      <div className="templates">
        <span>快速填入</span>
        <button type="button" onClick={() => template('tensorboard')}>
          TensorBoard
        </button>
        <button type="button" onClick={() => template('jupyter')}>
          JupyterLab
        </button>
        <button type="button" onClick={() => template('streamlit')}>
          Streamlit
        </button>
      </div>
      <div className="form-grid">
        <Field label="应用名称">
          <input
            autoFocus
            required
            value={value.name}
            placeholder="例如：实验一 · TensorBoard"
            onChange={(e) => update({ name: e.target.value })}
          />
        </Field>
        <Field label="所属主机">
          <select
            value={value.hostId}
            onChange={(e) => update({ hostId: e.target.value })}
          >
            {hosts.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="远端服务地址"
          hint="从 SSH 主机上访问的地址，通常是 127.0.0.1"
        >
          <input
            required
            value={value.hostname}
            onChange={(e) => update({ hostname: e.target.value })}
          />
        </Field>
        <Field label="服务端口">
          <input
            required
            type="number"
            min="1"
            max="65535"
            value={value.port}
            onChange={(e) => update({ port: Number(e.target.value) })}
          />
        </Field>
        <Field label="协议">
          <select
            value={value.protocol}
            onChange={(e) =>
              update({ protocol: e.target.value as 'http' | 'https' })
            }
          >
            <option>http</option>
            <option>https</option>
          </select>
        </Field>
        <Field
          label="页面路径"
          hint="例如 /lab 或 /lab?token=…；配置会加密保存"
        >
          <input
            required
            value={value.path}
            onChange={(e) => update({ path: e.target.value })}
          />
        </Field>
      </div>
      <div className="form-section">
        <label className="toggle">
          <input
            type="checkbox"
            checked={value.autoStart}
            onChange={(e) => update({ autoStart: e.target.checked })}
          />
          <div>
            <strong>连接时按需启动</strong>
            <small>
              已有服务直接复用；未运行时执行以下命令。关闭页面不停止服务。
            </small>
          </div>
        </label>
        {(value.autoStart || value.startCommand) && (
          <>
            <Field
              label="启动命令"
              hint="远端 Linux 需安装 Python 3。使用前台命令，不要加 &；可用 exec 或 conda run 启动。"
            >
              <textarea
                rows={3}
                value={value.startCommand}
                placeholder="exec tensorboard --logdir ./runs --host 127.0.0.1 --port 6006"
                onChange={(e) => update({ startCommand: e.target.value })}
              />
            </Field>
            <Field label="工作目录">
              <input
                value={value.workingDirectory}
                onChange={(e) => update({ workingDirectory: e.target.value })}
              />
            </Field>
          </>
        )}
      </div>
      <details>
        <summary>环境与健康检查</summary>
        <div className="form-grid">
          <Field label="健康检查路径">
            <input
              value={value.healthPath}
              onChange={(e) => update({ healthPath: e.target.value })}
            />
          </Field>
          <Field label="启动等待秒数">
            <input
              type="number"
              min="5"
              max="300"
              value={value.readyTimeout}
              onChange={(e) => update({ readyTimeout: Number(e.target.value) })}
            />
          </Field>
        </div>
        <Field
          label="预期响应文本（可选）"
          hint="设置后可避免将端口上的其他服务误认成目标应用。"
        >
          <input
            value={value.expectedText}
            onChange={(e) => update({ expectedText: e.target.value })}
          />
        </Field>
        <Field label="环境变量（每行 KEY=value）">
          <textarea
            rows={3}
            value={environment}
            onChange={(e) => setEnvironment(e.target.value)}
          />
        </Field>
      </details>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button type="button" className="secondary" onClick={cancel}>
          取消
        </button>
        <button className="primary" disabled={busy}>
          {busy ? '正在保存…' : '保存应用'}
        </button>
      </div>
    </form>
  )
}
