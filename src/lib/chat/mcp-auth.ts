import { env } from '~/lib/env'

export type McpCredential = { accessToken: string; expiresAt: number }

const EXPIRY_SKEW_MS = 30_000
const TOKEN_TIMEOUT_MS = 10_000
let cached: McpCredential | null = null
let pending: Promise<McpCredential> | null = null

export function _resetMcpAuthForTests() {
  cached = null
  pending = null
}

async function mint(): Promise<McpCredential> {
  const { MCP_TOKEN_URL, MCP_CLIENT_ID, MCP_CLIENT_SECRET } = env()
  if (!MCP_TOKEN_URL || !MCP_CLIENT_ID || !MCP_CLIENT_SECRET)
    throw new Error('MCP client credentials are not configured')

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: MCP_CLIENT_ID,
    client_secret: MCP_CLIENT_SECRET,
  })
  const response = await fetch(MCP_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`MCP token request failed (${response.status})`)
  const value = await response.json().catch(() => null) as unknown
  if (!value || typeof value !== 'object') throw new Error('invalid MCP token response')
  const accessToken = Reflect.get(value, 'access_token')
  const expiresIn = Number(Reflect.get(value, 'expires_in'))
  if (typeof accessToken !== 'string' || !accessToken || !Number.isFinite(expiresIn) || expiresIn <= 0)
    throw new Error('invalid MCP token response')
  return { accessToken, expiresAt: Date.now() + expiresIn * 1000 }
}

export async function getMcpCredential(): Promise<McpCredential> {
  if (cached && cached.expiresAt - EXPIRY_SKEW_MS > Date.now()) return cached
  if (pending) return pending
  pending = mint().then((credential) => (cached = credential)).finally(() => { pending = null })
  return pending
}
