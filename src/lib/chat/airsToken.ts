import { env } from '~/lib/env'

let cached: { token: string; expiresAt: number } | undefined

async function mintToken(): Promise<{ token: string; expiresAt: number }> {
  const res = await fetch(`${env().KC_ISSUER}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: env().AIRS_KC_CLIENT_ID,
      client_secret: env().AIRS_KC_CLIENT_SECRET,
      scope: env().AIRS_KC_SCOPE,
    }),
  })
  if (!res.ok) throw new Error(`airs token mint failed: ${res.status} ${await res.text().catch(() => '')}`)
  const body = await res.json()
  // refresh ~30s early so a request never races an about-to-expire token;
  // Keycloak m2m tokens are often short-lived (e.g. 300s) — same margin as redteam/clippy_redteam_adapter.py
  const ttlMs = Math.max(Number(body.expires_in ?? 300) - 30, 30) * 1000
  return { token: body.access_token, expiresAt: Date.now() + ttlMs }
}

/** Cached Keycloak client_credentials JWT sent as the AI Gateway's Bearer token. */
export async function getAirsToken(): Promise<string> {
  if (!cached || Date.now() >= cached.expiresAt) cached = await mintToken()
  return cached.token
}
