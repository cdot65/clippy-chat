import { createFileRoute } from '@tanstack/react-router'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '~/db/client'
import { userProfiles } from '~/db/schema'
import { ensureBootstrap } from '~/lib/auth/bootstrap'
import { hashPassword, verifyPassword } from '~/lib/auth/password'
import { createSession, sessionCookie } from '~/lib/auth/sessions'

const bodySchema = z.object({ username: z.string().min(1), password: z.string().min(1) })

// Constant-cost dummy verify target for the "user not found" path, so that
// path costs ~one argon2 verify just like the "wrong password" path — avoids
// a username-enumeration timing side-channel. Generated once at module load.
const dummyHash = hashPassword('dummy-password-for-timing-parity')

export const Route = createFileRoute('/api/auth/local-login')({
  server: { handlers: {
    POST: async ({ request }) => {
      await ensureBootstrap()
      const parsed = bodySchema.safeParse(await request.json().catch(() => null))
      if (!parsed.success) return Response.json({ error: 'invalid body' }, { status: 400 })
      const user = await db().query.userProfiles.findFirst({
        where: and(eq(userProfiles.username, parsed.data.username), eq(userProfiles.authProvider, 'local')),
      })
      if (!user?.passwordHash) {
        await verifyPassword(await dummyHash, parsed.data.password)
        return Response.json({ error: 'invalid credentials' }, { status: 401 })
      }
      if (!(await verifyPassword(user.passwordHash, parsed.data.password)))
        return Response.json({ error: 'invalid credentials' }, { status: 401 })
      const sid = await createSession(user.id)
      return Response.json({ ok: true }, { headers: { 'Set-Cookie': sessionCookie(sid) } })
    },
  } },
})
