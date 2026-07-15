import { createFileRoute } from '@tanstack/react-router'
import { upsertKeycloakProfile, type OidcClaims } from '~/lib/auth/middleware'
import { clearPkceCookie, handleCallback, readPkceCookie } from '~/lib/auth/oidc'
import { createSession, sessionCookie } from '~/lib/auth/sessions'
import { env } from '~/lib/env'

export const Route = createFileRoute('/api/auth/callback')({
  server: { handlers: {
    GET: async ({ request }) => {
      const pkce = readPkceCookie(request)
      if (!pkce) return new Response('missing pkce cookie', { status: 400 })
      // Behind a TLS-terminating reverse proxy request.url is http://; openid-client derives
      // redirect_uri from this URL at token exchange, so rebuild it against APP_URL
      // or Keycloak rejects the grant with invalid_grant "Incorrect redirect_uri".
      const reqUrl = new URL(request.url)
      const callbackUrl = new URL(reqUrl.pathname + reqUrl.search, env().APP_URL)
      let result: Awaited<ReturnType<typeof handleCallback>>
      try {
        result = await handleCallback(callbackUrl, pkce)
      } catch (err) {
        // tampered cookie JSON, state mismatch, denied consent, expired code, etc:
        // all IdP/user-input failures — must not 500
        console.error('oidc callback failed', err)
        return new Response('authentication failed', { status: 400 })
      }
      const { tokens, claims } = result
      const profile = await upsertKeycloakProfile(claims as unknown as OidcClaims, false)
      const sid = await createSession(profile.id, {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: Date.now() + (tokens.expires_in ?? 300) * 1000,
      })
      const headers = new Headers({ Location: '/' })
      headers.append('Set-Cookie', sessionCookie(sid))
      headers.append('Set-Cookie', clearPkceCookie())
      return new Response(null, { status: 302, headers })
    },
  } },
})
