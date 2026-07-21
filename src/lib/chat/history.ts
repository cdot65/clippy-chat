export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }

export const approxTokens = (s: string) => Math.ceil(s.length / 4)

/**
 * Mistral v0.3's chat template rejects the system role outright ("Conversation
 * roles must alternate user/assistant/..."), so fold system content into the
 * first user turn before sending to vLLM. No system message → unchanged.
 */
export function foldSystem(history: ChatMessage[]): ChatMessage[] {
  const system = history.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n')
  const rest = history.filter((m) => m.role !== 'system')
  if (!system) return rest
  const i = rest.findIndex((m) => m.role === 'user')
  if (i === -1) return rest
  return rest.map((m, j) => (j === i ? { ...m, content: `${system}\n\n${m.content}` } : m))
}

/**
 * Merge consecutive same-role messages into one (content joined with a blank
 * line). Mistral v0.3's template requires strictly alternating roles, but the
 * persisted history can hold adjacent same-role turns — e.g. two concurrent
 * turns on one conversation append user_A, user_B before either assistant row
 * lands, leaving u,u,a,a. Run this last, on the folded payload, so whatever we
 * send vLLM always alternates. Idempotent on already-alternating input.
 */
export function coalesceRoles(history: ChatMessage[]): ChatMessage[] {
  const out: ChatMessage[] = []
  for (const m of history) {
    const prev = out[out.length - 1]
    if (prev && prev.role === m.role) prev.content = `${prev.content}\n\n${m.content}`
    else out.push({ ...m })
  }
  return out
}

/** Keep system message(s) + newest turns that fit maxTokens (approximate). */
// Note: drops the oldest contiguous prefix. When the budget cut lands mid
// user/assistant pair, the assistant prefix is dropped too, so the first
// non-system turn is guaranteed to be a user turn whenever any user turn
// survives — Mistral v0.3's strict-alternation template rejects a payload
// that starts with an assistant message (see foldSystem).
export function trimHistory(history: ChatMessage[], maxTokens: number): ChatMessage[] {
  const system = history.filter((m) => m.role === 'system')
  const rest = history.filter((m) => m.role !== 'system')
  let budget = maxTokens - system.reduce((n, m) => n + approxTokens(m.content), 0)
  const kept: ChatMessage[] = []
  for (let i = rest.length - 1; i >= 0; i--) {
    budget -= approxTokens(rest[i].content)
    if (budget < 0 && kept.length > 0) break
    kept.unshift(rest[i])
  }
  const userFirst = [...kept]
  while (userFirst[0]?.role === 'assistant') userFirst.shift()
  if (userFirst.length > 0) return [...system, ...userFirst]
  // pathological: cut kept only assistant turn(s) (single huge assistant msg)
  // — fall back to the newest user turn; with no user turns at all (can't
  // happen via the chat route, defensive) return the cut unchanged
  const lastUser = [...rest].reverse().find((m) => m.role === 'user')
  return [...system, ...(lastUser ? [lastUser] : kept)]
}
