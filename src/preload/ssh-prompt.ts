import { contextBridge, ipcRenderer } from 'electron'
contextBridge.exposeInMainWorld('sshPrompt', {
  ready: (
    callback: (data: { host: string; message: string; hint: string }) => void
  ): void => {
    ipcRenderer.once('portico:ssh-prompt-data', (_event, data) =>
      callback(data)
    )
    ipcRenderer.send('portico:ssh-prompt-ready')
  },
  answer: (value: string | null): void => {
    ipcRenderer.send('portico:ssh-prompt-answer', value)
  }
})
