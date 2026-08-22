import { SignJWT, generateKeyPair } from 'jose'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'

const ISSUER = 'https://auth.example.com/realms/myrealm'

// env is mocked rather than driven through process.env because the real env()
// caches on first call, which makes it impossible to exercise the audience gate
// in both positions. Schema behaviour itself is covered in env.test.ts.
const { envValue } = vi.hoisted(() => ({
  envValue: {
    KC_ISSUER: 'https://auth.example.com/realms/myrealm',
    M2M_SCOPE: 'clippy-api',
    M2M_AUDIENCE: undefined as string | undefined,
  },
}))
vi.mock('~/lib/env', () => ({ env: () => envValue }))

import { _resetBearerAudienceWarningForTests, verifyBearer } from './bearer'

let priv: CryptoKey, pub: CryptoKey

beforeAll(async () => {
  ;({ privateKey: priv, publicKey: pub } = await generateKeyPair('RS256'))
})

afterEach(() => {
  envValue.M2M_AUDIENCE = undefined
  _resetBearerAudienceWarningForTests()
})

const sign = (claims: Record<string, unknown>) =>
  new SignJWT({ scope: 'clippy-api profile', ...claims })
    .setProtectedHeader({ alg: 'RS256' }).setIssuer(ISSUER)
    .setSubject('svc-sub-1').setExpirationTime('5m').sign(priv)

it('accepts valid client_credentials token', async () => {
  const claims = await verifyBearer(await sign({ preferred_username: 'service-account-clippy-m2m' }), pub)
  expect(claims.sub).toBe('svc-sub-1')
  expect(claims.username).toBe('service-account-clippy-m2m')
})

it('rejects wrong issuer', async () => {
  const bad = await new SignJWT({ scope: 'clippy-api' }).setProtectedHeader({ alg: 'RS256' })
    .setIssuer('https://evil').setSubject('x').setExpirationTime('5m').sign(priv)
  await expect(verifyBearer(bad, pub)).rejects.toThrow()
})

it('rejects missing scope', async () => {
  const bad = await new SignJWT({ scope: 'other' }).setProtectedHeader({ alg: 'RS256' })
    .setIssuer(ISSUER).setSubject('x').setExpirationTime('5m').sign(priv)
  await expect(verifyBearer(bad, pub)).rejects.toThrow(/scope/)
})

it('rejects expired token', async () => {
  const bad = await new SignJWT({ scope: 'clippy-api' }).setProtectedHeader({ alg: 'RS256' })
    .setIssuer(ISSUER).setSubject('x').setExpirationTime('-1s').sign(priv)
  await expect(verifyBearer(bad, pub)).rejects.toThrow()
})

it('rejects HS256-signed token (alg pinned to RS256)', async () => {
  const secret = new TextEncoder().encode('s'.repeat(32))
  const bad = await new SignJWT({ scope: 'clippy-api' }).setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISSUER).setSubject('x').setExpirationTime('5m').sign(secret)
  await expect(verifyBearer(bad, pub)).rejects.toThrow()
})

// Task 14. Until M2M_AUDIENCE is set the scope claim is the only gate, so any
// `clippy-api` token in the realm authenticates here regardless of who it was
// minted for. These four pin both halves of that switch.
it('leaves the audience unchecked while M2M_AUDIENCE is unset', async () => {
  const other = await sign({ aud: 'some-other-service' })
  await expect(verifyBearer(other, pub)).resolves.toMatchObject({ sub: 'svc-sub-1' })
})

it('accepts an aud array containing the configured audience', async () => {
  envValue.M2M_AUDIENCE = 'clippy-api'
  const token = await sign({ aud: ['clippy-api', 'account'] })
  await expect(verifyBearer(token, pub)).resolves.toMatchObject({ sub: 'svc-sub-1' })
})

it('rejects a correctly scoped token minted for another audience', async () => {
  envValue.M2M_AUDIENCE = 'clippy-api'
  const other = await sign({ aud: ['some-other-service', 'account'] })
  await expect(verifyBearer(other, pub)).rejects.toThrow(/aud/)
})

it('rejects a token carrying no aud once the gate is armed', async () => {
  envValue.M2M_AUDIENCE = 'clippy-api'
  await expect(verifyBearer(await sign({}), pub)).rejects.toThrow(/aud/)
})
