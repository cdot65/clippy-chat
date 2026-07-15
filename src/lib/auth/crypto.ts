import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

const key = (secret: string) => createHash('sha256').update(secret).digest()

// optional aad binds the ciphertext to a context (e.g. its session id) so a
// blob copied between rows fails authentication on decrypt
export function encryptJson(value: unknown, secret: string, aad?: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(secret), iv)
  if (aad) cipher.setAAD(Buffer.from(aad))
  const enc = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64')
}
export function decryptJson<T>(payload: string, secret: string, aad?: string): T {
  const buf = Buffer.from(payload, 'base64')
  const decipher = createDecipheriv('aes-256-gcm', key(secret), buf.subarray(0, 12))
  if (aad) decipher.setAAD(Buffer.from(aad))
  decipher.setAuthTag(buf.subarray(12, 28))
  return JSON.parse(Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8'))
}
