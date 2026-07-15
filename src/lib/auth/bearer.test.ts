import { SignJWT, generateKeyPair } from 'jose'
import { beforeAll, expect, it } from 'vitest'
import { verifyBearer } from './bearer'

const ISSUER = 'https://auth.example.com/realms/myrealm'
let priv: CryptoKey, pub: CryptoKey

beforeAll(async () => {
  process.env.DATABASE_URL = 'postgres://clippy:clippy@localhost:5433/clippy'
  process.env.APP_URL = 'http://localhost:3000'
  process.env.KC_ISSUER = ISSUER
  process.env.KC_CLIENT_ID = 'x'
  process.env.KC_CLIENT_SECRET = 'x'
  process.env.SESSION_SECRET = 'k'.repeat(44)
  process.env.ADMIN_USERNAME = 'admin-test'
  process.env.ADMIN_PASSWORD = 'boots'
  process.env.M2M_SCOPE = 'clippy-api'
  ;({ privateKey: priv, publicKey: pub } = await generateKeyPair('RS256'))
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
