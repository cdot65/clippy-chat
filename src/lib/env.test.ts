import { describe, expect, it } from 'vitest'
import { parseEnv } from './env'

const base = {
  DATABASE_URL: 'postgres://x', APP_URL: 'http://localhost:3000',
  KC_ISSUER: 'https://auth.example.com/realms/myrealm', KC_CLIENT_ID: 'clippy-web',
  KC_CLIENT_SECRET: 's', SESSION_SECRET: 'k'.repeat(44),
  ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'pw',
}

describe('parseEnv', () => {
  it('defaults to the live in-cluster vLLM service', () => {
    const env = parseEnv(base)
    expect(env.VLLM_BASE_URL).toBe('http://vllm-qwen36.vllm.svc.cluster.local:8000')
  })
  it('defaults to the model ID served by vLLM', () => {
    const env = parseEnv(base)
    expect(env.VLLM_MODEL).toBe('qwen36-hauhaucs')
  })
  it('applies the machine-token scope default', () => {
    const env = parseEnv(base)
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
