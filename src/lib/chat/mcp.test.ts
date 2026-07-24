import { beforeEach, describe, expect, it, vi } from 'vitest'

const listTools = vi.fn()
const callTool = vi.fn()
const connect = vi.fn()

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class {
    connect = connect
    listTools = listTools
    callTool = callTool
    close = vi.fn()
  },
}))
vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: vi.fn(),
}))
vi.mock('~/lib/env', () => ({ env: () => ({ MCP_SERVER_URL: 'http://mcp:8080/mcp' }) }))

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
})
