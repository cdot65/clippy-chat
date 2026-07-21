import { expect, it } from 'vitest'
import { coalesceRoles, foldSystem, trimHistory } from './history'

const msg = (role: 'system' | 'user' | 'assistant', content: string) => ({ role, content })

it('keeps system prompt and newest turns within budget', () => {
  const history = [msg('system', 'sys'), ...Array.from({ length: 100 }, (_, i) => msg('user', `q${i} ${'x'.repeat(400)}`))]
  const out = trimHistory(history, 1000) // ~4 chars/token → each msg ≈101 tokens, budget 1000 → only ~9 fit; forces drop
  expect(out[0].role).toBe('system')
  expect(out[out.length - 1].content).toBe(history[history.length - 1].content) // newest kept
  expect(out.length).toBeLessThan(history.length)
})

it('returns all when under budget', () => {
  const history = [msg('system', 's'), msg('user', 'hi'), msg('assistant', 'yo')]
  expect(trimHistory(history, 7000)).toEqual(history)
})

it('trim never leaves a leading assistant turn; fold yields user-first payload', () => {
  const pad = 'x'.repeat(400) // each message ≈101 tokens
  const history = [
    msg('system', 'sys'),
    msg('user', `u1 ${pad}`), msg('assistant', `a1 ${pad}`),
    msg('user', `u2 ${pad}`), msg('assistant', `a2 ${pad}`),
    msg('user', `u3 ${pad}`),
  ]
  // budget (210 - 1 sys) fits exactly two turns walking from newest, so the
  // raw cut would keep [a2, u3] — i.e. start with an assistant turn
  const trimmed = trimHistory(history, 210)
  const nonSystem = trimmed.filter((m) => m.role !== 'system')
  expect(nonSystem[0].role).toBe('user')
  expect(nonSystem[nonSystem.length - 1].content).toBe(history[history.length - 1].content) // newest kept
  const payload = foldSystem(trimmed)
  expect(payload[0].role).toBe('user')
  expect(payload[0].content.startsWith('sys\n\n')).toBe(true)
  expect(payload.some((m) => m.role === 'system')).toBe(false)
  expect(payload.findIndex((m) => m.role === 'user')).toBe(0) // no leading assistant
})

it('foldSystem merges system content into the first user turn', () => {
  const out = foldSystem([msg('system', 'be clippy'), msg('user', 'hi'), msg('assistant', 'yo'), msg('user', 'more')])
  expect(out).toEqual([msg('user', 'be clippy\n\nhi'), msg('assistant', 'yo'), msg('user', 'more')])
})

it('foldSystem is a no-op without a system message', () => {
  const history = [msg('user', 'hi'), msg('assistant', 'yo')]
  expect(foldSystem(history)).toEqual(history)
})

it('coalesceRoles merges consecutive user turns (the concurrent-turn race)', () => {
  // two turns interleave on one conversation: user_A, user_B land before either
  // assistant → DB order is u,u,a,a. Mistral v0.3 rejects the non-alternating
  // payload; coalescing restores strict alternation.
  const out = coalesceRoles([msg('user', 'a'), msg('user', 'b'), msg('assistant', 'c'), msg('assistant', 'd')])
  expect(out).toEqual([msg('user', 'a\n\nb'), msg('assistant', 'c\n\nd')])
})

it('coalesceRoles leaves an already-alternating payload untouched', () => {
  const history = [msg('user', 'u1'), msg('assistant', 'a1'), msg('user', 'u2')]
  expect(coalesceRoles(history)).toEqual(history)
})

it('coalesceRoles collapses a run longer than two', () => {
  const out = coalesceRoles([msg('user', 'a'), msg('user', 'b'), msg('user', 'c')])
  expect(out).toEqual([msg('user', 'a\n\nb\n\nc')])
})

it('coalesceRoles guarantees an alternating payload out of foldSystem', () => {
  // realistic path: history with a duplicated user turn → fold → coalesce
  const payload = coalesceRoles(foldSystem([
    msg('system', 'sys'), msg('user', 'u1'), msg('user', 'u2'), msg('assistant', 'a1'),
  ]))
  expect(payload[0]).toEqual(msg('user', 'sys\n\nu1\n\nu2'))
  const alternates = payload.every((m, i) => i === 0 || m.role !== payload[i - 1].role)
  expect(alternates).toBe(true)
})

it('coalesceRoles handles empty and single-message input', () => {
  expect(coalesceRoles([])).toEqual([])
  expect(coalesceRoles([msg('user', 'hi')])).toEqual([msg('user', 'hi')])
})
