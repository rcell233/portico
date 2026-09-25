import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import {
  FolderKey,
  Info,
  LoaderCircle,
  RefreshCw,
  Server,
  Check
} from 'lucide-react'
import type { Host, HostInput, RemoteApp, Service } from '../../../shared/api'

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
  useConfig,
  saveLabel,
  cancel
}: {
  host?: Host
  hosts: Host[]
  saveLabel?: string
  useConfig: () => void
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
        {value.sshAlias ? (
          <Field label="本机 SSH Host 别名">
            <input readOnly value={value.sshAlias} />
          </Field>
        ) : (
          <>
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
          </>
        )}
      </div>
      {value.sshAlias ? (
        <div className="note">
          <Info size={16} />
          使用 ~/.ssh/config 中的原始配置连接。代理、跳板和认证由系统 SSH
          处理；修改配置后重新连接即可生效。
        </div>
      ) : (
        <>
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
              label={
                value.auth === 'password' ? 'SSH 密码' : '私钥口令（可选）'
              }
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
                onChange={(e) =>
                  update({ secret: e.target.value || undefined })
                }
              />
            </Field>
          )}
          {value.auth === 'agent' && (
            <div className="note">
              <Info size={16} />
              使用当前系统 SSH agent 中已加载的密钥。
            </div>
          )}
        </>
      )}
      <button type="button" className="text-button" onClick={useConfig}>
        {value.sshAlias ? '选择其他 SSH Host' : '改用本机 SSH Config'}
      </button>
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
          {busy ? '正在保存…' : saveLabel || '保存主机'}
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
    port: 0,
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
  host,
  editing,
  save,
  cancel
}: {
  initial: RemoteApp
  host: Host
  editing: boolean
  save: (value: RemoteApp) => Promise<void>
  cancel: () => void
}): React.JSX.Element {
  const [value, set] = useState(initial)
  const [environment, setEnvironment] = useState(
    Object.entries(initial.environment)
      .map(([k, v]) => `${k}=${v}`)
      .join('\n')
  )
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const [services, setServices] = useState<Service[]>([])
  const [discovering, setDiscovering] = useState(!editing)
  const [discoveryError, setDiscoveryError] = useState('')
  const [revision, refresh] = useState(0)
  const update = (patch: Partial<RemoteApp>): void =>
    set((v) => ({ ...v, ...patch }))
  useEffect(() => {
    if (editing && revision === 0) return
    let active = true
    setDiscovering(true)
    setDiscoveryError('')
    void window.portico
      .discover(host.id)
      .then((data) => {
        if (active) setServices(data.services)
      })
      .catch((reason) => {
        if (active)
          setDiscoveryError(
            String(reason).replace(
              /^Error invoking remote method '[^']+': Error: /,
              ''
            )
          )
      })
      .finally(() => {
        if (active) setDiscovering(false)
      })
    return () => {
      active = false
    }
  }, [host.id, editing, revision])
  function template(kind: string): void {
    if (kind === 'tensorboard')
      update({
        port: 6006,
        path: '/',
        startCommand:
          'exec tensorboard --logdir ./runs --host 127.0.0.1 --port 6006'
      })
    if (kind === 'jupyter')
      update({
        port: 8888,
        path: '/lab',
        startCommand: 'exec jupyter lab --no-browser --ip=127.0.0.1 --port=8888'
      })
    if (kind === 'streamlit')
      update({
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
      await save({
        ...value,
        hostId: host.id,
        name: value.name.trim(),
        environment: env
      })
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className="app-form" onSubmit={(event) => void submit(event)}>
      <div className="app-host-context">
        <Server size={17} />
        <strong>{host.name}</strong>
        <span>
          {host.sshAlias
            ? `SSH · ${host.sshAlias}`
            : `${host.username}@${host.hostname}`}
        </span>
      </div>
      <section className="port-picker">
        <Field label="服务端口" hint="选择一个已运行的端口，或直接输入。">
          <input
            autoFocus
            required
            type="number"
            min="1"
            max="65535"
            placeholder="例如 6006"
            value={value.port || ''}
            onChange={(e) => update({ port: Number(e.target.value) })}
          />
        </Field>
        <div className="port-list-heading">
          <span>{discovering ? '正在读取远端端口…' : '这台主机上的端口'}</span>
          <button
            type="button"
            className="text-button"
            disabled={discovering}
            onClick={() => refresh((n) => n + 1)}
          >
            {discovering ? (
              <LoaderCircle size={13} className="spin" />
            ) : (
              <RefreshCw size={13} />
            )}
            刷新端口
          </button>
        </div>
        {discoveryError ? (
          <p className="port-note">
            暂时无法读取端口，可以直接输入。<span>{discoveryError}</span>
          </p>
        ) : (
          <div className="port-options">
            {services.map((service) => {
              const selected =
                value.port === service.port &&
                value.hostname === service.hostname
              return (
                <button
                  type="button"
                  key={`${service.hostname}:${service.port}`}
                  className={selected ? 'selected' : ''}
                  aria-pressed={selected}
                  onClick={() =>
                    update({ port: service.port, hostname: service.hostname })
                  }
                >
                  <strong>{service.port}</strong>
                  <span>
                    {service.suggestedName}
                    <small>
                      {service.hostname}
                      {service.process ? ` · ${service.process}` : ''}
                    </small>
                  </span>
                  {selected && <Check size={16} />}
                </button>
              )
            })}
            {!discovering && !services.length && (
              <p className="port-note">未发现监听端口，仍可输入端口添加。</p>
            )}
          </div>
        )}
      </section>
      <Field
        label="名称（可选）"
        hint="留空后，首次打开时使用网页标题；没有标题时显示端口。"
      >
        <input
          maxLength={100}
          value={value.name}
          placeholder="自动使用网页标题"
          onChange={(e) => update({ name: e.target.value })}
        />
      </Field>
      <details className="app-advanced">
        <summary>
          连接设置{' '}
          <span>
            {value.protocol} · {value.hostname}
            {value.path.split('?')[0]}
          </span>
        </summary>
        <div className="form-grid">
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
        </div>
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
      </details>
      <details className="app-advanced" open={value.autoStart || undefined}>
        <summary>
          按需启动{' '}
          <span>{value.autoStart ? '已开启' : '默认连接已有服务'}</span>
        </summary>
        <label className="toggle">
          <input
            type="checkbox"
            checked={value.autoStart}
            onChange={(e) => update({ autoStart: e.target.checked })}
          />
          <div>
            <strong>服务未运行时自动启动</strong>
            <small>已运行则直接复用，关闭页面后继续在后台运行。</small>
          </div>
        </label>
        <div className="templates">
          <span>命令模板</span>
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
        <Field
          label="启动命令"
          hint="远端 Linux 需安装 Python 3。使用前台命令，不要加 &。"
        >
          <textarea
            rows={3}
            value={value.startCommand}
            onChange={(e) => update({ startCommand: e.target.value })}
          />
        </Field>
        <Field label="工作目录">
          <input
            value={value.workingDirectory}
            onChange={(e) => update({ workingDirectory: e.target.value })}
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
      <details className="app-advanced">
        <summary>
          健康检查 <span>通常无需修改</span>
        </summary>
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
          hint="避免将端口上的其他服务误认成目标应用。"
        >
          <input
            value={value.expectedText}
            onChange={(e) => update({ expectedText: e.target.value })}
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
        <button className="primary" disabled={busy || !value.port}>
          {busy ? '正在保存…' : editing ? '保存更改' : '打开应用'}
        </button>
      </div>
    </form>
  )
}
