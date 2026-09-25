// Isolated desktop fixture: npm run build, then bundle as out/manual/index.cjs.
import { app, BrowserWindow, ipcMain } from 'electron'
import { resolve, join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { sshFixture } from './fixtures'
import { SshManager } from '../src/main/core/ssh'
import { promptSsh } from '../src/main/ssh-prompt'
import { importSshConfig } from '../src/main/core/import'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { ServiceManager } from '../src/main/core/services'
import { Views } from '../src/main/views'
import { hostSchema, appSchema } from '../src/main/core/schema'

app.setName('Portico SSH QA')
app.whenReady().then(async () => {
  const fixture = await sshFixture()
  // Remove only this harness's disposable fixture entry, before showing the UI.
  await fixture.store.deleteHost(fixture.host.id)
  const web = http.createServer((_req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.end(
      `<!doctype html><html><head><title>实验看板 · Portico QA</title></head><body style="font:20px system-ui;padding:60px"><h1>端口应用已打开</h1><p>此页面通过真实 SSH 代理连接。</p><button onclick="document.title='后续页面标题'">改变页面标题</button></body></html>`
    )
  })
  await new Promise<void>((resolve) => web.listen(0, '127.0.0.1', resolve))
  const webPort = (web.address() as AddressInfo).port
  const configPath = join(fixture.directory, 'config')
  const relay = join(fixture.directory, 'relay.cjs')
  await writeFile(
    relay,
    `const net = require('node:net'); const s = net.connect(${fixture.host.port}, '127.0.0.1'); process.stdin.pipe(s).pipe(process.stdout); s.on('error', () => process.exit(1)); s.on('close', () => process.exit());`
  )
  await writeFile(
    configPath,
    `Host proxy-fixture\n HostName test.invalid\n User fixture\n ProxyCommand /usr/bin/env ELECTRON_RUN_AS_NODE=1 "${process.execPath}" "${relay}"\n UserKnownHostsFile ${fixture.directory}/known_hosts\n StrictHostKeyChecking ask\n PreferredAuthentications password\n IdentityAgent none\n`
  )
  const window = new BrowserWindow({
    title: 'Portico SSH QA',
    width: 1280,
    height: 900,
    webPreferences: {
      preload: resolve('out/preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  const changed = (): void => {
    if (!window.isDestroyed())
      window.webContents.send('portico:change', snapshot())
  }
  const ssh = new SshManager(
    fixture.store,
    changed,
    async () => false,
    () => ({
      configPath,
      askpass: {
        nodePath: process.execPath,
        scriptPath: resolve('resources/ssh-askpass.cjs'),
        prompt: (request, signal) =>
          promptSsh(
            window,
            resolve('resources/ssh-prompt.html'),
            'proxy-fixture',
            request,
            signal
          )
      }
    })
  )
  const services = new ServiceManager(ssh)
  const views = new Views(window, fixture.store, ssh, services, changed)
  const snapshot = (): object => ({
    hosts: fixture.store.hosts(),
    apps: fixture.store.apps(),
    connections: ssh.states(),
    tabs: views.states(),
    activeTab: views.active
  })
  ipcMain.handle('portico:snapshot', snapshot)
  ipcMain.handle('portico:importHosts', () => importSshConfig({ configPath }))
  ipcMain.handle('portico:saveHost', async (_event, value) => {
    await fixture.store.saveHost(hostSchema.parse(value))
    changed()
    return snapshot()
  })
  ipcMain.handle('portico:connect', async (_event, id) => {
    await ssh.connect(id)
    const result = await ssh.exec(id, 'printf native-ui-success')
    console.log(result.stdout)
  })
  ipcMain.handle('portico:disconnect', (_event, id) => ssh.disconnect(id))
  ipcMain.handle('portico:discover', async (_event, id) => {
    await ssh.connect(id)
    return {
      services: [
        {
          hostname: '127.0.0.1',
          port: webPort,
          suggestedName: '测试网页',
          process: 'node'
        }
      ],
      note: 'Isolated fixture listener'
    }
  })
  ipcMain.handle('portico:saveApp', async (_event, input) => {
    const value = appSchema.parse(input)
    views.close(value.id)
    await fixture.store.saveApp(value)
    changed()
    return snapshot()
  })
  ipcMain.handle('portico:openApp', (_event, id) => views.open(id))
  ipcMain.handle('portico:closeTab', (_event, id) => views.close(id))
  ipcMain.handle('portico:activateTab', (_event, id) => views.activate(id))
  ipcMain.handle('portico:navigate', (_event, action) => views.navigate(action))
  ipcMain.handle('portico:overlay', (_event, value) => views.overlay(value))
  ipcMain.handle('portico:bounds', (_event, value) => views.setBounds(value))
  window.on('closed', () => {
    views.closeAll()
    web.closeAllConnections()
    web.close()
    ssh.close()
    void fixture.cleanup().then(() => app.quit())
  })
  await window.loadFile(resolve('out/renderer/index.html'))
})
app.on('window-all-closed', () => app.quit())
