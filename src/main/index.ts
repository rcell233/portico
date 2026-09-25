import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeImage,
  Menu,
  safeStorage,
  session
} from 'electron'
import { join } from 'node:path'
import { z } from 'zod'
import { Store } from './core/store'
import { SshManager } from './core/ssh'
import { ServiceManager } from './core/services'
import { discoveryCommand, parseListeners } from './core/discovery'
import { importSshConfig } from './core/import'
import { appSchema, boundsSchema, hostSchema, idSchema } from './core/schema'
import { Views } from './views'
import { promptSsh } from './ssh-prompt'
import { sshEnvironment } from './core/ssh-environment'
import type { Workspace } from '../shared/api'
import { appName } from '../shared/app-name'

if (process.env.PORTICO_USER_DATA)
  app.setPath('userData', process.env.PORTICO_USER_DATA)
app.setName('Portico')
let window: BrowserWindow | null = null
let store: Store
let ssh: SshManager
let services: ServiceManager
let sshEnv: NodeJS.ProcessEnv = process.env
let views: Views | undefined
const resource = (name: string): string =>
  join(
    app.isPackaged ? process.resourcesPath : app.getAppPath(),
    'resources',
    name
  )
function snapshot(): Workspace {
  return {
    hosts: store.hosts(),
    apps: store.apps(),
    connections: ssh.states(),
    tabs: views?.states() || [],
    activeTab: views?.active || null
  }
}
function changed(): void {
  if (window && !window.isDestroyed())
    window.webContents.send('portico:change', snapshot())
}
function createWindow(): void {
  window = new BrowserWindow({
    title: 'Portico',
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 620,
    backgroundColor: '#f6f5f1',
    icon: resource('icon.png'),
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webviewTag: false
    }
  })
  views = new Views(window, store, ssh, services, changed)
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.webContents.on('did-finish-load', () => changed())
  window.once('ready-to-show', () => {
    window?.maximize()
    window?.show()
  })
  window.on('closed', () => {
    views?.closeAll()
    views = undefined
    window = null
    ssh.close()
  })
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (!app.isPackaged && devUrl) void window.loadURL(devUrl)
  else void window.loadFile(join(__dirname, '../renderer/index.html'))
}
function register(): void {
  const handle = (
    name: string,
    callback: (input: unknown) => unknown
  ): void => {
    ipcMain.handle(`portico:${name}`, (event, input: unknown) => {
      if (
        !window ||
        event.sender !== window.webContents ||
        event.senderFrame !== window.webContents.mainFrame
      )
        throw new Error('拒绝非工作空间的请求')
      return callback(input)
    })
  }
  handle('snapshot', () => snapshot())
  handle('saveHost', async (input) => {
    const host = hostSchema.parse(input)
    if (store.hosts().some((h) => h.id === host.id)) {
      views?.closeHost(host.id)
      ssh.disconnect(host.id)
    }
    await store.saveHost(host)
    changed()
    return snapshot()
  })
  handle('deleteHost', async (input) => {
    const id = idSchema.parse(input)
    await store.deleteHost(id)
    ssh.disconnect(id)
    changed()
    return snapshot()
  })
  handle('saveApp', async (input) => {
    const item = appSchema.parse(input)
    views?.close(item.id)
    await store.saveApp(item)
    changed()
    return snapshot()
  })
  handle('deleteApp', async (input) => {
    const id = idSchema.parse(input)
    views?.close(id)
    await store.deleteApp(id)
    changed()
    return snapshot()
  })
  handle('connect', async (input) => {
    await ssh.connect(idSchema.parse(input))
  })
  handle('disconnect', (input) => {
    const id = idSchema.parse(input)
    views?.closeHost(id)
    ssh.disconnect(id)
  })
  handle('discover', async (input) => {
    const result = await ssh.exec(idSchema.parse(input), discoveryCommand)
    if (result.code !== 0) throw new Error(result.stderr || '服务发现失败')
    return {
      services: parseListeners(result.stdout),
      note: '显示当前 SSH 用户可见的 TCP 监听端口。进程信息可能受权限限制，非 Web 服务不能直接在应用中浏览。'
    }
  })
  handle('importHosts', () => importSshConfig({ env: sshEnv }))
  handle('pickKey', async () => {
    const selected = await dialog.showOpenDialog(window!, {
      title: '选择 SSH 私钥',
      properties: ['openFile', 'showHiddenFiles']
    })
    return selected.canceled ? null : selected.filePaths[0]
  })
  handle('openApp', (input) => views?.open(idSchema.parse(input)))
  handle('closeTab', (input) => views?.close(idSchema.parse(input)))
  handle('activateTab', (input) =>
    views?.activate(input === null ? null : idSchema.parse(input))
  )
  handle('bounds', (input) => views?.setBounds(boundsSchema.parse(input)))
  handle('overlay', (input) => views?.overlay(z.boolean().parse(input)))
  handle('navigate', (input) =>
    views?.navigate(z.enum(['back', 'forward', 'reload']).parse(input))
  )
  handle('logs', (input) => services.logs(store.app(idSchema.parse(input))))
  handle('stopService', async (input) => {
    const id = idSchema.parse(input)
    const item = store.app(id)
    if (
      !(await views?.confirm(
        `停止 ${appName(item)}？`,
        '只会向经过进程身份校验的 Portico 托管进程组发送停止信号。已有的外部服务不会被停止。'
      ))
    )
      return
    views?.close(id)
    await services.stop(item)
  })
  handle('clearSession', (input) => views?.clearSession(idSchema.parse(input)))
}
app.whenReady().then(async () => {
  try {
    const available = (): boolean =>
      safeStorage.isEncryptionAvailable() &&
      !(
        process.platform === 'linux' &&
        safeStorage.getSelectedStorageBackend() === 'basic_text'
      )
    store = new Store(app.getPath('userData'), {
      encrypt: (value) => {
        if (!available())
          throw new Error(
            '系统安全存储不可用；请启用 macOS 钥匙串、Windows 凭据保护或 Linux Secret Service'
          )
        return safeStorage.encryptString(value).toString('base64')
      },
      decrypt: (value) => {
        if (!available()) throw new Error('系统安全存储不可用')
        return safeStorage.decryptString(Buffer.from(value, 'base64'))
      }
    })
    await store.load()
    sshEnv = await sshEnvironment()
    ssh = new SshManager(
      store,
      changed,
      async (host, fingerprint) => {
        if (!window) return false
        return (
          (
            await dialog.showMessageBox(window, {
              type: 'question',
              title: '首次连接主机',
              message: `信任 ${host.name} 的 SSH 主机密钥？`,
              detail: `${host.hostname}:${host.port}\n${fingerprint}\n\n请核对服务器指纹。确认后将加密保存，密钥变化时拒绝连接。`,
              buttons: ['取消', '信任并连接'],
              defaultId: 0,
              cancelId: 0
            })
          ).response === 1
        )
      },
      (host) => ({
        env: sshEnv,
        askpass: {
          nodePath: process.execPath,
          scriptPath: resource('ssh-askpass.cjs'),
          prompt: (request, signal) =>
            promptSsh(
              window,
              resource('ssh-prompt.html'),
              host.name,
              request,
              signal
            )
        }
      })
    )
    services = new ServiceManager(ssh)
    session.defaultSession.setPermissionRequestHandler(
      (_contents, _permission, callback) => callback(false)
    )
    session.defaultSession.setPermissionCheckHandler(() => false)
    if (process.platform === 'darwin')
      app.dock?.setIcon(nativeImage.createFromPath(resource('icon.png')))
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        ...(process.platform === 'darwin'
          ? [{ role: 'appMenu' as const }]
          : []),
        {
          label: 'File',
          submenu: [
            {
              label: '关闭标签页',
              accelerator: 'CmdOrCtrl+W',
              click: () => views?.closeActive()
            },
            { type: 'separator' },
            { role: 'quit' }
          ]
        },
        { role: 'editMenu' },
        { role: 'viewMenu' },
        { role: 'windowMenu' }
      ])
    )
    register()
    createWindow()
    app.on('activate', () => {
      if (!window) createWindow()
    })
  } catch (error) {
    dialog.showErrorBox('Portico 无法启动', String(error))
    app.quit()
  }
})
app.on('before-quit', () => {
  views?.closeAll()
  ssh?.close()
})
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
