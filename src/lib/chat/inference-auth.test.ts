import { beforeEach, describe, expect, it, vi } from 'vitest'

const { envValue } = vi.hoisted(() => ({
  envValue: {
    INFERENCE_TOKEN_URL: 'https://auth.example.com/realms/truffles/protocol/openid-connect/token' as string | undefined,
    INFERENCE_CLIENT_ID: 'clippy-inference-client' as string | undefined,
    INFERENCE_CLIENT_SECRET: 'inference-secret' as string | undefined,
  },
}))
vi.mock('~/lib/env', () => ({ env: () => envValue }))

import { _resetInferenceAuthForTests, getInferenceCredential, hasInferenceClientCredentials } from './inference-auth'

beforeEach(() => {
  vi.restoreAllMocks()
  _resetInferenceAuthForTests()
  envValue.INFERENCE_TOKEN_URL = 'https://auth.example.com/realms/truffles/protocol/openid-connect/token'
  envValue.INFERENCE_CLIENT_ID = 'clippy-inference-client'
  envValue.INFERENCE_CLIENT_SECRET = 'inference-secret'
})

describe('getInferenceCredential', () => {
  it('mints client credentials and caches before expiry', async () => {
    const request = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      access_token: 'inference-jwt', expires_in: 300,
    }), { status: 200 }))

    const first = await getInferenceCredential()
    const second = await getInferenceCredential()

    expect(first.accessToken).toBe('inference-jwt')
    expect(second).toEqual(first)
    expect(request).toHaveBeenCalledTimes(1)
    const body = new URLSearchParams(String(request.mock.calls[0][1]?.body))
    expect(body.get('grant_type')).toBe('client_credentials')
    expect(body.get('client_id')).toBe('clippy-inference-client')
  })

  // the inference identity must never carry mcp.invoke: the Security Handoff
  // negative-tests both directions (docs-site/docs/security/overview.mdx)
  it('never requests a scope, so the client default decides the grant', async () => {
    const request = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      access_token: 'inference-jwt', expires_in: 300,
    }), { status: 200 }))

    await getInferenceCredential()

    expect(new URLSearchParams(String(request.mock.calls[0][1]?.body)).get('scope')).toBeNull()
  })

  it('single-flights concurrent callers', async () => {
    const request = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      access_token: 'inference-jwt', expires_in: 300,
    }), { status: 200 }))

    await Promise.all([getInferenceCredential(), getInferenceCredential(), getInferenceCredential()])

    expect(request).toHaveBeenCalledTimes(1)
  })

  it('fails closed on token endpoint errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('denied', { status: 401 }))

    await expect(getInferenceCredential()).rejects.toThrow('inference token request failed')
  })

  it('fails closed when the client is not configured', async () => {
    envValue.INFERENCE_CLIENT_SECRET = undefined

    await expect(getInferenceCredential()).rejects.toThrow('inference client credentials are not configured')
  })
})

describe('hasInferenceClientCredentials', () => {
  it('is true only when the full triple is present', () => {
    expect(hasInferenceClientCredentials()).toBe(true)
    envValue.INFERENCE_CLIENT_SECRET = undefined
    expect(hasInferenceClientCredentials()).toBe(false)
  })

  it('warns once on a partial triple instead of failing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    envValue.INFERENCE_CLIENT_SECRET = undefined

    expect(hasInferenceClientCredentials()).toBe(false)
    expect(hasInferenceClientCredentials()).toBe(false)

    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toMatch(/partially configured/)
  })

  it('stays silent when nothing is configured', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    envValue.INFERENCE_TOKEN_URL = undefined
    envValue.INFERENCE_CLIENT_ID = undefined
    envValue.INFERENCE_CLIENT_SECRET = undefined

    expect(hasInferenceClientCredentials()).toBe(false)
    expect(warn).not.toHaveBeenCalled()
  })
})
