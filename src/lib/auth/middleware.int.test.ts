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

it('resolves session cookie to profile', async () => {
  const { ensureAdminUser } = await import('./bootstrap')
  const { createSession } = await import('./sessions')
  const { resolveUser } = await import('./middleware')
  const admin = await ensureAdminUser()
  created.userIds.push(admin.id)
  const sid = await createSession(admin.id)
  const req = new Request('http://x/api/me', { headers: { cookie: `clippy_session=${sid}` } })
  const user = await resolveUser(req)
  expect(user?.id).toBe(admin.id)
})

it('returns null when unauthenticated', async () => {
  const { resolveUser } = await import('./middleware')
  expect(await resolveUser(new Request('http://x/api/me'))).toBeNull()
})

it('JIT-upserts keycloak profile from claims', async () => {
  const { upsertKeycloakProfile } = await import('./middleware')
  const claims = { sub: `sub-${Date.now()}`, preferred_username: 'calvin', email: 'c@x.io' }
  const a = await upsertKeycloakProfile(claims, false)
  created.userIds.push(a.id)
  const b = await upsertKeycloakProfile(claims, false)
  expect(a.id).toBe(b.id)
  expect(a.authProvider).toBe('keycloak')
})

it('requireAdmin passes for admin, 403s for non-admin', async () => {
  const { ensureAdminUser } = await import('./bootstrap')
  const { createSession } = await import('./sessions')
  const { requireAdmin } = await import('./middleware')
  const admin = await ensureAdminUser()
  created.userIds.push(admin.id)
  const adminSid = await createSession(admin.id)
  const adminReq = new Request('http://x/api/admin/conversations', { headers: { cookie: `clippy_session=${adminSid}` } })
  const u = await requireAdmin(adminReq)
  expect(u.id).toBe(admin.id)

  const { db } = await import('~/db/client')
  const { userProfiles } = await import('~/db/schema')
  const [pleb] = await db().insert(userProfiles)
    .values({ authProvider: 'local', username: `pleb-${Date.now()}` }).returning()
  created.userIds.push(pleb.id)
  const plebSid = await createSession(pleb.id)
  const plebReq = new Request('http://x/api/admin/conversations', { headers: { cookie: `clippy_session=${plebSid}` } })
  const thrown = await requireAdmin(plebReq).then(() => null, (e) => e)
  expect(thrown).toBeInstanceOf(Response)
  expect((thrown as Response).status).toBe(403)
})

it('requireAdmin 401s unauthenticated', async () => {
  const { requireAdmin } = await import('./middleware')
  const thrown = await requireAdmin(new Request('http://x/api/admin/conversations')).then(() => null, (e) => e)
  expect(thrown).toBeInstanceOf(Response)
  expect((thrown as Response).status).toBe(401)
})
