import { env } from '~/lib/env'
import type { ChatMessage } from './history'
import type { OpenAiTool } from './mcp'

export type ToolCall = { id: string; name: string; arguments: string }
export type VllmMessage =
  | ChatMessage
  | { role: 'assistant'; content: string
      tool_calls: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> }
  | { role: 'tool'; tool_call_id: string; content: string }

export type StreamEvent =
  | { type: 'delta'; content: string }
  | { type: 'tool_calls'; calls: ToolCall[] }
  | { type: 'usage'; promptTokens: number; completionTokens: number }

export async function* chatStream(
  messages: VllmMessage[],
  opts: { signal?: AbortSignal; tools?: OpenAiTool[] } = {},
): AsyncGenerator<StreamEvent> {
  const { signal, tools } = opts
  const res = await fetch(`${env().VLLM_BASE_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      // cluster vLLM runs with --api-key; dev vLLM may not — no key, no header
      ...(env().VLLM_API_KEY ? { authorization: `Bearer ${env().VLLM_API_KEY}` } : {}),
    },
    body: JSON.stringify({
      model: env().VLLM_MODEL, messages, stream: true,
      stream_options: { include_usage: true },
      ...(tools?.length ? { tools, tool_choice: 'auto' } : {}),
    }),
    signal,
  })
  if (!res.ok || !res.body) throw new Error(`vllm error: ${res.status} ${await res.text().catch(() => '')}`)

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
