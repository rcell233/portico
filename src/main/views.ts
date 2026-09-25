import { app, BrowserWindow, dialog, session, WebContentsView } from 'electron'
import type { AppTab, Bounds } from '../shared/api'
import { Store } from './core/store'
import { SshManager } from './core/ssh'
import { ServiceManager } from './core/services'
import { ServiceProxy } from './core/proxy'
import { appUrl } from './core/schema'

type Tab = { state: AppTab; proxy?: ServiceProxy; view?: WebContentsView }
export class Views {
  private tabs = new Map<string, Tab>()
  active: string | null = null
  private area: Bounds = { x: 232, y: 180, width: 700, height: 500 }
  private obscured = false
  constructor(
    private window: BrowserWindow,
    private store: Store,
    private ssh: SshManager,
    private services: ServiceManager,
    private changed: () => void
  ) {
    app.on('login', (event, contents, _details, auth, callback) => {
      if (!contents) return
      const tab = [...this.tabs.values()].find(
        (t) => t.view?.webContents.id === contents?.id
      )
      if (!tab) return
      event.preventDefault()
      if (
        auth.isProxy &&
        tab.proxy &&
        auth.host === '127.0.0.1' &&
        auth.port === tab.proxy.port
      )
        callback(tab.proxy.username, tab.proxy.password)
      else {
        callback()
        tab.state.message =
          '此服务要求浏览器 HTTP 认证；请使用服务自己的网页登录。'
        this.changed()
      }
    })
    window.on('resize', () => this.layout())
  }
  states(): AppTab[] {
    return [...this.tabs.values()].map((t) => ({ ...t.state }))
  }
  has(id: string): boolean {
    return this.tabs.has(id)
  }
  async open(id: string): Promise<void> {
    const existing = this.tabs.get(id)
    if (existing && existing.state.status !== 'error') {
      this.activate(id)
      return
    }
    if (existing) this.close(id)
    const config = this.store.app(id)
    const tab: Tab = {
      state: {
        appId: id,
        title: config.name,
        status: 'opening',
        message: '准备连接…',
        url: appUrl(config),
        canGoBack: false,
        canGoForward: false
      }
    }
    this.tabs.set(id, tab)
    this.active = id
    this.layout()
    this.changed()
    const current = (): boolean =>
      this.tabs.get(id) === tab && !this.window.isDestroyed()
    try {
      const message = await this.services.ensure(config, (message) => {
        if (current()) {
          tab.state.message = message
          this.changed()
        }
      })
      if (!current()) return
      const proxy = new ServiceProxy(
        config.hostname,
        config.port,
        config.protocol,
        () => this.ssh.forward(config.hostId, config.hostname, config.port)
      )
      tab.proxy = proxy
      await proxy.start()
      if (!current()) {
        proxy.close()
        return
      }
      const partition = session.fromPartition(`persist:service-${id}`)
      await partition.setProxy({
        mode: 'fixed_servers',
        proxyRules: `http=127.0.0.1:${proxy.port};https=127.0.0.1:${proxy.port}`,
        proxyBypassRules: '<-loopback>'
      })
      await partition.closeAllConnections()
      if (!current()) {
        proxy.close()
        return
      }
      partition.setPermissionRequestHandler(
        (_contents, _permission, callback) => callback(false)
      )
      partition.setPermissionCheckHandler(() => false)
      partition.webRequest.onBeforeRequest((details, callback) => {
        try {
          const url = new URL(details.url)
          callback({
            cancel: !(
              ['data:', 'blob:'].includes(url.protocol) || proxy.allowed(url)
            )
          })
        } catch {
          callback({ cancel: true })
        }
      })
      partition.removeAllListeners('will-download')
      partition.on('will-download', (_event, item) => {
        item.setSaveDialogOptions({
          title: '保存远程应用文件',
          defaultPath: item.getFilename()
        })
      })
      const view = new WebContentsView({
        webPreferences: {
          session: partition,
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          webviewTag: false,
          navigateOnDragDrop: false
        }
      })
      tab.view = view
      view.setBackgroundColor('#ffffff')
      const contents = view.webContents
      contents.setWindowOpenHandler(({ url }) => {
        try {
          if (proxy.allowed(new URL(url)))
            void contents.loadURL(url).catch(() => {})
        } catch {}
        return { action: 'deny' }
      })
      contents.on('will-navigate', (event, url) => {
        try {
          if (!proxy.allowed(new URL(url))) event.preventDefault()
        } catch {
          event.preventDefault()
        }
      })
      contents.on('will-redirect', (event, url) => {
        try {
          if (!proxy.allowed(new URL(url))) {
            event.preventDefault()
            tab.state.message = '已阻止跳转到此应用之外的地址'
            this.changed()
          }
        } catch {
          event.preventDefault()
        }
      })
      const navigation = (): void => {
        if (!current()) return
        tab.state.url = contents.getURL()
        tab.state.canGoBack = contents.navigationHistory.canGoBack()
        tab.state.canGoForward = contents.navigationHistory.canGoForward()
        this.changed()
      }
      contents.on('did-navigate', navigation)
      contents.on('did-navigate-in-page', navigation)
      contents.on(
        'did-fail-load',
        (_event, code, description, _url, mainFrame) => {
          if (mainFrame && code !== -3 && current()) {
            tab.state.status = 'error'
            tab.state.message = `页面加载失败：${description}`
            this.layout()
            this.changed()
          }
        }
      )
      contents.on('render-process-gone', () => {
        if (current()) {
          tab.state.status = 'error'
          tab.state.message = '页面进程退出，请重试连接'
          this.layout()
          this.changed()
        }
      })
      this.window.contentView.addChildView(view)
      view.setVisible(false)
      await contents.loadURL(appUrl(config))
      if (!current()) return
      tab.state.status = 'ready'
      tab.state.message = message
      this.layout()
      this.changed()
    } catch (error) {
      if (!current()) return
      tab.state.status = 'error'
      tab.state.message = error instanceof Error ? error.message : String(error)
      tab.proxy?.close()
      tab.proxy = undefined
      this.layout()
      this.changed()
    }
  }
  activate(id: string | null): void {
    if (id && !this.tabs.has(id)) throw new Error('标签页不存在')
    this.active = id
    this.layout()
    this.changed()
  }
  setBounds(bounds: Bounds): void {
    this.area = bounds
    this.layout()
  }
  overlay(visible: boolean): void {
    this.obscured = visible
    this.layout()
  }
  private layout(): void {
    if (this.window.isDestroyed()) return
    const [width, height] = this.window.getContentSize()
    for (const [id, tab] of this.tabs) {
      if (!tab.view) continue
      const x = Math.min(Math.round(this.area.x), width),
        y = Math.min(Math.round(this.area.y), height)
      tab.view.setBounds({
        x,
        y,
        width: Math.max(0, Math.min(Math.round(this.area.width), width - x)),
        height: Math.max(0, Math.min(Math.round(this.area.height), height - y))
      })
      tab.view.setVisible(
        id === this.active && !this.obscured && tab.state.status === 'ready'
      )
    }
  }
  navigate(action: 'back' | 'forward' | 'reload'): void {
    const contents = this.active
      ? this.tabs.get(this.active)?.view?.webContents
      : undefined
    if (!contents) return
    if (action === 'back' && contents.navigationHistory.canGoBack())
      contents.navigationHistory.goBack()
    if (action === 'forward' && contents.navigationHistory.canGoForward())
      contents.navigationHistory.goForward()
    if (action === 'reload') contents.reload()
  }
  close(id: string): void {
    const tab = this.tabs.get(id)
    if (!tab) return
    this.services.cancel(id)
    this.tabs.delete(id)
    if (tab.view) {
      if (!this.window.isDestroyed())
        this.window.contentView.removeChildView(tab.view)
      tab.view.webContents.close()
    }
    tab.proxy?.close()
    if (this.active === id) this.active = [...this.tabs.keys()].at(-1) || null
    this.layout()
    this.changed()
  }
  closeHost(id: string): void {
    for (const app of this.store.apps().filter((a) => a.hostId === id))
      this.close(app.id)
    for (const h of this.store.hosts().filter((h) => h.jumpHostId === id))
      this.closeHost(h.id)
  }
  closeAll(): void {
    for (const id of [...this.tabs.keys()]) this.close(id)
  }
  async clearSession(id: string): Promise<void> {
    this.close(id)
    const s = session.fromPartition(`persist:service-${id}`)
    await s.clearStorageData()
    await s.clearCache()
    await s.clearAuthCache()
  }
  async confirm(message: string, detail: string): Promise<boolean> {
    const previous = this.obscured
    this.overlay(true)
    try {
      return (
        (
          await dialog.showMessageBox(this.window, {
            type: 'warning',
            message,
            detail,
            buttons: ['取消', '确认'],
            defaultId: 0,
            cancelId: 0
          })
        ).response === 1
      )
    } finally {
      this.overlay(previous)
    }
  }
}
