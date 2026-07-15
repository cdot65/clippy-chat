import { createFileRoute } from '@tanstack/react-router'
import { clearSessionCookie, destroySession, readSessionCookie } from '~/lib/auth/sessions'

export const Route = createFileRoute('/api/auth/logout')({
  server: { handlers: {
    POST: async ({ request }) => {
      const sid = readSessionCookie(request)
      if (sid) await destroySession(sid)
      return Response.json({ ok: true }, { headers: { 'Set-Cookie': clearSessionCookie() } })
    },
  } },
})
