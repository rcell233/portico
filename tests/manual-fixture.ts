import http from 'node:http'
import { WebSocketServer } from 'ws'
import type { AddressInfo } from 'node:net'
import { sshFixture } from './fixtures'

async function main(): Promise<void> {
  const fixture = await sshFixture()
  const web = http.createServer((req, res) => {
    if (req.url === '/download') {
      res.writeHead(200, {
        'Content-Type': 'text/plain',
        'Content-Disposition': 'attachment; filename="portico-test.txt"'
      })
      res.end('Portico SSH download test')
      return
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.setHeader('Set-Cookie', 'portico_fixture=present; SameSite=Lax')
    res.end(
      `<!doctype html><html lang="zh"><head><title>Portico SSH 验证</title><style>body{font:16px system-ui;background:#fafbf6;color:#315b41;padding:60px}h1{font-size:36px}.ok{padding:15px;background:#e8f0df;margin:15px 0;border-radius:8px}a{color:#507944}</style></head><body><p>LOCAL SSH INTEGRATION FIXTURE</p><h1>远程页面已通过 SSH 加载</h1><div class="ok" id="bridge"></div><div class="ok" id="cookie"></div><div class="ok" id="ws">WebSocket 连接中…</div><a href="/download">下载验证文件</a><script>document.getElementById('bridge').textContent=typeof window.portico==='undefined'?'✓ 远程页面无法访问桌面 API':'✗ 进程隔离失败';document.getElementById('cookie').textContent=document.cookie.includes('portico_fixture')?'✓ Cookie 可用':'✗ Cookie 不可用';const s=new WebSocket('ws://'+location.host+'/socket');s.onopen=()=>s.send('Portico');s.onmessage=e=>document.getElementById('ws').textContent='✓ WebSocket 双向通信成功：'+e.data;s.onerror=()=>document.getElementById('ws').textContent='✗ WebSocket 连接失败';</script></body></html>`
    )
  })
  const ws = new WebSocketServer({ server: web })
  ws.on('connection', (socket) =>
    socket.on('message', (data) => socket.send(data.toString()))
  )
  await new Promise<void>((resolve) => web.listen(0, '127.0.0.1', resolve))
  console.log(
    JSON.stringify({
      sshPort: fixture.host.port,
      webPort: (web.address() as AddressInfo).port,
      username: 'fixture',
      password: 'test-secret'
    })
  )
  process.on('SIGINT', () => {
    ws.close()
    web.closeAllConnections()
    web.close()
    void fixture.cleanup().finally(() => process.exit())
  })
}
void main()
