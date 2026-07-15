import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { api, streamChat } from '~/lib/api'
import { threadTime } from '~/lib/ui/threads'
import { Sidebar } from './Sidebar'
import { ClipIcon } from './ui'

const GREETING = "Fresh thread. It looks like you're starting from scratch — my favorite kind of chaos. What are we making?"

function BotBadge() {
  return <span className="msg-avatar"><ClipIcon size={12} strokeWidth={2.2} /></span>
}

function MessageRow({ who, ts, text, note }: { who: 'clippy' | 'you'; ts?: string; text: string; note?: string }) {
  const bot = who === 'clippy'
  return (
    <div className={bot ? 'msg-row from-bot' : 'msg-row from-user'}>
      <div className="msg-meta">
        {bot && <BotBadge />}
        <span className="msg-who">{who}</span>
        {ts && <span className="msg-ts">{ts}</span>}
      </div>
      <div className="bubble">
        <div className="bubble-text">{text}</div>
        {note && <div className="bubble-note">{note}</div>}
      </div>
    </div>
  )
}

export function ChatLayout({ conversationId, onFirstSend }: { conversationId: string | null; onFirstSend?: (id: string) => void }) {
  const qc = useQueryClient()
  const [draft, setDraft] = useState('')
  const [streaming, setStreaming] = useState<string | null>(null) // in-flight assistant text
  const [pendingUser, setPendingUser] = useState<string | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null) // conversation id used for the in-flight/failed send, so retry targets the same one
  const [error, setError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  // Redirects to /login on 401 via api helper
  const { data: messages } = useQuery({
    queryKey: ['messages', conversationId],
    queryFn: () => api.messages(conversationId!),
    enabled: !!conversationId,
  })
  const { data: convos } = useQuery({ queryKey: ['conversations'], queryFn: api.conversations })
  const active = conversationId ? convos?.find((c) => c.id === conversationId) : undefined

  // Braced body: React 19 calls any non-undefined effect return as the cleanup
  // on unmount (no typeof guard in prod) — an implicit return of a patched
  // scrollIntoView()'s value crashes the navigate-away unmount.
  useEffect(() => {
    bottomRef.current?.scrollIntoView()
  }, [messages, streaming])

  async function doSend(text: string, id: string) {
    setError(null); setPendingUser(text); setPendingId(id); setStreaming('')
    let acc = ''
    await streamChat(id, text, {
      delta: (t) => { acc += t; setStreaming(acc) },
      done: () => {
        setStreaming(null); setPendingUser(null); setPendingId(null)
        qc.invalidateQueries({ queryKey: ['messages', id] })
        qc.invalidateQueries({ queryKey: ['conversations'] })
        if (!conversationId) onFirstSend?.(id)
      },
      error: (msg) => { setStreaming(null); setError(msg) },
    })
  }

  function send() {
    const text = draft.trim()
    if (!text || streaming !== null) return
    const id = conversationId ?? crypto.randomUUID()
    setDraft('')
    void doSend(text, id)
  }

  function retry() {
    if (pendingUser && pendingId) void doSend(pendingUser, pendingId)
  }

  const msgCount = (messages?.length ?? 0) + (pendingUser ? 1 : 0)
  const modelLabel = active?.model.split('/').pop()

  return (
    <div className="layout">
      <Sidebar activeId={conversationId} />
      <main className="chat">
        <header className="chat-head">
          <h1 className="chat-title">{active?.title ?? 'untitled thread'}</h1>
          <span className="chip-live">live</span>
          <span className="chat-head-spacer" />
          {modelLabel && <span className="pill" title={active?.model}>{modelLabel}</span>}
          <span className="chat-count">{msgCount} msgs</span>
        </header>

        <div className="stream">
          <div className="stream-inner">
            {!conversationId && !pendingUser && streaming === null && (
              <MessageRow who="clippy" text={GREETING} />
            )}
            {messages?.map((m) => (
              <MessageRow key={m.id} who={m.role === 'assistant' ? 'clippy' : 'you'} ts={threadTime(m.createdAt)}
                text={m.content} note={m.interrupted ? '⚠ interrupted' : undefined} />
            ))}
            {pendingUser && <MessageRow who="you" text={pendingUser} />}
            {streaming !== null && streaming !== '' && <MessageRow who="clippy" text={streaming} />}
            {streaming === '' && (
              <div className="typing">
                <BotBadge />
                <span className="typing-dots"><span /><span /><span /></span>
              </div>
            )}
            {error && (
              <div className="msg-row from-bot errored">
                <div className="msg-meta"><BotBadge /><span className="msg-who">clippy</span></div>
                <div className="bubble">
                  <div className="bubble-text">{error}</div>
                  <button className="retry-btn" onClick={retry}>Retry</button>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        </div>

        <div className="composer-wrap">
          <form className="composer-inner" onSubmit={(e) => { e.preventDefault(); send() }}>
            <div className="composer">
              <textarea value={draft} rows={1 + Math.min(4, (draft.match(/\n/g) || []).length)}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Ask clippy anything. It's already looking at you."
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }} />
              <button type="submit" className="btn-primary" disabled={streaming !== null}>Send ↵</button>
            </div>
            <div className="composer-note">clippy can make mistakes. it is, after all, a paperclip.</div>
          </form>
        </div>
      </main>
    </div>
  )
}
