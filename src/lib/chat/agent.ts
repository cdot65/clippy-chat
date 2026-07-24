import type { ChatMessage } from './history'
import { callMcpTool, getMcpTools } from './mcp'
import { chatStream, type StreamEvent, type VllmMessage } from './vllm'

export type AgentEvent = StreamEvent | { type: 'tool_use'; name: string }

const MAX_ROUNDS = 5

/** Tool-calling loop over chatStream. Non-tool events pass through; tool_calls
 *  are executed via MCP and fed back as `tool` messages. Round MAX_ROUNDS runs
 *  without tools so the model must answer. Tool results are untrusted content. */
export async function* agentStream(
  history: ChatMessage[], signal?: AbortSignal,
): AsyncGenerator<AgentEvent> {
  const tools = await getMcpTools() // [] ⇒ behaves exactly like plain chatStream
  const msgs: VllmMessage[] = [...history]
  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const lastRound = round === MAX_ROUNDS || tools.length === 0
    let calls: Array<{ id: string; name: string; arguments: string }> | null = null
    for await (const ev of chatStream(msgs, { signal, tools: lastRound ? undefined : tools })) {
      if (ev.type === 'tool_calls') calls = ev.calls
      else yield ev
    }
    if (!calls?.length) return
    msgs.push({ role: 'assistant', content: '',
      tool_calls: calls.map((c) => ({ id: c.id, type: 'function' as const,
        function: { name: c.name, arguments: c.arguments } })) })
    for (const c of calls) {
      yield { type: 'tool_use', name: c.name }
      let result: string
      try {
        result = await callMcpTool(c.name, JSON.parse(c.arguments || '{}'))
      } catch {
        result = `[tool call failed: invalid arguments JSON for ${c.name}]`
      }
      msgs.push({ role: 'tool', tool_call_id: c.id, content: result })
    }
  }
}
