import { useEffect, useState } from 'react'
import {
  ArrowLeft,
  Check,
  ChevronRight,
  FileText,
  LoaderCircle,
  RefreshCw,
  Search,
  Server
} from 'lucide-react'
import type { Host, ImportedHost } from '../../../shared/api'

export function HostPicker({
  saved,
  select,
  manual
}: {
  saved: Host[]
  select: (host: ImportedHost) => Promise<void>
  manual: () => void
}): React.JSX.Element {
  const [saving, setSaving] = useState('')
  const [saveError, setSaveError] = useState('')
  const [hosts, setHosts] = useState<ImportedHost[]>([])
  const [query, setQuery] = useState(''),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [revision, refresh] = useState(0)
  useEffect(() => {
    let current = true
    setLoading(true)
    setError('')
    void window.portico
      .importHosts()
      .then((value) => {
        if (current) setHosts(value)
      })
      .catch((reason) => {
        if (current)
          setError(
            (reason instanceof Error ? reason.message : String(reason)).replace(
              /^Error invoking remote method '[^']+': Error: /,
              ''
            )
          )
      })
      .finally(() => {
        if (current) setLoading(false)
      })
    return () => {
      current = false
    }
  }, [revision])
  const matches = hosts.filter((h) =>
    `${h.name} ${h.hostname} ${h.username}`
      .toLowerCase()
      .includes(query.toLowerCase())
  )
  return (
    <div className="host-picker">
      <div className="config-source">
        <FileText size={22} />
        <div>
          <strong>从本机 SSH 配置选择</strong>
          <code>~/.ssh/config</code>
        </div>
        <button
          className="icon-button"
          title="重新读取 SSH 配置"
          disabled={loading}
          onClick={() => refresh((n) => n + 1)}
        >
          <RefreshCw size={16} />
        </button>
      </div>
      <p className="intro">
        选择即添加。连接时直接使用本机 SSH 配置，包括代理、跳板和认证方式。
      </p>
      <label className="search config-search">
        <Search size={16} />
        <input
          autoFocus
          aria-label="搜索 SSH 配置主机"
          placeholder="搜索别名、地址或用户名"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      {loading ? (
        <div className="loading">
          <LoaderCircle size={22} className="spin" />
          正在读取本机 SSH 配置…
        </div>
      ) : error ? (
        <div className="config-empty" role="status">
          <strong>暂时无法读取 SSH 配置</strong>
          <p>{error}</p>
          <button className="secondary" onClick={() => refresh((n) => n + 1)}>
            重新读取
          </button>
        </div>
      ) : !hosts.length ? (
        <div className="config-empty">
          <Server size={25} />
          <strong>本机 SSH 配置中还没有主机</strong>
          <p>可以先在 ~/.ssh/config 中添加 Host，也可以手动配置。</p>
        </div>
      ) : (
        <div className="service-list config-list">
          {matches.map((h) => {
            const exists = saved.some((s) => s.sshAlias === h.name)
            return (
              <button
                key={h.name}
                disabled={exists || Boolean(saving)}
                onClick={() => {
                  setSaving(h.name)
                  setSaveError('')
                  void select(h)
                    .catch((e) => setSaveError(String(e)))
                    .finally(() => setSaving(''))
                }}
              >
                <Server size={19} />
                <span>
                  <strong>{h.name}</strong>
                  <small>
                    {h.username ? `${h.username}@` : ''}
                    {h.hostname}:{h.port}
                  </small>
                  {h.note && <small className="config-note">{h.note}</small>}
                </span>
                {exists ? (
                  <span className="already-added">
                    <Check size={13} />
                    已添加
                  </span>
                ) : saving === h.name ? (
                  <LoaderCircle size={17} className="spin" />
                ) : (
                  <ChevronRight size={17} />
                )}
              </button>
            )
          })}
          {!matches.length && (
            <div className="config-empty">
              <strong>没有匹配的主机</strong>
              <p>试试其他关键词，或手动配置。</p>
            </div>
          )}
        </div>
      )}
      {saveError && (
        <p className="form-error" role="alert">
          {saveError}
        </p>
      )}
      <div className="config-manual">
        <span>配置里没有这台主机？</span>
        <button
          className="text-button"
          disabled={Boolean(saving)}
          onClick={manual}
        >
          手动配置
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  )
}

export function BackToConfig({
  onClick
}: {
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="text-button back-to-config"
      onClick={onClick}
    >
      <ArrowLeft size={14} />
      返回 SSH 配置列表
    </button>
  )
}
