import { afterEach, expect, it, vi } from 'vitest'

// env is mocked rather than driven through process.env because the real env()
// caches on first call, which makes per-test auth modes impossible. Schema
// behaviour itself is covered in env.test.ts.
const { envValue } = vi.hoisted(() => ({
  envValue: {
    INFERENCE_BASE_URL: 'http://vllm:8000',
    INFERENCE_MODEL: 'test-model',
    INFERENCE_API_KEY: 'test-key' as string | undefined,
    INFERENCE_AUTH_MODE: 'direct' as 'direct' | 'gateway',
  },
}))
vi.mock('~/lib/env', () => ({ env: () => envValue }))

import { chatStream } from './inference'

afterEach(() => {
  vi.unstubAllGlobals()
  envValue.INFERENCE_API_KEY = 'test-key'
  envValue.INFERENCE_AUTH_MODE = 'direct'
})

const sse = (lines: string[]) => new Response(
  new ReadableStream({
    start(c) { lines.forEach((l) => c.enqueue(new TextEncoder().encode(`data: ${l}\n\n`))); c.close() },
  }), { status: 200 })

const mockSseResponse = (frames: unknown[]) => {
  vi.stubGlobal('fetch', vi.fn(async () => sse([
    ...frames.map((f) => JSON.stringify(f)),
    '[DONE]',
  ])))
}

const collect = async (it: AsyncGenerator<unknown>) => {
  const o = []
  for await (const e of it) o.push(e)
  return o
}

const lastFetchBody = () => {
  const fetchMock = vi.mocked(fetch)
  const [, init] = fetchMock.mock.calls.at(-1) as unknown as [string, RequestInit]
  return init.body as string
}

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

it('sends bearer auth header when INFERENCE_API_KEY is set', async () => {
  const fetchMock = vi.fn(async () => sse(['[DONE]']))
  vi.stubGlobal('fetch', fetchMock)
  for await (const _ of chatStream([{ role: 'user', content: 'hi' }])) {}
  const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
  expect((init.headers as Record<string, string>).authorization).toBe('Bearer test-key')
})

it('sends the portkey gateway key instead of Authorization in gateway mode', async () => {
  envValue.INFERENCE_AUTH_MODE = 'gateway'
  const fetchMock = vi.fn(async () => sse(['[DONE]']))
  vi.stubGlobal('fetch', fetchMock)
  for await (const _ of chatStream([{ role: 'user', content: 'hi' }])) {}
  const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
  const headers = init.headers as Record<string, string>
  expect(headers['x-portkey-api-key']).toBe('test-key')
  // AIRS mints its own upstream Authorization; ours would be forwarded or 401
  expect(headers.authorization).toBeUndefined()
})

it('omits auth entirely when no key is configured', async () => {
  envValue.INFERENCE_API_KEY = undefined
  const fetchMock = vi.fn(async () => sse(['[DONE]']))
  vi.stubGlobal('fetch', fetchMock)
  for await (const _ of chatStream([{ role: 'user', content: 'hi' }])) {}
  const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
  const headers = init.headers as Record<string, string>
  expect(headers.authorization).toBeUndefined()
  expect(headers['x-portkey-api-key']).toBeUndefined()
})

it('throws on non-200', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })))
  await expect(async () => { for await (const _ of chatStream([{ role: 'user', content: 'hi' }])) {} })
    .rejects.toThrow(/inference/i)
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

it('accumulates streamed tool_call deltas and yields one tool_calls event', async () => {
  mockSseResponse([
    { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1',
      function: { name: 'get_weather', arguments: '{"loc' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0,
      function: { arguments: 'ation":"Houston"}' } }] } }] },
    { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
  ])
  const events = await collect(chatStream([{ role: 'user', content: 'weather?' }],
    { tools: [{ type: 'function', function: { name: 'get_weather', parameters: {} } }] }))
  expect(events).toContainEqual({ type: 'tool_calls', calls: [
    { id: 'call_1', name: 'get_weather', arguments: '{"location":"Houston"}' }] })
})

it('omits tools key from request body when no tools given', async () => {
  mockSseResponse([{ choices: [{ delta: { content: 'hi' } }] }])
  await collect(chatStream([{ role: 'user', content: 'hi' }]))
  expect(JSON.parse(lastFetchBody())).not.toHaveProperty('tools')
})
