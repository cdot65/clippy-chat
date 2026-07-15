import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import { chatStream } from './vllm'

beforeAll(() => {
  process.env.DATABASE_URL = 'postgres://clippy:clippy@localhost:5433/clippy'
  process.env.ADMIN_USERNAME = 'admin-test'
  process.env.ADMIN_PASSWORD = 'boots'
  process.env.APP_URL = 'http://localhost:3000'
  process.env.KC_ISSUER = 'https://auth.example.com/realms/myrealm'
  process.env.KC_CLIENT_ID = 'x'; process.env.KC_CLIENT_SECRET = 'x'
  process.env.SESSION_SECRET = 'k'.repeat(44)
  // env() caches on first call, so set before any chatStream runs; every test
  // in this file therefore sends the auth header (asserted in dedicated test)
  process.env.VLLM_API_KEY = 'test-key'
})

afterEach(() => vi.unstubAllGlobals())

const sse = (lines: string[]) => new Response(
  new ReadableStream({
    start(c) { lines.forEach((l) => c.enqueue(new TextEncoder().encode(`data: ${l}\n\n`))); c.close() },
  }), { status: 200 })

it('yields deltas then usage', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => sse([
    JSON.stringify({ choices: [{ delta: { content: 'Hel' } }] }),
    JSON.stringify({ choices: [{ delta: { content: 'lo' } }] }),
    JSON.stringify({ choices: [], usage: { prompt_tokens: 7, completion_tokens: 2 } }),
    '[DONE]',
  ])))
  const events = []
  for await (const e of chatStream([{ role: 'user', content: 'hi' }])) events.push(e)
  expect(events).toEqual([
    { type: 'delta', content: 'Hel' }, { type: 'delta', content: 'lo' },
    { type: 'usage', promptTokens: 7, completionTokens: 2 },
  ])
})

it('sends bearer auth header when VLLM_API_KEY is set', async () => {
  const fetchMock = vi.fn(async () => sse(['[DONE]']))
  vi.stubGlobal('fetch', fetchMock)
  for await (const _ of chatStream([{ role: 'user', content: 'hi' }])) {}
  const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
  expect((init.headers as Record<string, string>).authorization).toBe('Bearer test-key')
})

it('throws on non-200', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })))
  await expect(async () => { for await (const _ of chatStream([{ role: 'user', content: 'hi' }])) {} })
    .rejects.toThrow(/vllm/i)
})

it('parses a frame fragmented across chunks', async () => {
  const chunks = ['data: {"choi', 'ces":[{"delta":{"content":"Hi"}}]}\n\n']
  vi.stubGlobal('fetch', vi.fn(async () => new Response(
    new ReadableStream({
      start(c) { chunks.forEach((ch) => c.enqueue(new TextEncoder().encode(ch))); c.close() },
    }), { status: 200 })))
  const events = []
  for await (const e of chatStream([{ role: 'user', content: 'hi' }])) events.push(e)
  expect(events).toEqual([{ type: 'delta', content: 'Hi' }])
})
