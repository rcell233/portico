import type { PorticoApi } from '../../shared/api'

declare global {
  interface Window {
    portico: PorticoApi
  }
}
