import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { env } from '~/lib/env'
import { getMcpCredential } from './mcp-auth'

export type OpenAiTool = {
  type: 'function'
  function: { name: string; description?: string; parameters: Record<string, unknown> }
}

const TOOLS_TTL_MS = 5 * 60_000
// a hung (vs. down) MCP server must never hang the chat turn: bound every
// SDK request — connect handshake and listTools short, tool execution longer
// (scm/external APIs can be slow; their own httpx timeout is 10s)
const CONNECT_TIMEOUT_MS = 10_000
const TOOL_CALL_TIMEOUT_MS = 30_000
let client: Client | null = null
let clientExpiresAt = 0
let toolsCache: { tools: OpenAiTool[]; at: number } | null = null

export function _resetMcpForTests() { client = null; clientExpiresAt = 0; toolsCache = null }

async function getClient(): Promise<Client | null> {
  const url = env().MCP_SERVER_URL
  if (!url) return null
  if (client && clientExpiresAt - 30_000 > Date.now()) return client
  if (client) await client.close().catch(() => undefined)
  const credential = await getMcpCredential()
  const c = new Client({ name: 'clippy-chat', version: '0.2.0' })
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { Authorization: `Bearer ${credential.accessToken}` } },
  })
  await c.connect(transport, { timeout: CONNECT_TIMEOUT_MS })
  client = c
  clientExpiresAt = credential.expiresAt
  return client
}

/** Tool defs in OpenAI `tools` format; [] when MCP is unset or down (chat degrades). */
export async function getMcpTools(): Promise<OpenAiTool[]> {
  if (toolsCache && Date.now() - toolsCache.at < TOOLS_TTL_MS) return toolsCache.tools
  try {
    const c = await getClient()
    if (!c) return []
    const { tools } = await c.listTools(undefined, { timeout: CONNECT_TIMEOUT_MS })
    const mapped = tools.map((t) => ({
      type: 'function' as const,
      function: { name: t.name, description: t.description,
        parameters: (t.inputSchema ?? { type: 'object' }) as Record<string, unknown> },
    }))
    toolsCache = { tools: mapped, at: Date.now() }
    return mapped
  } catch (err) {
    console.error('mcp listTools failed', err)
    client = null // force reconnect next time
    return []
  }
}

/** Execute a tool; always resolves to text (errors become model-readable text). */
export async function callMcpTool(name: string, args: Record<string, unknown>): Promise<string> {
  try {
    const c = await getClient()
    if (!c) return `[tool call failed: MCP not configured]`
    const res = await c.callTool({ name, arguments: args }, undefined, { timeout: TOOL_CALL_TIMEOUT_MS })
    const text = (res.content as Array<{ type: string; text?: string }> | undefined)
      ?.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('\n') ?? ''
    return res.isError ? `[tool error] ${text}` : text
  } catch (err) {
    console.error('mcp callTool failed', name, err)
    client = null
    return `[tool call failed: ${err instanceof Error ? err.message : 'unknown error'}]`
  }
}
