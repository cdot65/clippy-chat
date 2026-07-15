import { afterAll, beforeAll, expect, it, vi } from 'vitest'

beforeAll(() => {
  process.env.DATABASE_URL = 'postgres://clippy:clippy@localhost:5433/clippy'
  process.env.ADMIN_USERNAME = 'admin-test'
  process.env.ADMIN_PASSWORD = 'boots'
  process.env.APP_URL = 'http://localhost:3000'
  process.env.KC_ISSUER = 'https://auth.example.com/realms/myrealm'
  process.env.KC_CLIENT_ID = 'x'; process.env.KC_CLIENT_SECRET = 'x'
  process.env.SESSION_SECRET = 'k'.repeat(44)
})

vi.mock('./bearer', () => ({
  verifyBearer: vi.fn().mockResolvedValue({ sub: 'svc-1', username: 'svc' }),
}))

const created = { userIds: [] as string[] }

afterAll(async () => {
  const { inArray } = await import('drizzle-orm')
  const { db } = await import('~/db/client')
  const { userProfiles } = await import('~/db/schema')
  if (created.userIds.length) {
    await db().delete(userProfiles).where(inArray(userProfiles.id, created.userIds))
  }
})

it('resolveUser: bearer branch JIT-upserts a service account profile', async () => {
  const { resolveUser } = await import('./middleware')
  const req = new Request('http://x', { headers: { authorization: 'Bearer tok' } })
  const user = await resolveUser(req)
  expect(user).not.toBeNull()
  created.userIds.push(user!.id)
  expect(user!.username).toBe('svc')
  expect(user!.isServiceAccount).toBe(true)
  expect(user!.keycloakSub).toBe('svc-1')
})
