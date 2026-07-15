import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, expect, it } from 'vitest'

beforeAll(() => {
  process.env.DATABASE_URL = 'postgres://clippy:clippy@localhost:5433/clippy'
  process.env.ADMIN_USERNAME = 'admin-test'
  process.env.ADMIN_PASSWORD = 'boots'
  process.env.APP_URL = 'http://localhost:3000'
  process.env.KC_ISSUER = 'https://auth.example.com/realms/myrealm'
  process.env.KC_CLIENT_ID = 'x'
  process.env.KC_CLIENT_SECRET = 'x'
  process.env.SESSION_SECRET = 'k'.repeat(44)
})

const created = { userIds: [] as string[], convoIds: [] as string[] }

afterAll(async () => {
  const { inArray } = await import('drizzle-orm')
  const { db } = await import('./client')
  const { conversations, messages, userProfiles } = await import('./schema')
  // FK-safe order: messages -> conversations -> user_profiles (sessions cascade)
  if (created.convoIds.length) {
    await db().delete(messages).where(inArray(messages.conversationId, created.convoIds))
    await db().delete(conversations).where(inArray(conversations.id, created.convoIds))
  }
  if (created.userIds.length) {
    await db().delete(userProfiles).where(inArray(userProfiles.id, created.userIds))
  }
})

it('logs a conversation with FK-linked messages', async () => {
  const { db } = await import('./client')
  const { conversations, messages, userProfiles } = await import('./schema')
  const [user] = await db().insert(userProfiles)
    .values({ authProvider: 'local', username: `u-${randomUUID()}` }).returning()
  created.userIds.push(user.id)
  const convoId = randomUUID()
  await db().insert(conversations).values({ id: convoId, userId: user.id, model: 'test' })
  created.convoIds.push(convoId)
  const [msg] = await db().insert(messages)
    .values({ conversationId: convoId, role: 'user', content: 'hi' }).returning()
  expect(msg.id).toMatch(/^[0-9a-f-]{36}$/)
  expect(msg.conversationId).toBe(convoId)
})
