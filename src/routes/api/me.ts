import { createFileRoute } from '@tanstack/react-router'
import { requireUser } from '~/lib/auth/middleware'

export const Route = createFileRoute('/api/me')({
  server: { handlers: {
    GET: async ({ request }) => {
      const u = await requireUser(request)
      return Response.json({ id: u.id, username: u.username, displayName: u.displayName, email: u.email, isAdmin: u.isAdmin })
    },
  } },
})
