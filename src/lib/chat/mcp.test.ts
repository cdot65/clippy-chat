import { beforeEach, describe, expect, it, vi } from 'vitest'

const listTools = vi.fn()
const callTool = vi.fn()
const connect = vi.fn()
const { transport } = vi.hoisted(() => ({ transport: vi.fn() }))

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class {
    connect = connect
    listTools = listTools
    callTool = callTool
    close = vi.fn()
  },
}))
vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: transport,
}))
vi.mock('~/lib/env', () => ({ env: () => ({ MCP_SERVER_URL: 'http://mcp:8080/mcp' }) }))
vi.mock('./mcp-auth', () => ({
  getMcpCredential: vi.fn().mockResolvedValue({ accessToken: 'mcp-jwt', expiresAt: Date.now() + 300_000 }),
}))

import { callMcpTool, getMcpTools, _resetMcpForTests } from './mcp'

beforeEach(() => {
  vi.clearAllMocks()
  _resetMcpForTests()
  connect.mockResolvedValue(undefined)
})

describe('getMcpTools', () => {
  it('maps MCP tools to OpenAI format and caches', async () => {
    listTools.mockResolvedValue({ tools: [{ name: 'get_weather', description: 'weather',
      inputSchema: { type: 'object', properties: { location: { type: 'string' } } } }] })
    const tools = await getMcpTools()
    expect(tools).toEqual([{ type: 'function', function: { name: 'get_weather',
      description: 'weather',
      parameters: { type: 'object', properties: { location: { type: 'string' } } } } }])
    await getMcpTools()
    expect(listTools).toHaveBeenCalledTimes(1) // cached
  })
  it('returns [] when server unreachable', async () => {
    connect.mockRejectedValue(new Error('ECONNREFUSED'))
    expect(await getMcpTools()).toEqual([])
  })
  it('bounds connect and listTools with timeouts (hung server must not hang chat)', async () => {
    listTools.mockResolvedValue({ tools: [] })
    await getMcpTools()
    expect(connect.mock.calls[0][1]).toEqual({ timeout: 10_000 })
    expect(listTools.mock.calls[0][1]).toEqual({ timeout: 10_000 })
  })
  it('authenticates every MCP transport with the M2M bearer', async () => {
    listTools.mockResolvedValue({ tools: [] })
    await getMcpTools()

    expect(transport).toHaveBeenCalledWith(new URL('http://mcp:8080/mcp'), {
      requestInit: { headers: { Authorization: 'Bearer mcp-jwt' } },
    })
  })
})

describe('callMcpTool', () => {
  it('joins text content', async () => {
    callTool.mockResolvedValue({ content: [{ type: 'text', text: '{"temp":31}' }] })
    expect(await callMcpTool('get_weather', { location: 'Houston' })).toBe('{"temp":31}')
  })
  it('returns error text instead of throwing', async () => {
    callTool.mockRejectedValue(new Error('boom'))
    expect(await callMcpTool('get_weather', {})).toMatch(/tool call failed/i)
  })
  it('bounds tool execution with a timeout', async () => {
    callTool.mockResolvedValue({ content: [] })
    await callMcpTool('get_weather', {})
    expect(callTool.mock.calls[0][2]).toEqual({ timeout: 30_000 })
  })
})
