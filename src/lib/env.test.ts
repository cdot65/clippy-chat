import { describe, expect, it } from 'vitest'
import { parseEnv } from './env'

const base = {
  DATABASE_URL: 'postgres://x', APP_URL: 'http://localhost:3000',
  KC_ISSUER: 'https://auth.example.com/realms/myrealm', KC_CLIENT_ID: 'clippy-web',
  KC_CLIENT_SECRET: 's', SESSION_SECRET: 'k'.repeat(44),
  ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'pw',
}

describe('parseEnv', () => {
  it('defaults to the in-cluster AIRS gateway', () => {
    const env = parseEnv(base)
    expect(env.INFERENCE_BASE_URL).toBe('http://airs-gw.airs-gw.svc.cluster.local:80')
  })
  it('defaults to the model ID the gateway serves', () => {
    const env = parseEnv(base)
    expect(env.INFERENCE_MODEL).toBe('@vllm2/unsloth/Qwen3.8-27B-GGUF:UD-Q4_K_XL')
  })
  it('defaults both egress paths to direct so dev and CI keep working', () => {
    const env = parseEnv(base)
    expect(env.INFERENCE_AUTH_MODE).toBe('direct')
    expect(env.MCP_AUTH_MODE).toBe('direct')
  })
  it('rejects gateway inference without a gateway key', () => {
    expect(() => parseEnv({ ...base, INFERENCE_AUTH_MODE: 'gateway' })).toThrow(/INFERENCE_API_KEY/)
    expect(parseEnv({ ...base, INFERENCE_AUTH_MODE: 'gateway', INFERENCE_API_KEY: 'k' }).INFERENCE_AUTH_MODE)
      .toBe('gateway')
  })
  it('rejects an unknown auth mode rather than silently falling back', () => {
    expect(() => parseEnv({ ...base, MCP_AUTH_MODE: 'airs' })).toThrow()
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
    const credentials = {
      MCP_TOKEN_URL: 'https://auth.example.com/token',
      MCP_CLIENT_ID: 'clippy-mcp-client', MCP_CLIENT_SECRET: 'secret',
    }
    expect(parseEnv({ ...base, ...credentials, MCP_SERVER_URL: 'http://mcp:8080/mcp' }).MCP_SERVER_URL)
      .toBe('http://mcp:8080/mcp')
    expect(() => parseEnv({ ...base, ...credentials, MCP_SERVER_URL: 'not-a-url' })).toThrow()
  })
  it('requires MCP client credentials when MCP is enabled', () => {
    expect(() => parseEnv({ ...base, MCP_SERVER_URL: 'http://mcp:8080/mcp' })).toThrow()
    expect(parseEnv({
      ...base,
      MCP_SERVER_URL: 'http://mcp:8080/mcp',
      MCP_TOKEN_URL: 'https://auth.example.com/realms/truffles/protocol/openid-connect/token',
      MCP_CLIENT_ID: 'clippy-mcp-client',
      MCP_CLIENT_SECRET: 'secret',
    }).MCP_CLIENT_ID).toBe('clippy-mcp-client')
  })
})
