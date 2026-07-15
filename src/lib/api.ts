export type Conversation = {
  id: string; title: string | null; model: string; createdAt: string; updatedAt: string
  lastMessage: { role: 'user' | 'assistant'; content: string } | null
}
export type Message = { id: string; role: 'user' | 'assistant'; content: string; interrupted: boolean; createdAt: string }
export type Me = { id: string; username: string; displayName: string | null; email: string | null; isAdmin: boolean }

async function json<T>(res: Response): Promise<T> {
  if (res.status === 401) { window.location.href = '/login'; throw new Error('unauthorized') }
  if (!res.ok) throw new Error(`api ${res.status}`)
  return res.json()
}

export const api = {
  me: () => fetch('/api/me').then((r) => json<Me>(r)),
  conversations: () => fetch('/api/conversations').then((r) => json<Conversation[]>(r)),
  messages: (id: string) => fetch(`/api/conversations/${id}/messages`).then((r) => json<Message[]>(r)),
  deleteConversation: (id: string) => fetch(`/api/conversations/${id}`, { method: 'DELETE' }).then((r) => json<{ ok: true }>(r)),
  localLogin: (username: string, password: string) =>
    fetch('/api/auth/local-login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) }),
  logout: () => fetch('/api/auth/logout', { method: 'POST' }),
}

export type AdminRow = {
  id: string; title: string | null; model: string
  createdAt: string; updatedAt: string; deletedAt: string | null
  owner: { username: string; authProvider: string }
  messageCount: number; promptTokens: number; completionTokens: number
}
export type AdminList = { rows: AdminRow[]; total: number; page: number; pageSize: number }
export type AdminDetail = {
  conversation: { id: string; title: string | null; model: string; createdAt: string; updatedAt: string; deletedAt: string | null }
  owner: { id: string; username: string; email: string | null; authProvider: string; isServiceAccount: boolean } | null
  messages: { id: string; role: 'system' | 'user' | 'assistant'; content: string; promptTokens: number | null; completionTokens: number | null; interrupted: boolean; createdAt: string }[]
}

export const adminApi = {
  list: (page: number, username: string) =>
    fetch(`/api/admin/conversations?page=${page}${username ? `&username=${encodeURIComponent(username)}` : ''}`)
      .then((r) => json<AdminList>(r)),
  detail: (id: string) => fetch(`/api/admin/conversations/${id}`).then((r) => json<AdminDetail>(r)),
}

/** POST /api/chat and invoke callbacks per SSE event. Returns when stream ends. */
export async function streamChat(
  conversationId: string, message: string,
  on: { delta: (text: string) => void; done: () => void; error: (msg: string) => void },
) {
  const res = await fetch('/api/chat', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ conversationId, message }),
  })
  if (res.status === 401) { window.location.href = '/login'; return }
  if (!res.ok || !res.body) { on.error(`request failed (${res.status})`); return }
  const reader = res.body.getReader(); const decoder = new TextDecoder()
  let buf = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let idx
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, idx); buf = buf.slice(idx + 2)
      const event = frame.match(/^event: (.+)$/m)?.[1]
      const data = frame.match(/^data: (.+)$/m)?.[1]
      if (!event || !data) continue
      const parsed = JSON.parse(data)
      if (event === 'delta') on.delta(parsed.content)
      else if (event === 'done') on.done()
      else if (event === 'error') on.error(parsed.message)
    }
  }
}
