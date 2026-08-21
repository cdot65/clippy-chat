import { env } from '~/lib/env'
import { createTokenMinter, type M2mCredential } from './m2m'

export type InferenceCredential = M2mCredential

const minter = createTokenMinter(() => {
  const { INFERENCE_TOKEN_URL, INFERENCE_CLIENT_ID, INFERENCE_CLIENT_SECRET } = env()
  return {
    tokenUrl: INFERENCE_TOKEN_URL, clientId: INFERENCE_CLIENT_ID, clientSecret: INFERENCE_CLIENT_SECRET,
    label: 'inference',
  }
})

export function _resetInferenceAuthForTests() { minter.reset(); warnedPartial = false }

export const getInferenceCredential = (): Promise<InferenceCredential> => minter.get()

let warnedPartial = false

/** True once the Keycloak client is wired. Gateway mode falls back to the
 *  legacy static INFERENCE_API_KEY while this is false, so the deploy that
 *  ships this code does not have to land in the same window as the Keycloak
 *  client and the AIRS registration.
 *
 *  A partial triple means the 1Password item is missing a field — the Secret
 *  is projected per-field, so that reaches the pod as two of three vars. Warn
 *  once and fall back rather than failing: env() is shared, and treating it as
 *  fatal would 500 every route rather than just degrade inference. */
export function hasInferenceClientCredentials(): boolean {
  const { INFERENCE_TOKEN_URL, INFERENCE_CLIENT_ID, INFERENCE_CLIENT_SECRET } = env()
  const parts = [INFERENCE_TOKEN_URL, INFERENCE_CLIENT_ID, INFERENCE_CLIENT_SECRET]
  if (parts.every(Boolean)) return true
  if (parts.some(Boolean) && !warnedPartial) {
    warnedPartial = true
    console.warn('inference Keycloak client is partially configured; falling back to INFERENCE_API_KEY', {
      INFERENCE_TOKEN_URL: Boolean(INFERENCE_TOKEN_URL),
      INFERENCE_CLIENT_ID: Boolean(INFERENCE_CLIENT_ID),
      INFERENCE_CLIENT_SECRET: Boolean(INFERENCE_CLIENT_SECRET),
    })
  }
  return false
}
