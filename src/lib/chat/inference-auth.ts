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

export function _resetInferenceAuthForTests() { minter.reset() }

export const getInferenceCredential = (): Promise<InferenceCredential> => minter.get()

/** True once the Keycloak client is wired. Gateway mode falls back to the
 *  legacy static INFERENCE_API_KEY while this is false, so the deploy that
 *  ships this code does not have to land in the same window as the Keycloak
 *  client and the AIRS registration. */
export function hasInferenceClientCredentials(): boolean {
  const { INFERENCE_TOKEN_URL, INFERENCE_CLIENT_ID, INFERENCE_CLIENT_SECRET } = env()
  return Boolean(INFERENCE_TOKEN_URL && INFERENCE_CLIENT_ID && INFERENCE_CLIENT_SECRET)
}
