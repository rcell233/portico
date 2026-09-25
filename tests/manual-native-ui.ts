// Isolated desktop fixture: npm run build, then bundle as out/manual/index.cjs.
import { app, BrowserWindow, ipcMain } from 'electron'
import { resolve, join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { sshFixture } from './fixtures'
import { SshManager } from '../src/main/core/ssh'
import { promptSsh } from '../src/main/ssh-prompt'
import { importSshConfig } from '../src/main/core/import'
import { hostSchema } from '../src/main/core/schema'

app.setName('Portico SSH QA')
app.whenReady().then(async () => {
  const fixture = await sshFixture()
  // Remove only this harness's disposable fixture entry, before showing the UI.
  await fixture.store.deleteHost(fixture.host.id)
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
    width: 1100,
    height: 800,
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
  const snapshot = (): object => ({
    hosts: fixture.store.hosts(),
    apps: [],
    connections: ssh.states(),
    tabs: [],
    activeTab: null
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
  ipcMain.handle('portico:overlay', () => {})
  ipcMain.handle('portico:bounds', () => {})
  window.on('closed', () => {
    ssh.close()
    void fixture.cleanup().then(() => app.quit())
  })
  await window.loadFile(resolve('out/renderer/index.html'))
})
app.on('window-all-closed', () => app.quit())
