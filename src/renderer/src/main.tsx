import React from 'react'
import ReactDOM from 'react-dom/client'
import './styles.css'

function App(): React.JSX.Element {
  const [tab, setTab] = React.useState<'apps' | 'roadmap'>('apps')
  return (
    <div className="workspace">
      <aside>
        <div className="brand">
          <span className="mark" aria-hidden="true">
            P
          </span>
          Portico
        </div>
        <p className="sidebar-label">工作空间</p>
        <nav aria-label="工作空间导航">
          <button
            aria-current={tab === 'apps' ? 'page' : undefined}
            onClick={() => setTab('apps')}
          >
            应用库 <span>0</span>
          </button>
          <button
            aria-current={tab === 'roadmap' ? 'page' : undefined}
            onClick={() => setTab('roadmap')}
          >
            开发路线图 <span>↗</span>
          </button>
        </nav>
        <div className="sidebar-footer">
          <i /> 本地工作空间
          <br />
          <small>Portico · 初始版本</small>
        </div>
      </aside>
      <main>
        <header>
          <span>{tab === 'apps' ? '应用库' : '开发路线图'}</span>
          <span className="badge">项目初始化</span>
        </header>
        {tab === 'apps' ? (
          <section className="welcome">
            <p className="eyebrow">YOUR REMOTE APPS, ONE DOORWAY.</p>
            <h1>
              远程应用，
              <br />
              从这里打开。
            </h1>
            <p className="intro">
              将不同服务器上的工具汇集到一个工作空间。
              <br />
              连接、启动和访问，都留在 Portico 里。
            </p>
            <div className="empty-state">
              <span className="door" aria-hidden="true">
                ⌑
              </span>
              <h2>你的应用库还是空的</h2>
              <p>桌面框架已就绪。SSH 连接与应用管理将在下一阶段加入。</p>
              <button className="primary" onClick={() => setTab('roadmap')}>
                查看开发路线图 <span>→</span>
              </button>
            </div>
            <footer>
              为 TensorBoard、JupyterLab 和你的远程 Web 工具而建。
            </footer>
          </section>
        ) : (
          <section className="roadmap">
            <p className="eyebrow">BUILDING PORTICO</p>
            <h1>从连接到应用。</h1>
            <p className="intro">
              围绕一次点击就能打开远程应用的体验，逐步实现。
            </p>
            <ol>
              {[
                [
                  '桌面基础',
                  'Electron、React、TypeScript、隔离的进程边界与构建流程。',
                  '已完成'
                ],
                [
                  '主机与连接',
                  '保存 SSH 主机、校验主机密钥、认证与连接状态。',
                  '下一阶段'
                ],
                [
                  '应用库与访问',
                  '保存服务配置，通过 SSH 在应用内打开网页。',
                  '计划中'
                ],
                [
                  '服务发现',
                  '列出远程监听端口，选择服务并加入应用库。',
                  '计划中'
                ],
                [
                  '按需启动',
                  '检测已有服务、执行启动命令、等待就绪并查看日志。',
                  '计划中'
                ]
              ].map(([title, description, status], i) => (
                <li key={title}>
                  <span className="step">0{i + 1}</span>
                  <div>
                    <h2>{title}</h2>
                    <p>{description}</p>
                  </div>
                  <span className="status">{status}</span>
                </li>
              ))}
            </ol>
          </section>
        )}
      </main>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
