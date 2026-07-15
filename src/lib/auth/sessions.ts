import { randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db } from '~/db/client'
import { sessions } from '~/db/schema'
import { env } from '~/lib/env'
import { decryptJson, encryptJson } from './crypto'

export const SESSION_COOKIE = 'clippy_session'
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7d idle

export type KcTokens = { access_token: string; refresh_token?: string; expires_at?: number }

export async function createSession(userId: string, kcTokens?: KcTokens): Promise<string> {
  const id = randomBytes(32).toString('base64url')
  await db().insert(sessions).values({
    id, userId,
    kcTokens: kcTokens ? { enc: encryptJson(kcTokens, env().SESSION_SECRET, id) } : null,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  })
  return id
}

export async function findSession(id: string) {
  const row = await db().query.sessions.findFirst({ where: eq(sessions.id, id) })
  if (!row) return null
  if (row.expiresAt.getTime() < Date.now()) { await destroySession(id); return null }
  // sliding TTL: touch when less than half remains
  if (row.expiresAt.getTime() - Date.now() < SESSION_TTL_MS / 2)
    await db().update(sessions).set({ expiresAt: new Date(Date.now() + SESSION_TTL_MS) }).where(eq(sessions.id, id))
  const enc = (row.kcTokens as { enc?: string } | null)?.enc
  if (!enc) return { ...row, kcTokens: null }
  try {
    return { ...row, kcTokens: decryptJson<KcTokens>(enc, env().SESSION_SECRET, id) }
  } catch (err) {
    // SESSION_SECRET rotation or tampered/corrupt row: invalidate the session
    // (user re-logs-in) instead of 500ing every request carrying this cookie
    console.error('session token decrypt failed', err)
    await destroySession(id)
    return null
  }
}

export async function updateSessionTokens(id: string, kcTokens: KcTokens) {
  await db().update(sessions).set({ kcTokens: { enc: encryptJson(kcTokens, env().SESSION_SECRET, id) } }).where(eq(sessions.id, id))
}

export async function destroySession(id: string) {
  await db().delete(sessions).where(eq(sessions.id, id))
}

export const secureCookieSuffix = () => env().APP_URL.startsWith('https') ? '; Secure' : ''
export const sessionCookie = (id: string) =>
  `${SESSION_COOKIE}=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}${secureCookieSuffix()}`
export const clearSessionCookie = () => `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureCookieSuffix()}`
export function readSessionCookie(req: Request): string | null {
  const m = (req.headers.get('cookie') ?? '').match(/(?:^|;\s*)clippy_session=([^;]+)/)
  return m ? m[1] : null
}
