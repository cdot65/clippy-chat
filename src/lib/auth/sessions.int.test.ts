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

const created = { userIds: [] as string[] }

afterAll(async () => {
  const { inArray } = await import('drizzle-orm')
  const { db } = await import('~/db/client')
  const { userProfiles } = await import('~/db/schema')
  if (created.userIds.length) {
    await db().delete(userProfiles).where(inArray(userProfiles.id, created.userIds))
  }
})

it('creates, reads, expires, destroys sessions', async () => {
  const { ensureAdminUser } = await import('./bootstrap')
  const { createSession, findSession, destroySession } = await import('./sessions')
  const admin = await ensureAdminUser()
  created.userIds.push(admin.id)
  const id = await createSession(admin.id, { access_token: 'a', refresh_token: 'r' })
  const found = await findSession(id)
  expect(found?.userId).toBe(admin.id)
  expect(found?.kcTokens?.refresh_token).toBe('r')
  await destroySession(id)
  expect(await findSession(id)).toBeNull()
})

it('expired session: findSession returns null and destroys the row', async () => {
  const { randomBytes } = await import('node:crypto')
  const { eq } = await import('drizzle-orm')
  const { db } = await import('~/db/client')
  const { sessions } = await import('~/db/schema')
  const { ensureAdminUser } = await import('./bootstrap')
  const { findSession } = await import('./sessions')
  const admin = await ensureAdminUser()
  created.userIds.push(admin.id)
  const id = randomBytes(32).toString('base64url')
  await db().insert(sessions).values({ id, userId: admin.id, expiresAt: new Date(Date.now() - 1000) })
  expect(await findSession(id)).toBeNull()
  expect(await db().query.sessions.findFirst({ where: eq(sessions.id, id) })).toBeUndefined()
})

it('tampered kc_tokens payload: findSession returns null (not throw) and destroys the row', async () => {
  const { eq } = await import('drizzle-orm')
  const { db } = await import('~/db/client')
  const { sessions } = await import('~/db/schema')
  const { ensureAdminUser } = await import('./bootstrap')
  const { createSession, findSession } = await import('./sessions')
  const admin = await ensureAdminUser()
  created.userIds.push(admin.id)
  const id = await createSession(admin.id, { access_token: 'a' })
  await db().update(sessions)
    .set({ kcTokens: { enc: Buffer.from('not-a-valid-gcm-payload-at-all-really').toString('base64') } })
    .where(eq(sessions.id, id))
  expect(await findSession(id)).toBeNull()
  expect(await db().query.sessions.findFirst({ where: eq(sessions.id, id) })).toBeUndefined()
})

it('cookie helpers', async () => {
  const { readSessionCookie, sessionCookie } = await import('./sessions')
  const header = sessionCookie('abc')
  expect(header).toContain('clippy_session=abc')
  expect(header).toContain('HttpOnly')
  const req = new Request('http://x', { headers: { cookie: 'clippy_session=abc' } })
  expect(readSessionCookie(req)).toBe('abc')
})
