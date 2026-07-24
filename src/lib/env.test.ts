import { describe, expect, it } from 'vitest'
import { parseEnv } from './env'

const base = {
  DATABASE_URL: 'postgres://x', APP_URL: 'http://localhost:3000',
  KC_ISSUER: 'https://auth.example.com/realms/myrealm', KC_CLIENT_ID: 'clippy-web',
  KC_CLIENT_SECRET: 's', SESSION_SECRET: 'k'.repeat(44),
  ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'pw',
}

describe('parseEnv', () => {
  it('applies defaults', () => {
    const env = parseEnv(base)
    expect(env.VLLM_BASE_URL).toBe('http://vllm.vllm.svc.cluster.local:8000')
    expect(env.VLLM_MODEL).toBe('solidrust/Mistral-7B-Instruct-v0.3-AWQ')
    expect(env.M2M_SCOPE).toBe('clippy-api')
  })
  it('throws on missing required', () => {
    expect(() => parseEnv({})).toThrow()
  })
  it('accepts optional MCP_SERVER_URL', () => {
    expect(parseEnv(base).MCP_SERVER_URL).toBeUndefined()
    expect(parseEnv({ ...base, MCP_SERVER_URL: 'http://mcp:8080/mcp' }).MCP_SERVER_URL)
      .toBe('http://mcp:8080/mcp')
    expect(() => parseEnv({ ...base, MCP_SERVER_URL: 'not-a-url' })).toThrow()
  })
})
