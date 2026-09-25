import React, { useCallback, useEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom/client'
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  ChevronRight,
  CircleHelp,
  FileText,
  Globe2,
  LayoutGrid,
  LoaderCircle,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  Square,
  Terminal,
  Trash2,
  X
} from 'lucide-react'
import type { Host, ImportedHost, RemoteApp, Workspace } from '../../shared/api'
import { appName } from '../../shared/app-name'
import { AppForm, HostForm, newApp } from './components/Forms'
import { HostPicker, BackToConfig } from './components/HostPicker'
import logo from '../../../resources/icon.svg'
import './styles.css'
const api = window.portico
const empty: Workspace = {
  hosts: [],
  apps: [],
  connections: [],
  tabs: [],
  activeTab: null
}
type Modal =
  | { kind: 'host'; host?: Host; adding?: boolean; creatingApp?: boolean }
  | { kind: 'app'; app: RemoteApp }
  | { kind: 'logs'; app: RemoteApp; text?: string }
  | { kind: 'import'; replace?: Host; creatingApp?: boolean }
  | {
      kind: 'confirm'
      title: string
      detail: string
      action: () => Promise<unknown>
    }
  | { kind: 'help' }
const connectionLabels = {
  disconnected: '未连接',
  connecting: '连接中',
  connected: '已连接',
  reconnecting: '重连中',
  error: '连接失败'
}
function App(): React.JSX.Element {
  const [workspace, setWorkspace] = useState<Workspace>(empty),
    [selectedHost, setSelectedHost] = useState(''),
    [query, setQuery] = useState('')
  const [modal, setModal] = useState<Modal | null>(null),
    [error, setError] = useState(''),
    [pending, setPending] = useState<string[]>([])
  const viewport = useRef<HTMLDivElement>(null),
    dialog = useRef<HTMLDialogElement>(null)
  const run = useCallback(
    async (key: string, action: () => Promise<unknown>): Promise<void> => {
      setPending((p) => [...p, key])
      setError('')
      try {
        await action()
      } catch (e) {
        setError(
          (e instanceof Error ? e.message : String(e)).replace(
            /^Error invoking remote method '[^']+': Error: /,
            ''
          )
        )
      } finally {
        setPending((p) => p.filter((value) => value !== key))
      }
    },
    []
  )
  useEffect(() => {
    const cleanup = api.onChange(setWorkspace)
    void api
      .snapshot()
      .then(setWorkspace)
      .catch((e) => setError(String(e)))
    return cleanup
  }, [])
  useEffect(() => {
    const element = viewport.current
    if (!element) return
    const measure = (): void => {
      const { x, y, width, height } = element.getBoundingClientRect()
      void api.bounds({ x, y, width, height })
    }
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    measure()
    return () => observer.disconnect()
  }, [workspace.activeTab])
  useEffect(() => {
    if (modal && !dialog.current?.open) dialog.current?.showModal()
  }, [modal])
  const show = async (value: Modal): Promise<void> => {
    await api.overlay(true)
    setModal(value)
  }
  const close = async (): Promise<void> => {
    setModal(null)
    await api.overlay(false)
  }
  const home = (): void => {
    void run('home', () => api.activateTab(null))
  }
  const current = workspace.tabs.find((t) => t.appId === workspace.activeTab)
  const sidebarCollapsed = Boolean(current)
  const currentApp = workspace.apps.find((a) => a.id === workspace.activeTab)
  const apps = workspace.apps.filter(
    (a) =>
      (!selectedHost || a.hostId === selectedHost) &&
      `${appName(a)} ${a.hostname} ${a.port}`
        .toLowerCase()
        .includes(query.toLowerCase())
  )
  const host = workspace.hosts.find((h) => h.id === selectedHost)
  const connectedCount = workspace.connections.filter(
    (c) => c.status === 'connected'
  ).length
  const addApp = (initial?: RemoteApp, hostId = selectedHost): void => {
    setError('')
    if (!initial && !hostId) {
      void show({ kind: 'import', creatingApp: true })
      return
    }
    void show({ kind: 'app', app: initial || newApp(hostId) })
  }
  const logs = (app: RemoteApp): void => {
    void run('logs', async () => {
      await show({ kind: 'logs', app })
      const text = await api.logs(app.id)
      setModal((m) =>
        m?.kind === 'logs' && m.app.id === app.id ? { ...m, text } : m
      )
    })
  }
  const removeApp = (app: RemoteApp): void => {
    void show({
      kind: 'confirm',
      title: `删除 ${appName(app)}？`,
      detail: '将删除保存的应用配置并关闭标签页，远端服务会继续运行。',
      action: () => api.deleteApp(app.id)
    })
  }
  const removeHost = (host: Host): void => {
    void show({
      kind: 'confirm',
      title: `删除 ${host.name}？`,
      detail: '主机下有应用或被用作跳板机时不能删除。',
      action: async () => {
        await api.deleteHost(host.id)
        setSelectedHost('')
      }
    })
  }
  const importHosts = (): void => {
    setError('')
    void show({ kind: 'import', creatingApp: true })
  }
  const selectConfigHost = async (h: ImportedHost): Promise<void> => {
    const id =
      modal?.kind === 'import' && modal.replace
        ? modal.replace.id
        : crypto.randomUUID()
    const updated = await api.saveHost({
      id,
      name: h.name,
      sshAlias: h.name,
      hostname: h.hostname,
      port: h.port,
      username: h.username,
      privateKeyPath: '',
      auth: 'agent',
      jumpHostId: ''
    })
    setWorkspace(updated)
    setSelectedHost(id)
    if (modal?.kind === 'import' && modal.creatingApp)
      setModal({ kind: 'app', app: newApp(id) })
    else await close()
  }
  return (
    <div className={`workspace ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <aside
        id="workspace-sidebar"
        className="sidebar"
        hidden={sidebarCollapsed}
      >
        <button
          className="brand"
          onClick={() => {
            setSelectedHost('')
            home()
          }}
        >
          <img src={logo} alt="" />
          <span>
            Portico<small>REMOTE WORKSPACE</small>
          </span>
        </button>
        <button
          className={`nav-item ${!selectedHost && !current ? 'selected' : ''}`}
          onClick={() => {
            setSelectedHost('')
            home()
          }}
        >
          <LayoutGrid size={17} />
          全部应用<span className="count">{workspace.apps.length}</span>
        </button>
        <div className="sidebar-heading">
          <span>主机与应用</span>
          <button
            title="添加应用：选择主机和端口"
            className="icon-button"
            onClick={importHosts}
          >
            <Plus size={17} />
          </button>
        </div>
        <div className="host-list">
          {workspace.hosts.map((h) => {
            const status =
              workspace.connections.find((c) => c.hostId === h.id)?.status ||
              'disconnected'
            const savedApps = workspace.apps.filter((a) => a.hostId === h.id)
            return (
              <section
                className="host-group"
                key={h.id}
                aria-label={`${h.name} 的应用`}
              >
                <div className="host-group-heading">
                  <button
                    className={`nav-item host-item ${selectedHost === h.id ? 'selected' : ''}`}
                    onClick={() => {
                      setSelectedHost(h.id)
                      home()
                    }}
                  >
                    <Server size={16} />
                    <span>
                      {h.name}
                      <small>
                        {h.username}@{h.hostname}
                      </small>
                    </span>
                    <i className={`dot ${status}`} />
                  </button>
                  <button
                    className="icon-button host-add-app"
                    title={`在 ${h.name} 上添加应用`}
                    onClick={() => {
                      setSelectedHost(h.id)
                      addApp(undefined, h.id)
                    }}
                  >
                    <Plus size={15} />
                  </button>
                </div>
                <div className="host-apps">
                  {savedApps.map((a) => {
                    const tab = workspace.tabs.find((t) => t.appId === a.id)
                    return (
                      <button
                        key={a.id}
                        className="sidebar-app"
                        title={`${appName(a)} · ${a.hostname}:${a.port}`}
                        onClick={() => {
                          setSelectedHost(h.id)
                          void run(a.id, () => api.openApp(a.id))
                        }}
                      >
                        {tab?.status === 'opening' ? (
                          <LoaderCircle size={14} className="spin" />
                        ) : (
                          <Globe2 size={14} />
                        )}
                        <span>{appName(a)}</span>
                        <small>:{a.port}</small>
                        {tab && (
                          <i
                            className={`dot ${tab.status === 'ready' ? 'connected' : tab.status === 'error' ? 'error' : 'connecting'}`}
                          />
                        )}
                      </button>
                    )
                  })}
                  {!savedApps.length && (
                    <button
                      className="sidebar-app empty-host"
                      onClick={() => {
                        setSelectedHost(h.id)
                        addApp(undefined, h.id)
                      }}
                    >
                      <Plus size={13} />
                      <span>选择端口，添加应用</span>
                    </button>
                  )}
                </div>
              </section>
            )
          })}
          {!workspace.hosts.length && (
            <p className="sidebar-empty">
              选择一台主机和一个端口，
              <br />
              打开你的远程应用。
            </p>
          )}
        </div>
        <button className="add-host" onClick={importHosts}>
          <Plus size={16} />
          添加应用
        </button>
        <div className="sidebar-footer">
          <div>
            <i className={`dot ${connectedCount ? 'connected' : ''}`} />
            {connectedCount ? `${connectedCount} 台主机已连接` : '本地工作空间'}
          </div>
          <button onClick={() => void show({ kind: 'help' })}>
            <CircleHelp size={14} />
            使用说明 <span>0.2</span>
          </button>
        </div>
      </aside>
      <main>
        {workspace.tabs.length > 0 && (
          <div className="tabbar">
            {current && (
              <button className="workspace-return" onClick={home}>
                <ArrowLeft size={15} />
                返回工作空间
              </button>
            )}
            {!current && <span className="workspace-tab-label">工作空间</span>}
            {workspace.tabs.map((tab) => (
              <div
                className={`tab ${current?.appId === tab.appId ? 'active' : ''}`}
                key={tab.appId}
              >
                <button
                  onClick={() =>
                    void run('tab', () => api.activateTab(tab.appId))
                  }
                >
                  {tab.status === 'opening' ? (
                    <LoaderCircle size={14} className="spin" />
                  ) : (
                    <Globe2 size={14} />
                  )}
                  <span>{tab.title}</span>
                </button>
                <button
                  title={`关闭 ${tab.title}`}
                  className="tab-close"
                  onClick={() =>
                    void run('close', () => api.closeTab(tab.appId))
                  }
                >
                  <X size={13} />
                </button>
              </div>
            ))}
            <div className="tabbar-space" />
            <span className="private-label">
              <ShieldCheck size={13} /> SSH WORKSPACE
            </span>
          </div>
        )}
        {!current ? (
          <>
            <header className="library-header">
              <div className="breadcrumb">
                工作空间
                <ChevronRight size={13} />
                <span>{host?.name || '全部应用'}</span>
              </div>
              <div className="header-actions">
                <button className="primary" onClick={() => addApp()}>
                  <Plus size={16} />
                  添加应用
                </button>
              </div>
            </header>
            <div className="library">
              <div className="page-heading">
                <div>
                  <p className="eyebrow">YOUR REMOTE APPS, ONE DOORWAY.</p>
                  <h1>{host ? host.name : '远程应用，近在手边。'}</h1>
                  <p className="intro">
                    {host
                      ? `${host.username}@${host.hostname}:${host.port}`
                      : '将不同服务器上的工具，汇集到一个安静的工作空间。'}
                  </p>
                </div>
                <div className="library-stats">
                  <span>
                    {host
                      ? workspace.apps.filter((a) => a.hostId === host.id)
                          .length
                      : workspace.apps.length}
                    <small>个应用</small>
                  </span>
                  <span>
                    {host
                      ? workspace.connections.find((c) => c.hostId === host.id)
                          ?.status === 'connected'
                        ? 1
                        : 0
                      : connectedCount}
                    <small>台已连接</small>
                  </span>
                </div>
              </div>
              {host && (
                <div className="host-toolbar">
                  <span>
                    <i
                      className={`dot ${workspace.connections.find((c) => c.hostId === host.id)?.status}`}
                    />
                    {
                      connectionLabels[
                        workspace.connections.find((c) => c.hostId === host.id)
                          ?.status || 'disconnected'
                      ]
                    }
                  </span>
                  <div className="row-actions">
                    <button
                      className="text-button"
                      disabled={pending.includes(host.id)}
                      onClick={() =>
                        void run(host.id, () =>
                          workspace.connections.find(
                            (c) => c.hostId === host.id
                          )?.status === 'connected'
                            ? api.disconnect(host.id)
                            : api.connect(host.id)
                        )
                      }
                    >
                      <Power size={14} />
                      {workspace.connections.find((c) => c.hostId === host.id)
                        ?.status === 'connected'
                        ? '断开'
                        : '连接'}
                    </button>
                    <button
                      className="text-button"
                      onClick={() => void show({ kind: 'host', host })}
                    >
                      <Pencil size={14} />
                      编辑
                    </button>
                    <button
                      title="删除主机"
                      className="icon-button danger"
                      onClick={() => removeHost(host)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              )}
              {host &&
                workspace.connections.find((c) => c.hostId === host.id)
                  ?.message && (
                  <div className="inline-error">
                    {
                      workspace.connections.find((c) => c.hostId === host.id)
                        ?.message
                    }
                  </div>
                )}
              <div className="collection-bar">
                <span>
                  应用库 <small>{apps.length}</small>
                </span>
                <label className="search">
                  <Search size={15} />
                  <input
                    aria-label="搜索应用"
                    placeholder="搜索应用、地址或端口"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </label>
              </div>
              {apps.length ? (
                <div className="app-grid">
                  {apps.map((a) => {
                    const h = workspace.hosts.find((h) => h.id === a.hostId)
                    const tab = workspace.tabs.find((t) => t.appId === a.id)
                    const kind = a.name.toLowerCase().includes('tensor')
                      ? 'tensor'
                      : a.name.toLowerCase().includes('jupyter')
                        ? 'jupyter'
                        : 'web'
                    return (
                      <article className="app-card" key={a.id}>
                        <div className="card-top">
                          <span className={`app-glyph ${kind}`}>
                            {kind === 'tensor' ? (
                              <Activity size={24} />
                            ) : kind === 'jupyter' ? (
                              <Terminal size={24} />
                            ) : (
                              <Globe2 size={24} />
                            )}
                          </span>
                          <div className="card-tools">
                            <button
                              className="icon-button"
                              title={`编辑 ${appName(a)}`}
                              onClick={() => addApp(a)}
                            >
                              <Pencil size={14} />
                            </button>
                            <button
                              className="icon-button"
                              title={`删除 ${appName(a)}`}
                              onClick={() => removeApp(a)}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                        <h2>{appName(a)}</h2>
                        <p className="card-host">
                          <Server size={12} />
                          {h?.name}
                        </p>
                        <div className="card-address">
                          {a.hostname}:{a.port}
                          <span>{a.autoStart ? '按需启动' : '已有服务'}</span>
                        </div>
                        <div className="card-bottom">
                          <button
                            className="text-button"
                            onClick={() => logs(a)}
                          >
                            <FileText size={14} />
                            日志
                          </button>
                          <button
                            className="open-button"
                            onClick={() =>
                              void run(`open-${a.id}`, () => api.openApp(a.id))
                            }
                          >
                            {tab?.status === 'opening' ? (
                              <>
                                <LoaderCircle size={15} className="spin" />
                                连接中
                              </>
                            ) : (
                              <>
                                打开应用
                                <ArrowUpRight size={16} />
                              </>
                            )}
                          </button>
                        </div>
                      </article>
                    )
                  })}
                  <button className="new-card" onClick={() => addApp()}>
                    <Plus size={24} />
                    <span>添加远程应用</span>
                  </button>
                </div>
              ) : (
                <div className="empty-state">
                  <div className="empty-arch">
                    <img src={logo} alt="Portico" />
                  </div>
                  <h2>
                    {query ? '没有匹配的应用' : '为你的远程工具，留一扇门。'}
                  </h2>
                  <p>
                    {query
                      ? '试试其他名称、地址或端口。'
                      : workspace.hosts.length
                        ? '选择这台主机上的端口，打开一个应用。'
                        : '选择主机和端口，打开你的第一个远程应用。'}
                  </p>
                  {!query && (
                    <button
                      className="primary"
                      onClick={() =>
                        workspace.hosts.length ? addApp() : importHosts()
                      }
                    >
                      <Plus size={16} />
                      添加第一个应用
                    </button>
                  )}
                  <div className="service-chips">
                    <span>TensorBoard</span>
                    <span>JupyterLab</span>
                    <span>Grafana</span>
                    <span>你的 Web 工具</span>
                  </div>
                </div>
              )}
              <footer>
                <ShieldCheck size={14} />
                配置在本机加密保存 · 关闭页面后，远端服务继续运行
              </footer>
            </div>
          </>
        ) : (
          <>
            <div className="browser-toolbar">
              <div className="row-actions">
                <button
                  className="icon-button"
                  title="后退"
                  disabled={!current.canGoBack}
                  onClick={() => void api.navigate('back')}
                >
                  <ArrowLeft size={16} />
                </button>
                <button
                  className="icon-button"
                  title="前进"
                  disabled={!current.canGoForward}
                  onClick={() => void api.navigate('forward')}
                >
                  <ArrowRight size={16} />
                </button>
                <button
                  className="icon-button"
                  title="刷新"
                  onClick={() =>
                    void run('reload', () =>
                      current.status === 'error'
                        ? api.openApp(current.appId)
                        : api.navigate('reload')
                    )
                  }
                >
                  <RefreshCw size={16} />
                </button>
              </div>
              <div className="url-bar">
                <ShieldCheck size={14} />
                <span>
                  {currentApp?.protocol}://{currentApp?.hostname}:
                  {currentApp?.port}
                  {currentApp?.path.split('?')[0]}
                </span>
                <small>经 SSH</small>
              </div>
              <button
                className="icon-button"
                title="查看日志"
                onClick={() => currentApp && logs(currentApp)}
              >
                <FileText size={17} />
              </button>
              <button
                className="icon-button"
                title="编辑应用"
                onClick={() => currentApp && addApp(currentApp)}
              >
                <Pencil size={16} />
              </button>
              <button
                className="icon-button danger"
                title="停止托管服务"
                onClick={() =>
                  void run('stop', () => api.stopService(current.appId))
                }
              >
                <Square size={15} />
              </button>
            </div>
            <div className="remote-viewport" ref={viewport}>
              {current.status !== 'ready' && (
                <div className="connection-state">
                  {current.status === 'opening' ? (
                    <LoaderCircle size={36} className="spin" />
                  ) : (
                    <Globe2 size={36} />
                  )}
                  <h2>
                    {current.status === 'opening'
                      ? '正在打开远程应用'
                      : '暂时无法打开应用'}
                  </h2>
                  <p>{current.message}</p>
                  {current.status === 'error' && (
                    <div className="row-actions">
                      <button
                        className="primary"
                        onClick={() =>
                          void run('retry', () => api.openApp(current.appId))
                        }
                      >
                        <RefreshCw size={15} />
                        重试
                      </button>
                      <button
                        className="secondary"
                        onClick={() => currentApp && logs(currentApp)}
                      >
                        查看日志
                      </button>
                      <button
                        className="secondary"
                        onClick={() => currentApp && addApp(currentApp)}
                      >
                        编辑配置
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="browser-status">
              <i
                className={`dot ${current.status === 'ready' ? 'connected' : ''}`}
              />
              {current.message}
              <span>
                {workspace.hosts.find((h) => h.id === currentApp?.hostId)?.name}
              </span>
            </div>
          </>
        )}
      </main>
      {error && (
        <div className={`toast ${modal ? 'over-modal' : ''}`} role="alert">
          <InfoIcon />
          <span>{error}</span>
          <button
            title="关闭错误提示"
            className="icon-button"
            onClick={() => setError('')}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {modal && (
        <dialog
          ref={dialog}
          className={`modal ${modal.kind === 'logs' ? 'wide' : ''}`}
          onCancel={(event) => {
            event.preventDefault()
            void close()
          }}
        >
          <div className="modal-heading">
            <div>
              <p className="eyebrow">PORTICO WORKSPACE</p>
              <h2>
                {modal.kind === 'host'
                  ? modal.adding
                    ? modal.host
                      ? '确认 SSH 主机'
                      : '手动配置主机'
                    : '编辑主机'
                  : modal.kind === 'app'
                    ? workspace.apps.some((a) => a.id === modal.app.id)
                      ? '编辑应用'
                      : '添加应用 · 选择端口'
                    : modal.kind === 'logs'
                      ? `运行日志 · ${appName(modal.app)}`
                      : modal.kind === 'import'
                        ? modal.creatingApp
                          ? '添加应用 · 选择主机'
                          : '选择 SSH 配置'
                        : modal.kind === 'confirm'
                          ? modal.title
                          : '关于你的远程工作空间'}
              </h2>
            </div>
            <button
              className="icon-button"
              title="关闭对话框"
              onClick={() => void close()}
            >
              <X size={20} />
            </button>
          </div>
          <div className="modal-body">
            {error && (
              <div className="inline-error" role="alert">
                {error}
              </div>
            )}
            {modal.kind === 'host' && (
              <>
                {modal.adding && <BackToConfig onClick={importHosts} />}
                <HostForm
                  key={modal.host?.id || 'manual'}
                  host={modal.host}
                  hosts={workspace.hosts}
                  saveLabel={modal.creatingApp ? '下一步：选择端口' : undefined}
                  useConfig={() =>
                    setModal({
                      kind: 'import',
                      replace: modal.host,
                      creatingApp: modal.creatingApp
                    })
                  }
                  save={async (value) => {
                    const updated = await api.saveHost(value)
                    setWorkspace(updated)
                    if (modal.creatingApp) {
                      setSelectedHost(value.id)
                      setModal({ kind: 'app', app: newApp(value.id) })
                    } else await close()
                  }}
                  cancel={() => void close()}
                />
              </>
            )}
            {modal.kind === 'app' && (
              <AppForm
                key={modal.app.id}
                initial={modal.app}
                host={workspace.hosts.find((h) => h.id === modal.app.hostId)!}
                editing={workspace.apps.some((a) => a.id === modal.app.id)}
                save={async (value) => {
                  const editing = workspace.apps.some((a) => a.id === value.id)
                  setWorkspace(await api.saveApp(value))
                  await close()
                  if (!editing) void run(value.id, () => api.openApp(value.id))
                }}
                cancel={() => void close()}
              />
            )}
            {modal.kind === 'logs' && (
              <>
                <div className="log-actions">
                  <p>最近 64 KB 输出 · 仅 Portico 托管启动的服务</p>
                  <button
                    className="secondary"
                    disabled={pending.includes('logs')}
                    onClick={() => logs(modal.app)}
                  >
                    <RefreshCw size={14} />
                    刷新
                  </button>
                </div>
                <pre className="logs">{modal.text ?? '正在读取日志…'}</pre>
                <div className="form-actions">
                  <button
                    className="secondary"
                    onClick={() =>
                      void run('stop', () => api.stopService(modal.app.id))
                    }
                  >
                    <Square size={14} />
                    停止托管服务
                  </button>
                  <button
                    className="secondary"
                    onClick={() =>
                      void show({
                        kind: 'confirm',
                        title: '清除此应用的登录状态？',
                        detail:
                          '将关闭标签页并清除 Cookie、缓存和浏览器认证信息。',
                        action: () => api.clearSession(modal.app.id)
                      })
                    }
                  >
                    清除登录状态
                  </button>
                </div>
              </>
            )}
            {modal.kind === 'import' && (
              <HostPicker
                saved={workspace.hosts.filter(
                  (h) => h.id !== modal.replace?.id
                )}
                select={selectConfigHost}
                selectSaved={
                  modal.creatingApp
                    ? (h) => {
                        setSelectedHost(h.id)
                        setModal({ kind: 'app', app: newApp(h.id) })
                      }
                    : undefined
                }
                manual={() =>
                  setModal({
                    kind: 'host',
                    adding: true,
                    creatingApp: modal.creatingApp
                  })
                }
              />
            )}
            {modal.kind === 'confirm' && (
              <>
                <p className="intro">{modal.detail}</p>
                <div className="form-actions">
                  <button className="secondary" onClick={() => void close()}>
                    取消
                  </button>
                  <button
                    className="primary"
                    disabled={pending.includes('confirm')}
                    onClick={() =>
                      void run('confirm', async () => {
                        await modal.action()
                        await close()
                      })
                    }
                  >
                    确认
                  </button>
                </div>
              </>
            )}
            {modal.kind === 'help' && (
              <div className="help">
                <img src={logo} alt="Portico 图标" />
                <p>Portico 将 SSH 主机上的 Web 服务放进独立的应用标签页。</p>
                <ol>
                  <li>
                    添加应用，选择主机后直接选端口；也可以从左侧某台主机下添加。
                  </li>
                  <li>添加应用的远端地址和端口，或使用“发现服务”。</li>
                  <li>打开应用；需要时启用按需启动，并填写命令与工作目录。</li>
                </ol>
                <p>
                  远端自动启动需要 Linux 和 Python
                  3。命令应在前台运行，关闭标签页不会停止服务；停止操作仅针对
                  Portico 托管的进程。
                </p>
                <p>
                  HTTPS
                  使用正常证书校验。页面仅访问配置的服务地址；跨站登录和外部 CDN
                  暂不支持。Jupyter 的登录 token
                  可在运行日志中查看，并填入页面路径。
                </p>
                <p>
                  Mac
                  启动时最大化为普通窗口，不进入系统全屏。凭据、应用路径和环境变量使用系统安全存储加密保存。
                </p>
              </div>
            )}
          </div>
        </dialog>
      )}
    </div>
  )
}
function InfoIcon(): React.JSX.Element {
  return <CircleHelp size={19} />
}
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
