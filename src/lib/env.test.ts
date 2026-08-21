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
  it('rejects gateway inference without a gateway credential', () => {
    expect(() => parseEnv({ ...base, INFERENCE_AUTH_MODE: 'gateway' })).toThrow(/INFERENCE_API_KEY/)
    expect(parseEnv({ ...base, INFERENCE_AUTH_MODE: 'gateway', INFERENCE_API_KEY: 'k' }).INFERENCE_AUTH_MODE)
      .toBe('gateway')
  })

  const inferenceClient = {
    INFERENCE_TOKEN_URL: 'https://auth.example.com/token',
    INFERENCE_CLIENT_ID: 'clippy-inference-client',
    INFERENCE_CLIENT_SECRET: 'secret',
  }

  it('accepts the Keycloak client as the gateway credential without a static key', () => {
    expect(parseEnv({ ...base, INFERENCE_AUTH_MODE: 'gateway', ...inferenceClient }).INFERENCE_CLIENT_ID)
      .toBe('clippy-inference-client')
  })

  // the 1Password item projects field-by-field, so a missing field reaches the
  // pod as a partial triple. env() is shared: throwing here 500s every route.
  it('tolerates a half-configured inference client so the app stays up', () => {
    const { INFERENCE_CLIENT_SECRET: _omitted, ...partial } = inferenceClient
    expect(() => parseEnv({ ...base, INFERENCE_AUTH_MODE: 'gateway', INFERENCE_API_KEY: 'k', ...partial }))
      .not.toThrow()
  })

  it('still rejects gateway mode when a partial client is the only credential', () => {
    const { INFERENCE_CLIENT_SECRET: _omitted, ...partial } = inferenceClient
    expect(() => parseEnv({ ...base, INFERENCE_AUTH_MODE: 'gateway', ...partial })).toThrow()
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
