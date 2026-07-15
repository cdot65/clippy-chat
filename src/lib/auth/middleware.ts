import { eq } from 'drizzle-orm'
import { db } from '~/db/client'
import { userProfiles } from '~/db/schema'
import { verifyBearer } from './bearer'
import { ensureBootstrap } from './bootstrap'
import { findSession, readSessionCookie } from './sessions'

export type Profile = typeof userProfiles.$inferSelect

export type OidcClaims = { sub: string; preferred_username?: string; email?: string; name?: string }

export async function upsertKeycloakProfile(claims: OidcClaims, isServiceAccount: boolean): Promise<Profile> {
  const values = {
    keycloakSub: claims.sub,
    authProvider: 'keycloak' as const,
    username: claims.preferred_username ?? claims.sub,
    email: claims.email ?? null,
    displayName: claims.name ?? null,
    isServiceAccount,
  }
  const [row] = await db().insert(userProfiles).values(values)
    .onConflictDoUpdate({ target: userProfiles.keycloakSub, set: { ...values, updatedAt: new Date() } })
    .returning()
  return row
}

export async function resolveUser(req: Request): Promise<Profile | null> {
  await ensureBootstrap()
  const auth = req.headers.get('authorization')
  if (auth?.startsWith('Bearer ')) {
    try {
      const claims = await verifyBearer(auth.slice(7))
      return await upsertKeycloakProfile({ sub: claims.sub, preferred_username: claims.username }, true)
    } catch (err) {
      // silent 401s on real JWKS outages are undebuggable otherwise
      console.error('bearer auth failed', err)
      return null
    }
  }
  const sid = readSessionCookie(req)
  if (!sid) return null
  const session = await findSession(sid)
  if (!session) return null
  const row = await db().query.userProfiles.findFirst({ where: eq(userProfiles.id, session.userId) })
  return row ?? null
}

/** Throws a 401 JSON Response for API handlers. */
export async function requireUser(req: Request): Promise<Profile> {
  const user = await resolveUser(req)
  if (!user) throw Response.json({ error: 'unauthorized' }, { status: 401 })
  return user
}

/** Throws 401 (unauthenticated) or 403 (authenticated non-admin) JSON Response. */
export async function requireAdmin(req: Request): Promise<Profile> {
  const user = await requireUser(req)
  if (!user.isAdmin) throw Response.json({ error: 'forbidden' }, { status: 403 })
  return user
}
