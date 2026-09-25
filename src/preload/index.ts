import { contextBridge, ipcRenderer } from 'electron'
import type { PorticoApi, Workspace } from '../shared/api'
const invoke = (name: string, value?: unknown): Promise<any> =>
  ipcRenderer.invoke(`portico:${name}`, value)
const api: PorticoApi = {
  platform: process.platform,
  snapshot: () => invoke('snapshot'),
  saveHost: (value) => invoke('saveHost', value),
  deleteHost: (id) => invoke('deleteHost', id),
  saveApp: (value) => invoke('saveApp', value),
  deleteApp: (id) => invoke('deleteApp', id),
  connect: (id) => invoke('connect', id),
  disconnect: (id) => invoke('disconnect', id),
  discover: (id) => invoke('discover', id),
  importHosts: () => invoke('importHosts'),
  pickKey: () => invoke('pickKey'),
  openApp: (id) => invoke('openApp', id),
  closeTab: (id) => invoke('closeTab', id),
  activateTab: (id) => invoke('activateTab', id),
  bounds: (value) => invoke('bounds', value),
  captureBackground: () => invoke('captureBackground'),
  overlay: (value) => invoke('overlay', value),
  navigate: (action) => invoke('navigate', action),
  logs: (id) => invoke('logs', id),
  stopService: (id) => invoke('stopService', id),
  clearSession: (id) => invoke('clearSession', id),
  onChange: (callback) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      value: Workspace
    ): void => callback(value)
    ipcRenderer.on('portico:change', listener)
    return () => ipcRenderer.removeListener('portico:change', listener)
  }
}
contextBridge.exposeInMainWorld('portico', Object.freeze(api))
