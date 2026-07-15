import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, expect, it } from 'vitest'

beforeAll(() => {
  process.env.DATABASE_URL = 'postgres://clippy:clippy@localhost:5433/clippy'
  process.env.ADMIN_USERNAME = 'admin-test'
  process.env.ADMIN_PASSWORD = 'boots'
  process.env.APP_URL = 'http://localhost:3000'
  process.env.KC_ISSUER = 'https://auth.example.com/realms/myrealm'
  process.env.KC_CLIENT_ID = 'x'; process.env.KC_CLIENT_SECRET = 'x'
  process.env.SESSION_SECRET = 'k'.repeat(44)
})

const created = { userIds: [] as string[], conversationIds: [] as string[] }

afterAll(async () => {
  const { inArray } = await import('drizzle-orm')
  const { db } = await import('~/db/client')
  const { userProfiles, conversations, messages } = await import('~/db/schema')
  if (created.conversationIds.length) {
    await db().delete(messages).where(inArray(messages.conversationId, created.conversationIds))
    await db().delete(conversations).where(inArray(conversations.id, created.conversationIds))
  }
  if (created.userIds.length) {
    await db().delete(userProfiles).where(inArray(userProfiles.id, created.userIds))
  }
})

async function user() {
  const { db } = await import('~/db/client'); const { userProfiles } = await import('~/db/schema')
  const [u] = await db().insert(userProfiles).values({ authProvider: 'local', username: `u-${randomUUID()}` }).returning()
  created.userIds.push(u.id)
  return u
}

it('ensureConversation creates convo + system row, sets title, is idempotent', async () => {
  const { ensureConversation } = await import('./service')
  const u = await user(); const id = randomUUID()
  created.conversationIds.push(id)
  const c1 = await ensureConversation(id, u.id, 'Hello Clippy, how are paperclips made?')
  expect(c1.title).toBe('Hello Clippy, how are paperclips made?')
  const c2 = await ensureConversation(id, u.id, 'second message')
  expect(c2.title).toBe(c1.title) // unchanged
})

it('ensureConversation rejects other users convo', async () => {
  const { ensureConversation } = await import('./service')
  const a = await user(); const b = await user(); const id = randomUUID()
  created.conversationIds.push(id)
  await ensureConversation(id, a.id, 'mine')
  await expect(ensureConversation(id, b.id, 'steal')).rejects.toThrow(/not found/i)
})

it('concurrent first-message race: both fulfill with same convo, one system row', async () => {
  const { ensureConversation } = await import('./service')
  const { sql } = await import('drizzle-orm')
  const { db: db2 } = await import('~/db/client')
  const u = await user(); const id = randomUUID()
  created.conversationIds.push(id)
  // warm two pool connections so both racers' lookups run truly concurrently
  // (a cold second connection otherwise lags behind the first racer's commit)
  await Promise.all([db2().execute(sql`select 1`), db2().execute(sql`select 1`)])
  const results = await Promise.allSettled([
    ensureConversation(id, u.id, 'a'),
    ensureConversation(id, u.id, 'b'),
  ])
  expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled'])
  const [a, b] = results.map((r) => (r as PromiseFulfilledResult<{ id: string }>).value)
  expect(a.id).toBe(id)
  expect(b.id).toBe(id)
  const { and, eq } = await import('drizzle-orm')
  const { db } = await import('~/db/client')
  const { messages } = await import('~/db/schema')
  const systemRows = await db().query.messages.findMany({
    where: and(eq(messages.conversationId, id), eq(messages.role, 'system')),
  })
  expect(systemRows.length).toBe(1)
})

it('listConversations carries model and last non-system message, capped and isolated', async () => {
  const { ensureConversation, listConversations, appendMessage } = await import('./service')
  const u = await user()
  const id = randomUUID(); const other = randomUUID()
  created.conversationIds.push(id, other)
  await ensureConversation(id, u.id, 'hi') // only the system row exists
  let row = (await listConversations(u.id)).find((c) => c.id === id)!
  expect(row.model).toBeTruthy()
  expect(row.lastMessage).toBeNull() // system prompt never leaks into the sidebar
  await appendMessage(id, 'user', 'first question')
  await appendMessage(id, 'assistant', 'y'.repeat(200))
  await ensureConversation(other, u.id, 'noise')
  await appendMessage(other, 'user', 'unrelated message')
  row = (await listConversations(u.id)).find((c) => c.id === id)!
  expect(row.lastMessage).toEqual({ role: 'assistant', content: 'y'.repeat(120) })
  const otherRow = (await listConversations(u.id)).find((c) => c.id === other)!
  expect(otherRow.lastMessage).toEqual({ role: 'user', content: 'unrelated message' })
})

it('list/messages/softDelete respect ownership + deletion', async () => {
  const { ensureConversation, listConversations, listMessages, appendMessage, softDeleteConversation } = await import('./service')
  const u = await user(); const id = randomUUID()
  created.conversationIds.push(id)
  await ensureConversation(id, u.id, 'hi')
  await appendMessage(id, 'user', 'hi')
  await appendMessage(id, 'assistant', 'hello!', { promptTokens: 5, completionTokens: 2 })
  expect((await listConversations(u.id)).map((c) => c.id)).toContain(id)
  const msgs = await listMessages(id, u.id)
  expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant']) // system excluded
  await softDeleteConversation(id, u.id)
  expect((await listConversations(u.id)).map((c) => c.id)).not.toContain(id)
  await expect(listMessages(id, u.id)).rejects.toThrow(/not found/i)
})
