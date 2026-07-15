import { expect, it } from 'vitest'
import { hashPassword, verifyPassword } from './password'

it('verifies correct password, rejects wrong', async () => {
  const hash = await hashPassword('s3cret')
  expect(await verifyPassword(hash, 's3cret')).toBe(true)
  expect(await verifyPassword(hash, 'nope')).toBe(false)
})
