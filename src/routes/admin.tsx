import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { adminApi, api } from '~/lib/api'

export const Route = createFileRoute('/admin')({ component: AdminPage })

const fmt = (s: string | null) => (s ? new Date(s).toLocaleString() : '—')

function AdminPage() {
  const navigate = useNavigate()
  const [page, setPage] = useState(1)
  const [username, setUsername] = useState('')
  const [filter, setFilter] = useState('') // applied on Enter
  const [selected, setSelected] = useState<string | null>(null)

  const { data: me, isSuccess } = useQuery({ queryKey: ['me'], queryFn: api.me })
  useEffect(() => { if (isSuccess && !me.isAdmin) navigate({ to: '/' }) }, [isSuccess, me, navigate])

  const { data } = useQuery({
    queryKey: ['admin-conversations', page, filter],
    queryFn: () => adminApi.list(page, filter),
    enabled: isSuccess && me.isAdmin,
  })
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1

  return (
    <div className="admin">
      <header className="admin-header">
        <h1>📎 Conversation Log</h1>
        <input placeholder="Filter by username… (Enter)" value={username}
          onChange={(e) => setUsername(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { setFilter(username.trim()); setPage(1) } }} />
        <Link to="/">← Back to chat</Link>
      </header>
      <table className="admin-table">
        <thead>
          <tr><th>User</th><th>Title</th><th>Msgs</th><th>Tokens</th><th>Updated</th><th>Created</th><th></th></tr>
        </thead>
        <tbody>
          {data?.rows.map((r) => (
            <tr key={r.id} onClick={() => setSelected(r.id)}>
              <td>{r.owner.username}</td>
              <td className="cell-title">{r.title ?? 'Untitled'}</td>
              <td>{r.messageCount}</td>
              <td>{r.promptTokens}/{r.completionTokens}</td>
              <td>{fmt(r.updatedAt)}</td>
              <td>{fmt(r.createdAt)}</td>
              <td>{r.deletedAt && <span className="badge-deleted">deleted</span>}</td>
            </tr>
          ))}
          {data && data.rows.length === 0 && <tr><td colSpan={7} className="empty">No conversations</td></tr>}
        </tbody>
      </table>
      <footer className="admin-pager">
        <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>← Prev</button>
        <span>page {page} of {pages}{data ? ` (${data.total} total)` : ''}</span>
        <button disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next →</button>
      </footer>
      {selected && <Flyout id={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}

function Flyout({ id, onClose }: { id: string; onClose: () => void }) {
  const { data } = useQuery({ queryKey: ['admin-conversation', id], queryFn: () => adminApi.detail(id) })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <>
      <div className="flyout-backdrop" onClick={onClose} />
      <aside className="flyout">
        <button className="flyout-close" onClick={onClose}>✕</button>
        {data && (
          <>
            <h2>{data.conversation.title ?? 'Untitled'}</h2>
            <dl className="flyout-meta">
              <dt>ID</dt><dd>{data.conversation.id}</dd>
              <dt>Owner</dt><dd>{data.owner?.username} ({data.owner?.authProvider}{data.owner?.isServiceAccount ? ', service' : ''})</dd>
              <dt>Email</dt><dd>{data.owner?.email ?? '—'}</dd>
              <dt>Model</dt><dd>{data.conversation.model}</dd>
              <dt>Created</dt><dd>{fmt(data.conversation.createdAt)}</dd>
              <dt>Updated</dt><dd>{fmt(data.conversation.updatedAt)}</dd>
              <dt>Deleted</dt><dd>{data.conversation.deletedAt ? fmt(data.conversation.deletedAt) : 'no'}</dd>
            </dl>
            <div className="flyout-messages">
              {data.messages.map((m) => (
                <div key={m.id} className={`log-msg log-${m.role}`}>
                  <div className="log-head">
                    <span className="log-role">{m.role}</span>
                    <span className="log-time">{fmt(m.createdAt)}</span>
                    {(m.promptTokens ?? m.completionTokens) != null && <span className="log-tokens">{m.promptTokens ?? 0}/{m.completionTokens ?? 0} tok</span>}
                    {m.interrupted && <span className="badge-deleted">interrupted</span>}
                  </div>
                  <div className="log-content">{m.content}</div>
                </div>
              ))}
            </div>
          </>
        )}
      </aside>
    </>
  )
}
