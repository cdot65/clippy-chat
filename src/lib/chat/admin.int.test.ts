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

const created = { userIds: [] as string[], convoIds: [] as string[] }

afterAll(async () => {
  const { db } = await import('~/db/client')
  const { conversations, messages, userProfiles } = await import('~/db/schema')
  const { inArray } = await import('drizzle-orm')
  if (created.convoIds.length) {
    await db().delete(messages).where(inArray(messages.conversationId, created.convoIds))
    await db().delete(conversations).where(inArray(conversations.id, created.convoIds))
  }
  if (created.userIds.length) await db().delete(userProfiles).where(inArray(userProfiles.id, created.userIds))
})

async function seed() {
  const { db } = await import('~/db/client')
  const { userProfiles } = await import('~/db/schema')
  const { ensureConversation, appendMessage, softDeleteConversation } = await import('./service')
  const [u] = await db().insert(userProfiles)
    .values({ authProvider: 'local', username: `adm-t-${randomUUID().slice(0, 8)}` }).returning()
  created.userIds.push(u.id)
  const active = randomUUID(); const deleted = randomUUID()
  created.convoIds.push(active, deleted)
  await ensureConversation(active, u.id, 'active convo')
  await appendMessage(active, 'user', 'hi')
  await appendMessage(active, 'assistant', 'hello!', { promptTokens: 5, completionTokens: 2 })
  await ensureConversation(deleted, u.id, 'deleted convo')
  await softDeleteConversation(deleted, u.id)
  return { u, active, deleted }
}

it('adminListConversations returns all incl deleted, with owner + aggregates', async () => {
  const { adminListConversations } = await import('./admin')
  const { u, active, deleted } = await seed()
  const { rows, total, page, pageSize } = await adminListConversations({ page: 1, username: u.username })
  expect(page).toBe(1)
  expect(pageSize).toBe(50)
  expect(total).toBe(2)
  const ids = rows.map((r) => r.id)
  expect(ids).toContain(active)
  expect(ids).toContain(deleted)
  const a = rows.find((r) => r.id === active)!
  expect(a.owner.username).toBe(u.username)
  expect(a.messageCount).toBe(3) // system + user + assistant
  expect(a.promptTokens).toBe(5)
  expect(a.completionTokens).toBe(2)
  const d = rows.find((r) => r.id === deleted)!
  expect(d.deletedAt).not.toBeNull()
})

it('adminGetConversation returns full transcript incl system row; NotFound on unknown', async () => {
  const { adminGetConversation } = await import('./admin')
  const { NotFoundError } = await import('./service')
  const { u, active } = await seed()
  const detail = await adminGetConversation(active)
  expect(detail.conversation.id).toBe(active)
  expect(detail.owner?.username).toBe(u.username)
  expect(detail.messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant'])
  expect(detail.messages[0].content).toMatch(/Clippy/)
  await expect(adminGetConversation(randomUUID())).rejects.toThrow(NotFoundError)
})
