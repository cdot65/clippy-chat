import { createRemoteJWKSet, jwtVerify } from 'jose'
import { env } from '~/lib/env'

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined
function remoteJwks() {
  // During a Keycloak outage each request re-fetches JWKS with up to 5s timeout
  // (no cooldown until first success) — accepted for low m2m volume.
  return (jwks ??= createRemoteJWKSet(new URL(`${env().KC_ISSUER}/protocol/openid-connect/certs`)))
}

export type BearerClaims = { sub: string; username: string }

let warnedUnaudienced = false

/** Audience enforcement is armed by `M2M_AUDIENCE` rather than always-on, so the
 *  realm and the app can be changed in either order without a window where every
 *  machine caller 401s — the same ship-then-enable order inference-auth uses.
 *
 *  The value is not obvious, so check a real token before setting it. `truffles`
 *  issues both a per-service and a per-stack audience: `clippy-mcp-client` gets
 *  `["clippy", "stack-clippy"]`, while `clippy-m2m` — the only client that has
 *  ever authenticated here — gets a bare string `"stack-clippy"`. So `aud` is
 *  present today and `stack-clippy` would enforce immediately; `clippy-api`
 *  needs an audience mapper first but completes the per-service pattern and
 *  fails independently of `scope`.
 *
 *  While unset, `scope` is the only authorization gate and a `clippy-api` token
 *  minted for any other audience in this realm is accepted: warn once per
 *  process so that gap stays visible in the logs. */
function audienceOpts(): { audience?: string; requiredClaims: string[] } {
  const { M2M_AUDIENCE } = env()
  // jose adds `aud` to its presence check whenever `audience` is set; listing it
  // is for the reader, since this file is a security-review artifact.
  if (M2M_AUDIENCE) return { audience: M2M_AUDIENCE, requiredClaims: ['sub', 'scope', 'aud'] }
  if (!warnedUnaudienced) {
    warnedUnaudienced = true
    console.warn('M2M_AUDIENCE unset: machine bearer tokens accepted without an audience check')
  }
  return { requiredClaims: ['sub', 'scope'] }
}

const verifyOpts = () => ({
  issuer: env().KC_ISSUER,
  algorithms: ['RS256'],
  ...audienceOpts(),
})

export function _resetBearerAudienceWarningForTests() { warnedUnaudienced = false }

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
