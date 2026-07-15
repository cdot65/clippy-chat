import { expect, it } from 'vitest'
import { decryptJson, encryptJson } from './crypto'

it('round-trips json with aes-gcm', () => {
  const key = 'k'.repeat(44)
  const out = decryptJson(encryptJson({ a: 1 }, key), key)
  expect(out).toEqual({ a: 1 })
})

it('aad binds ciphertext to context: wrong aad throws', () => {
  const key = 'k'.repeat(44)
  const payload = encryptJson({ a: 1 }, key, 'session-1')
  expect(decryptJson(payload, key, 'session-1')).toEqual({ a: 1 })
  expect(() => decryptJson(payload, key, 'session-2')).toThrow()
})
