import type { Service } from '../../shared/api'
const names: Record<number, string> = {
  6006: 'TensorBoard',
  8888: 'JupyterLab',
  8889: 'JupyterLab',
  3000: 'Web 应用',
  5173: 'Vite',
  7860: 'Gradio',
  8501: 'Streamlit',
  9090: 'Prometheus',
  8080: 'Web 服务'
}
export function parseListeners(output: string): Service[] {
  const services = new Map<string, Service>()
  for (const line of output.split('\n')) {
    const fields = line.trim().split(/\s+/)
    if (!fields.includes('LISTEN')) continue
    const local = fields[0] === 'LISTEN' ? fields[3] : fields[3]
    const match = local?.match(/^(.*):(\d+)$/)
    if (!match) continue
    const port = Number(match[2])
    if (!port || port === 22) continue
    let hostname = match[1].replace(/^\[|\]$/g, '')
    if (['*', '0.0.0.0', '::'].includes(hostname)) hostname = '127.0.0.1'
    const process =
      line.match(/users:\(\("([^"]+)"/)?.[1] ??
      fields
        .find((f) => /^\d+\//.test(f))
        ?.split('/')
        .slice(1)
        .join('/') ??
      ''
    const key = `${hostname}:${port}`
    services.set(key, {
      hostname,
      port,
      process,
      suggestedName: names[port] || process || `服务 ${port}`
    })
  }
  return [...services.values()].sort((a, b) => a.port - b.port)
}
export const discoveryCommand =
  'if command -v ss >/dev/null 2>&1; then ss -H -ltnp; elif command -v netstat >/dev/null 2>&1; then netstat -lntp 2>/dev/null; else printf "需要 ss 或 netstat 才能发现端口" >&2; exit 1; fi'
