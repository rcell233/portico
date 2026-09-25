import type { RemoteApp } from './api'

export function appName(app: Pick<RemoteApp, 'name' | 'port'>): string {
  return app.name.trim() || `端口 ${app.port}`
}

export function pageName(title: string): string {
  const name = title
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  // Chromium may use the URL as a title when the document has no <title>.
  if (!name || /^(?:https?:\/\/|about:blank)/i.test(name)) return ''
  return name.slice(0, 100)
}
