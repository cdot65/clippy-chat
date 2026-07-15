import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { api } from '~/lib/api'
import { groupThreads, snippet, threadTime } from '~/lib/ui/threads'
import { Avatar, ClipIcon } from './ui'

export function Sidebar({ activeId }: { activeId: string | null }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { data: convos } = useQuery({ queryKey: ['conversations'], queryFn: api.conversations })
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: api.me })
  const del = useMutation({
    mutationFn: api.deleteConversation,
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: ['conversations'] })
      if (id === activeId) navigate({ to: '/' })
    },
  })
  const displayName = me?.displayName ?? me?.username ?? ''

  return (
    <aside className="sidebar">
      <div className="side-head">
        <div className="brand">
          <span className="brand-mark"><ClipIcon size={17} /></span>
          <div className="brand-text">
            <div className="brand-name">clippy<span className="brand-cursor">_</span></div>
            <div className="brand-tag">it looks like a chat</div>
          </div>
        </div>
        <Link to="/" className="btn-secondary">+ New thread</Link>
      </div>

      <nav className="threads">
        {groupThreads(convos ?? []).map((group) => (
          <div key={group.key} className="thread-group">
            <div className="thread-group-label">{group.label}</div>
            {group.items.map((c) => (
              <button key={c.id} className={c.id === activeId ? 'thread active' : 'thread'}
                onClick={() => navigate({ to: '/c/$conversationId', params: { conversationId: c.id } })}>
                <span className="thread-top">
                  <span className="thread-title">{c.title ?? 'untitled thread'}</span>
                  <span className="thread-time">{threadTime(c.updatedAt)}</span>
                  <span role="button" className="thread-del" title="Delete thread" aria-label="Delete thread"
                    onClick={(e) => { e.stopPropagation(); if (confirm('Delete conversation?')) del.mutate(c.id) }}>✕</span>
                </span>
                {c.lastMessage && <span className="thread-snippet">{snippet(c.lastMessage.role, c.lastMessage.content)}</span>}
              </button>
            ))}
          </div>
        ))}
      </nav>

      <footer className="side-foot">
        <Avatar name={displayName} />
        <div className="side-user">
          <span className="side-user-name">{displayName}</span>
          <span className="side-user-meta">
            {me?.isAdmin && <Link to="/admin">admin</Link>}
            <button onClick={() => api.logout().then(() => (window.location.href = '/login'))}>log out</button>
          </span>
        </div>
      </footer>
    </aside>
  )
}
