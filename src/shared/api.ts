export type ConnectionStatus =
  'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error'
export interface Host {
  id: string
  name: string
  hostname: string
  port: number
  username: string
  auth: 'agent' | 'key' | 'password'
  privateKeyPath: string
  jumpHostId: string
  hasSecret: boolean
}
export interface HostInput extends Omit<Host, 'hasSecret'> {
  secret?: string
}
export interface RemoteApp {
  id: string
  hostId: string
  name: string
  hostname: string
  port: number
  protocol: 'http' | 'https'
  path: string
  startCommand: string
  workingDirectory: string
  environment: Record<string, string>
  healthPath: string
  expectedText: string
  readyTimeout: number
  autoStart: boolean
}
export interface Connection {
  hostId: string
  status: ConnectionStatus
  message: string
}
export interface AppTab {
  appId: string
  status: 'opening' | 'ready' | 'error'
  message: string
  title: string
  url: string
  canGoBack: boolean
  canGoForward: boolean
}
export interface Workspace {
  hosts: Host[]
  apps: RemoteApp[]
  connections: Connection[]
  tabs: AppTab[]
  activeTab: string | null
}
export interface Service {
  hostname: string
  port: number
  process: string
  suggestedName: string
}
export interface Discovery {
  services: Service[]
  note: string
}
export interface ImportedHost {
  name: string
  hostname: string
  port: number
  username: string
  privateKeyPath: string
  warning: string
}
export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}
export interface PorticoApi {
  platform: string
  snapshot(): Promise<Workspace>
  saveHost(host: HostInput): Promise<Workspace>
  deleteHost(id: string): Promise<Workspace>
  saveApp(app: RemoteApp): Promise<Workspace>
  deleteApp(id: string): Promise<Workspace>
  connect(id: string): Promise<void>
  disconnect(id: string): Promise<void>
  discover(id: string): Promise<Discovery>
  importHosts(): Promise<ImportedHost[]>
  pickKey(): Promise<string | null>
  openApp(id: string): Promise<void>
  closeTab(id: string): Promise<void>
  activateTab(id: string | null): Promise<void>
  bounds(bounds: Bounds): Promise<void>
  overlay(visible: boolean): Promise<void>
  navigate(action: 'back' | 'forward' | 'reload'): Promise<void>
  logs(id: string): Promise<string>
  stopService(id: string): Promise<void>
  clearSession(id: string): Promise<void>
  onChange(callback: (workspace: Workspace) => void): () => void
}
