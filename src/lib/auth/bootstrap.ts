import { and, eq } from 'drizzle-orm'
import { db } from '~/db/client'
import { isUniqueViolation } from '~/db/errors'
import { userProfiles } from '~/db/schema'
import { env } from '~/lib/env'
import { hashPassword } from './password'

export async function ensureAdminUser() {
  const { ADMIN_USERNAME, ADMIN_PASSWORD } = env()
  const findAdmin = () => db().query.userProfiles.findFirst({
    where: and(eq(userProfiles.username, ADMIN_USERNAME), eq(userProfiles.authProvider, 'local')),
  })
  // NOTE: rotating ADMIN_PASSWORD does NOT update an already-seeded row — the
  // break-glass admin keeps its first-boot password until the row is deleted.
  const existing = await findAdmin()
  if (existing) return existing
  try {
    const [row] = await db().insert(userProfiles).values({
      authProvider: 'local', username: ADMIN_USERNAME,
      passwordHash: await hashPassword(ADMIN_PASSWORD), isAdmin: true,
    }).returning()
    return row
  } catch (err) {
    // lost the cross-replica first-boot race: the partial unique index on
    // local usernames fired — the winner's row is the admin, return it
    if (isUniqueViolation(err)) {
      const winner = await findAdmin()
      if (winner) return winner
    }
    throw err
  }
}

let boot: Promise<unknown> | undefined
export function ensureBootstrap() {
  // clear on rejection so a failed bootstrap retries instead of poisoning the process
  return (boot ??= ensureAdminUser().catch((e) => { boot = undefined; throw e }))
}
