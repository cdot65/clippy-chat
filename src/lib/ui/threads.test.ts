import { expect, it } from 'vitest'
import { groupThreads, snippet, threadTime } from './threads'

// local-time reference: Monday 2026-07-13 14:30
const now = new Date(2026, 6, 13, 14, 30)
const at = (y: number, mo: number, d: number, h = 9, mi = 5) => new Date(y, mo, d, h, mi).toISOString()

it('threadTime renders HH:MM for today and yesterday', () => {
  expect(threadTime(at(2026, 6, 13, 9, 41), now)).toBe('09:41')
  expect(threadTime(at(2026, 6, 12, 17, 20), now)).toBe('17:20')
})

it('threadTime renders lowercase month + day for earlier this year', () => {
  expect(threadTime(at(2026, 6, 8), now)).toBe('jul 8')
  expect(threadTime(at(2026, 0, 2), now)).toBe('jan 2')
})

it('threadTime appends the year for other years', () => {
  expect(threadTime(at(2025, 11, 31, 23, 59), now)).toBe('dec 31 2025')
})

it('threadTime treats calendar days, not 24h windows', () => {
  // 23:50 yesterday is <24h ago but still "yesterday" → HH:MM
  expect(threadTime(at(2026, 6, 12, 23, 50), now)).toBe('23:50')
  // two calendar days back, even if close in hours, is "earlier"
  expect(threadTime(at(2026, 6, 11, 23, 50), now)).toBe('jul 11')
})

it('groupThreads buckets by calendar day and drops empty groups', () => {
  const convos = [
    { id: 'a', updatedAt: at(2026, 6, 13, 9, 41) },
    { id: 'b', updatedAt: at(2026, 6, 13, 8, 15) },
    { id: 'c', updatedAt: at(2026, 6, 12, 17, 20) },
    { id: 'd', updatedAt: at(2026, 6, 8) },
  ]
  const groups = groupThreads(convos, now)
  expect(groups.map((g) => g.label)).toEqual(['Today', 'Yesterday', 'Earlier'])
  expect(groups[0].items.map((c) => c.id)).toEqual(['a', 'b'])
  expect(groups[1].items.map((c) => c.id)).toEqual(['c'])
  expect(groups[2].items.map((c) => c.id)).toEqual(['d'])
})

it('groupThreads omits absent buckets and preserves input order', () => {
  const convos = [
    { id: 'x', updatedAt: at(2026, 5, 30) },
    { id: 'y', updatedAt: at(2026, 5, 2) },
  ]
  const groups = groupThreads(convos, now)
  expect(groups.map((g) => g.label)).toEqual(['Earlier'])
  expect(groups[0].items.map((c) => c.id)).toEqual(['x', 'y'])
})

it('groupThreads of empty list is empty', () => {
  expect(groupThreads([], now)).toEqual([])
})

it('snippet prefixes speaker and collapses whitespace', () => {
  expect(snippet('assistant', 'Bold.\nI clipped it.')).toBe('clippy: Bold. I clipped it.')
  expect(snippet('user', '  good   enough,\tshipping it ')).toBe('you: good enough, shipping it')
})
