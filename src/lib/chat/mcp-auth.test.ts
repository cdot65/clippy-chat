import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('~/lib/env', () => ({ env: () => ({
  MCP_TOKEN_URL: 'https://auth.example.com/realms/truffles/protocol/openid-connect/token',
  MCP_CLIENT_ID: 'clippy-mcp-client',
  MCP_CLIENT_SECRET: 'mcp-secret',
}) }))

import { _resetMcpAuthForTests, getMcpCredential } from './mcp-auth'

beforeEach(() => {
  vi.restoreAllMocks()
  _resetMcpAuthForTests()
})

describe('getMcpCredential', () => {
  it('mints client credentials and caches before expiry', async () => {
    const request = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      access_token: 'mcp-jwt', expires_in: 300,
    }), { status: 200 }))

    const first = await getMcpCredential()
    const second = await getMcpCredential()

    expect(first.accessToken).toBe('mcp-jwt')
    expect(second).toEqual(first)
    expect(request).toHaveBeenCalledTimes(1)
    const [url, init] = request.mock.calls[0]
    expect(url).toBe('https://auth.example.com/realms/truffles/protocol/openid-connect/token')
    expect(init?.method).toBe('POST')
    const body = new URLSearchParams(String(init?.body))
    expect(body.get('grant_type')).toBe('client_credentials')
    expect(body.get('client_id')).toBe('clippy-mcp-client')
    expect(body.get('client_secret')).toBe('mcp-secret')
  })

  it('fails closed on token endpoint errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('denied', { status: 401 }))

    await expect(getMcpCredential()).rejects.toThrow('MCP token request failed')
  })

  it('fails closed on malformed token responses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }))

    await expect(getMcpCredential()).rejects.toThrow('invalid MCP token response')
  })
})
