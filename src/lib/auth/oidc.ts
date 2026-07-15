import * as client from 'openid-client'
import { env } from '~/lib/env'
import { secureCookieSuffix } from './sessions'

let config: Promise<client.Configuration> | undefined
export function oidcConfig() {
  // clear on rejection so a Keycloak blip at first login doesn't poison every
  // later attempt until pod restart (same pattern as ensureBootstrap)
  return (config ??= client.discovery(new URL(env().KC_ISSUER), env().KC_CLIENT_ID, env().KC_CLIENT_SECRET)
    .catch((e) => { config = undefined; throw e }))
}

export const PKCE_COOKIE = 'clippy_pkce'

export async function startLogin(): Promise<{ url: string; pkceCookie: string }> {
  const cfg = await oidcConfig()
  const verifier = client.randomPKCECodeVerifier()
  const state = client.randomState()
  const url = client.buildAuthorizationUrl(cfg, {
    redirect_uri: `${env().APP_URL}/api/auth/callback`,
    scope: 'openid profile email',
    code_challenge: await client.calculatePKCECodeChallenge(verifier),
    code_challenge_method: 'S256',
    state,
  })
  const payload = Buffer.from(JSON.stringify({ verifier, state })).toString('base64url')
  return { url: url.href, pkceCookie: `${PKCE_COOKIE}=${payload}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${secureCookieSuffix()}` }
}

export const clearPkceCookie = () =>
  `${PKCE_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureCookieSuffix()}`

export function readPkceCookie(req: Request): string | null {
  const m = (req.headers.get('cookie') ?? '').match(/(?:^|;\s*)clippy_pkce=([^;]+)/)
  return m ? m[1] : null
}

export async function handleCallback(requestUrl: URL, pkceCookieValue: string) {
  const cfg = await oidcConfig()
  const { verifier, state } = JSON.parse(Buffer.from(pkceCookieValue, 'base64url').toString())
  const tokens = await client.authorizationCodeGrant(cfg, requestUrl, {
    pkceCodeVerifier: verifier, expectedState: state,
  })
  const claims = tokens.claims() // sub, preferred_username, email, name
  if (!claims) throw new Error('no id token in token response')
  return { tokens, claims }
}

export async function refreshTokens(refreshToken: string) {
  return client.refreshTokenGrant(await oidcConfig(), refreshToken)
}
