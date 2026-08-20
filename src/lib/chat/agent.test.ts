import { beforeEach, describe, expect, it, vi } from 'vitest'

const getMcpTools = vi.fn()
const callMcpTool = vi.fn()
vi.mock('./mcp', () => ({ getMcpTools: (...a: unknown[]) => getMcpTools(...a),
  callMcpTool: (...a: unknown[]) => callMcpTool(...a) }))
const chatStream = vi.fn()
// hoisted with the vi.mock factory — a plain class decl would be in the TDZ there
const { InferenceError } = vi.hoisted(() => ({
  InferenceError: class InferenceError extends Error {
    constructor(readonly status: number, readonly body: string) { super(`inference error: ${status} ${body}`) }
  },
}))
vi.mock('./inference', () => ({ chatStream: (...a: unknown[]) => chatStream(...a), InferenceError }))

import { agentStream } from './agent'

beforeEach(() => { vi.clearAllMocks() })

const gen = (events: unknown[]) => (async function* () { yield* events as never[] })()
const collect = async (it: AsyncGenerator<unknown>) => { const o = []; for await (const e of it) o.push(e); return o }
const WEATHER_TOOL = { type: 'function', function: { name: 'get_weather', parameters: {} } }

describe('agentStream', () => {
  it('passes through when model makes no tool calls', async () => {
    getMcpTools.mockResolvedValue([WEATHER_TOOL])
    chatStream.mockReturnValueOnce(gen([{ type: 'delta', content: 'hi' }]))
    const out = await collect(agentStream([{ role: 'user', content: 'hi' }]))
    expect(out).toEqual([{ type: 'delta', content: 'hi' }])
  })

  it('executes tool calls, feeds results back, streams final answer', async () => {
    getMcpTools.mockResolvedValue([WEATHER_TOOL])
    callMcpTool.mockResolvedValue('{"temperature_c":31}')
    chatStream
      .mockReturnValueOnce(gen([{ type: 'tool_calls', calls: [
        { id: 'c1', name: 'get_weather', arguments: '{"location":"Houston"}' }] }]))
      .mockReturnValueOnce(gen([{ type: 'delta', content: "It's 31C" }]))
    const out = await collect(agentStream([{ role: 'user', content: 'weather?' }]))
    expect(out).toContainEqual({ type: 'tool_use', name: 'get_weather' })
    expect(out).toContainEqual({ type: 'delta', content: "It's 31C" })
    expect(callMcpTool).toHaveBeenCalledWith('get_weather', { location: 'Houston' })
    const secondMsgs = chatStream.mock.calls[1][0] as Array<{ role: string }>
    expect(secondMsgs.at(-1)?.role).toBe('tool')
  })

  it('stops tool loop after 5 rounds (final round has no tools)', async () => {
    getMcpTools.mockResolvedValue([WEATHER_TOOL])
    callMcpTool.mockResolvedValue('{}')
    const toolRound = () => gen([{ type: 'tool_calls', calls: [
      { id: 'x', name: 'get_weather', arguments: '{}' }] }])
    chatStream
      .mockReturnValueOnce(toolRound()).mockReturnValueOnce(toolRound())
      .mockReturnValueOnce(toolRound()).mockReturnValueOnce(toolRound())
      .mockReturnValueOnce(gen([{ type: 'delta', content: 'final' }]))
    const out = await collect(agentStream([{ role: 'user', content: 'x' }]))
    expect(out.filter((e) => (e as { type: string }).type === 'delta')).toHaveLength(1)
    expect((chatStream.mock.calls[4][1] as { tools?: unknown[] }).tools).toBeUndefined()
  })

  it('retries without tools when vllm 400s the tools payload', async () => {
    getMcpTools.mockResolvedValue([WEATHER_TOOL])
    vi.spyOn(console, 'error').mockImplementation(() => {})
    chatStream
      .mockImplementationOnce(() => { throw new InferenceError(400, '"auto" tool choice requires --enable-auto-tool-choice') })
      .mockReturnValueOnce(gen([{ type: 'delta', content: 'hi there' }]))
    const out = await collect(agentStream([{ role: 'user', content: 'hi' }]))
    expect(out).toEqual([{ type: 'delta', content: 'hi there' }])
    expect((chatStream.mock.calls[1][1] as { tools?: unknown[] }).tools).toBeUndefined()
  })

  it('does not retry a 400 raised after output was already streamed', async () => {
    getMcpTools.mockResolvedValue([WEATHER_TOOL])
    chatStream.mockReturnValueOnce((async function* () {
      yield { type: 'delta', content: 'partial' }
      throw new InferenceError(400, 'boom')
    })())
    await expect(collect(agentStream([{ role: 'user', content: 'hi' }]))).rejects.toThrow(/inference/i)
    expect(chatStream).toHaveBeenCalledTimes(1)
  })

  it('propagates non-400 inference errors instead of masking them as a plain answer', async () => {
    getMcpTools.mockResolvedValue([WEATHER_TOOL])
    chatStream.mockImplementationOnce(() => { throw new InferenceError(503, 'upstream down') })
    await expect(collect(agentStream([{ role: 'user', content: 'hi' }]))).rejects.toThrow(/503/)
    expect(chatStream).toHaveBeenCalledTimes(1)
  })

  it('caps oversized tool results before feeding them back', async () => {
    getMcpTools.mockResolvedValue([WEATHER_TOOL])
    callMcpTool.mockResolvedValue('x'.repeat(20_000))
    chatStream
      .mockReturnValueOnce(gen([{ type: 'tool_calls', calls: [
        { id: 'c1', name: 'get_weather', arguments: '{}' }] }]))
      .mockReturnValueOnce(gen([{ type: 'delta', content: 'ok' }]))
    await collect(agentStream([{ role: 'user', content: 'x' }]))
    const fedBack = (chatStream.mock.calls[1][0] as Array<{ content: string }>).at(-1)!.content
    expect(fedBack.length).toBeLessThan(5000)
    expect(fedBack).toContain('[truncated 16000 characters]')
  })

  it('sends malformed tool arguments as error text, not a crash', async () => {
    getMcpTools.mockResolvedValue([WEATHER_TOOL])
    chatStream
      .mockReturnValueOnce(gen([{ type: 'tool_calls', calls: [
        { id: 'c1', name: 'get_weather', arguments: '{not json' }] }]))
      .mockReturnValueOnce(gen([{ type: 'delta', content: 'sorry' }]))
    const out = await collect(agentStream([{ role: 'user', content: 'x' }]))
    expect(callMcpTool).not.toHaveBeenCalled()
    expect(out).toContainEqual({ type: 'delta', content: 'sorry' })
  })
})
