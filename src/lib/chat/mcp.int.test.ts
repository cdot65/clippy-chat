import { afterEach, describe, expect, it, vi } from 'vitest'

// int test: requires `docker compose up -d mcp` (fails without it, like the other *.int.test.ts suites)
vi.mock('~/lib/env', () => ({ env: () => ({ MCP_SERVER_URL: 'http://localhost:8080/mcp' }) }))
import { getMcpTools, callMcpTool, _resetMcpForTests } from './mcp'

afterEach(() => _resetMcpForTests())

describe('mcp integration', () => {
  it('lists all 5 tools in OpenAI format', async () => {
    const tools = await getMcpTools()
    const names = tools.map((t) => t.function.name).sort()
    expect(names).toEqual(['get_current_datetime', 'get_daily_news', 'get_mlb_scores',
      'get_weather', 'polymarket_bets', 'scm_config'])
    for (const t of tools) expect(t.function.parameters).toHaveProperty('type', 'object')
  })

  it('scm_config without creds returns model-readable error, not a throw', async () => {
    const out = await callMcpTool('scm_config', { resource: 'address', action: 'list',
      payload: { folder: 'Texas' } })
    expect(out).toMatch(/SCM|credentials|error/i)
  })
})
