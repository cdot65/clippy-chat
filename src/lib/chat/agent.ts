import type { ChatMessage } from './history'
import { callMcpTool, getMcpTools } from './mcp'
import { InferenceError, chatStream, type StreamEvent, type InferenceMessage } from './inference'

export type AgentEvent = StreamEvent | { type: 'tool_use'; name: string }

const MAX_ROUNDS = 5

/** Cap on each tool result fed back to the model. MCP results are unbounded —
 *  a Brave search or an SCM dump runs to tens of KB — and every round's results
 *  stay in `msgs` for the rest of the turn, on top of a history that was
 *  budgeted once (chat.ts CONTEXT_BUDGET) without accounting for them or for
 *  the tool definitions. Uncapped, one verbose result overruns the model's
 *  window and vLLM 400s the whole turn. Truncating costs one answer some
 *  detail; not truncating costs the turn. */
const MAX_TOOL_RESULT_CHARS = 4000

const capToolResult = (s: string) =>
  s.length <= MAX_TOOL_RESULT_CHARS
    ? s
    : `${s.slice(0, MAX_TOOL_RESULT_CHARS)}\n[truncated ${s.length - MAX_TOOL_RESULT_CHARS} characters]`

/** Tool-calling loop over chatStream. Non-tool events pass through; tool_calls
 *  are executed via MCP and fed back as `tool` messages. Round MAX_ROUNDS runs
 *  without tools so the model must answer. Tool results are untrusted content. */
export async function* agentStream(
  history: ChatMessage[], signal?: AbortSignal,
): AsyncGenerator<AgentEvent> {
  let tools = await getMcpTools() // [] ⇒ behaves exactly like plain chatStream
  const msgs: InferenceMessage[] = [...history]
  for (let round = 1; round <= MAX_ROUNDS; round++) {
    let calls: Array<{ id: string; name: string; arguments: string }> | null = null
    let yielded = false
    // One retry per round, tools dropped: vLLM rejects the request outright
    // when it is not configured to accept a `tools` payload (e.g. served
    // without --enable-auto-tool-choice), which would otherwise fail every
    // turn the moment MCP starts returning tools. Degrade to plain chat and
    // log the misconfiguration rather than swallow it. Only safe before the
    // first yielded event — after that a retry would duplicate output.
    for (let attempt = 0; ; attempt++) {
      const useTools = tools.length > 0 && round < MAX_ROUNDS
      try {
        for await (const ev of chatStream(msgs, { signal, tools: useTools ? tools : undefined })) {
          if (ev.type === 'tool_calls') calls = ev.calls
          else { yielded = true; yield ev }
        }
        break
      } catch (err) {
        if (attempt > 0 || !useTools || yielded
          || !(err instanceof InferenceError) || err.status !== 400) throw err
        console.error('vllm rejected tools payload, retrying without tools:', err.body)
        tools = []
        calls = null
      }
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
      msgs.push({ role: 'tool', tool_call_id: c.id, content: capToolResult(result) })
    }
  }
}
