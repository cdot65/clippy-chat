import { env } from '~/lib/env'
import { createTokenMinter, type M2mCredential } from './m2m'

export type McpCredential = M2mCredential

const minter = createTokenMinter(() => {
  const { MCP_TOKEN_URL, MCP_CLIENT_ID, MCP_CLIENT_SECRET } = env()
  return {
    tokenUrl: MCP_TOKEN_URL, clientId: MCP_CLIENT_ID, clientSecret: MCP_CLIENT_SECRET,
    label: 'MCP',
  }
})

export function _resetMcpAuthForTests() { minter.reset() }

export const getMcpCredential = (): Promise<McpCredential> => minter.get()
