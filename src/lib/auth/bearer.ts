import { createRemoteJWKSet, jwtVerify } from 'jose'
import { env } from '~/lib/env'

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined
function remoteJwks() {
  // During a Keycloak outage each request re-fetches JWKS with up to 5s timeout
  // (no cooldown until first success) — accepted for low m2m volume.
  return (jwks ??= createRemoteJWKSet(new URL(`${env().KC_ISSUER}/protocol/openid-connect/certs`)))
}

export type BearerClaims = { sub: string; username: string }

// `aud` intentionally unchecked pending Task 14 audience-mapper design.
const verifyOpts = () => ({
  issuer: env().KC_ISSUER,
  algorithms: ['RS256'],
  requiredClaims: ['sub', 'scope'],
})

/** keyOverride is for tests only; production uses the realm JWKS. */
export async function verifyBearer(token: string, keyOverride?: CryptoKey): Promise<BearerClaims> {
  const { payload } = keyOverride
    ? await jwtVerify(token, keyOverride, verifyOpts())
    : await jwtVerify(token, remoteJwks(), verifyOpts())
  const scopes = String(payload.scope ?? '').split(' ')
  if (!scopes.includes(env().M2M_SCOPE)) throw new Error(`missing required scope ${env().M2M_SCOPE}`)
  return {
    sub: String(payload.sub),
    username: String(payload.preferred_username ?? payload.azp ?? payload.sub),
  }
}
