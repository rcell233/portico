import { contextBridge } from 'electron'
import type { PorticoApi } from '../shared/api'

const api: PorticoApi = Object.freeze({ platform: process.platform })
contextBridge.exposeInMainWorld('portico', api)
