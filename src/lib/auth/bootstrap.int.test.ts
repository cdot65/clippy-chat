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

it('seeds local admin once, idempotent', async () => {
  const { ensureAdminUser } = await import('./bootstrap')
  const first = await ensureAdminUser()
  created.userIds.push(first.id)
  const second = await ensureAdminUser()
  expect(first.isAdmin).toBe(true)
  expect(first.authProvider).toBe('local')
  expect(second.id).toBe(first.id)
})

it('parallel first boot: both callers resolve to the same row', async () => {
  const { and, eq } = await import('drizzle-orm')
  const { db } = await import('~/db/client')
  const { userProfiles } = await import('~/db/schema')
  const { ensureAdminUser } = await import('./bootstrap')
  // fresh state so both calls miss findFirst and race the insert
  await db().delete(userProfiles).where(
    and(eq(userProfiles.username, 'admin-test'), eq(userProfiles.authProvider, 'local')))
  const results = await Promise.allSettled([ensureAdminUser(), ensureAdminUser()])
  expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled'])
  const [a, b] = results.map((r) => (r as PromiseFulfilledResult<{ id: string }>).value)
  expect(a.id).toBe(b.id)
  created.userIds.push(a.id)
})
