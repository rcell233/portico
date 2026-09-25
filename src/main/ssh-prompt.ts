import { BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import type { SshPrompt } from './core/openssh'

// Separate, sandboxed modal: remote web content never sees authentication prompts or replies.
export function promptSsh(
  parent: BrowserWindow | null,
  page: string,
  host: string,
  request: SshPrompt,
  signal: AbortSignal
): Promise<string | null> {
  if (!parent || parent.isDestroyed() || signal.aborted)
    return Promise.resolve(null)
  return new Promise((resolve) => {
    const prompt = new BrowserWindow({
      parent,
      modal: true,
      width: 580,
      height: 440,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      show: false,
      title: `SSH · ${host}`,
      backgroundColor: '#f6f5f1',
      webPreferences: {
        preload: join(__dirname, '../preload/ssh-prompt.js'),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true
      }
    })
    let finished = false
    const finish = (answer: string | null): void => {
      if (finished) return
      finished = true
      signal.removeEventListener('abort', cancel)
      ipcMain.removeListener('portico:ssh-prompt-ready', ready)
      ipcMain.removeListener('portico:ssh-prompt-answer', answerHandler)
      if (!prompt.isDestroyed()) prompt.destroy()
      resolve(answer)
    }
    const cancel = (): void => finish(null)
    const valid = (event: Electron.IpcMainEvent): boolean =>
      !prompt.isDestroyed() &&
      event.sender === prompt.webContents &&
      event.senderFrame === prompt.webContents.mainFrame
    const ready = (event: Electron.IpcMainEvent): void => {
      if (valid(event))
        event.reply('portico:ssh-prompt-data', { ...request, host })
    }
    const answerHandler = (
      event: Electron.IpcMainEvent,
      answer: unknown
    ): void => {
      if (
        valid(event) &&
        (answer === null ||
          (typeof answer === 'string' &&
            answer.length <= 8192 &&
            !/[\r\n\0]/.test(answer)))
      )
        finish(answer)
    }
    ipcMain.on('portico:ssh-prompt-ready', ready)
    ipcMain.on('portico:ssh-prompt-answer', answerHandler)
    signal.addEventListener('abort', cancel, { once: true })
    prompt.once('closed', cancel)
    prompt.once('ready-to-show', () => {
      if (!finished) prompt.show()
    })
    prompt.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    prompt.webContents.on('will-navigate', (event) => event.preventDefault())
    void prompt.loadFile(page).catch(cancel)
  })
}
