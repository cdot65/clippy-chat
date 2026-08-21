import { env } from '~/lib/env'
import type { ChatMessage } from './history'
import { getInferenceCredential, hasInferenceClientCredentials } from './inference-auth'
import type { OpenAiTool } from './mcp'

export type ToolCall = { id: string; name: string; arguments: string }
export type InferenceMessage =
  | ChatMessage
  | { role: 'assistant'; content: string
      tool_calls: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> }
  | { role: 'tool'; tool_call_id: string; content: string }

export type StreamEvent =
  | { type: 'delta'; content: string }
  | { type: 'tool_calls'; calls: ToolCall[] }
  | { type: 'usage'; promptTokens: number; completionTokens: number }

/** Non-2xx from the inference endpoint, with the status and body kept separate
 *  so callers can branch on them (see agent.ts's tools fallback) instead of
 *  regexing a string. */
export class InferenceError extends Error {
  constructor(readonly status: number, readonly body: string) {
    super(`inference error: ${status} ${body}`)
    this.name = 'InferenceError'
  }
}

/** AIRS authenticates the caller with `x-portkey-api-key`; a bare vLLM behind
 *  `--api-key` wants `Authorization: Bearer`. Sending the wrong one is a 401,
 *  and sending both risks the gateway forwarding our key upstream, so pick.
 *
 *  In gateway mode the credential is a Keycloak `completions.write` JWT whose
 *  portkey_oid/portkey_workspace claims authenticate the org — that is what
 *  replaces a static workspace key (see the Security Handoff, "Org-level JWKS").
 *  Only the gateway header is sent: X-Auth-Token carries a per-destination
 *  identity for MCP routes, and /v1/chat/completions has no destination server.
 *  A static INFERENCE_API_KEY remains the fallback until the Keycloak client is
 *  provisioned, and stays the only credential in direct mode. */
async function inferenceAuthHeaders(): Promise<Record<string, string>> {
  const { INFERENCE_API_KEY, INFERENCE_AUTH_MODE } = env()
  if (INFERENCE_AUTH_MODE === 'gateway' && hasInferenceClientCredentials()) {
    const { accessToken } = await getInferenceCredential()
    return { 'x-portkey-api-key': accessToken }
  }
  if (!INFERENCE_API_KEY) return {} // dev vLLM may run without a key
  return INFERENCE_AUTH_MODE === 'gateway'
    ? { 'x-portkey-api-key': INFERENCE_API_KEY }
    : { authorization: `Bearer ${INFERENCE_API_KEY}` }
}

export async function* chatStream(
  messages: InferenceMessage[],
  opts: { signal?: AbortSignal; tools?: OpenAiTool[] } = {},
): AsyncGenerator<StreamEvent> {
  const { signal, tools } = opts
  const res = await fetch(`${env().INFERENCE_BASE_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(await inferenceAuthHeaders()) },
    body: JSON.stringify({
      model: env().INFERENCE_MODEL, messages, stream: true,
      stream_options: { include_usage: true },
      ...(tools?.length ? { tools, tool_choice: 'auto' } : {}),
    }),
    signal,
  })
  if (!res.ok || !res.body) throw new InferenceError(res.status, await res.text().catch(() => ''))

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  const pending = new Map<number, { id: string; name: string; arguments: string }>()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      let m: RegExpMatchArray | null
      while ((m = buf.match(/\r?\n\r?\n/)) && m.index !== undefined) {
        const frame = buf.slice(0, m.index); buf = buf.slice(m.index + m[0].length)
        const data = frame.split('\n')
          .map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l))
          .find((l) => l.startsWith('data: '))?.slice(6)
        if (!data || data === '[DONE]') continue
        const json = JSON.parse(data)
        const delta = json.choices?.[0]?.delta?.content
        if (delta) yield { type: 'delta', content: delta }
        const tcs = json.choices?.[0]?.delta?.tool_calls as
          | Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }>
          | undefined
        if (tcs) for (const t of tcs) {
          const cur = pending.get(t.index) ?? { id: '', name: '', arguments: '' }
          if (t.id) cur.id = t.id
          if (t.function?.name) cur.name = t.function.name
          if (t.function?.arguments) cur.arguments += t.function.arguments
          pending.set(t.index, cur)
        }
        if (json.usage) yield { type: 'usage', promptTokens: json.usage.prompt_tokens, completionTokens: json.usage.completion_tokens }
      }
    }
    if (pending.size) yield { type: 'tool_calls', calls: [...pending.values()] }
  } finally {
    // cancel also releases the lock; covers early consumer break or a
    // mid-stream parse throw leaving the vLLM body streaming unread.
    reader.cancel().catch(() => {})
  }
}
