import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { requireAdmin } from '~/lib/auth/middleware'
import { adminGetConversation } from '~/lib/chat/admin'
import { NotFoundError } from '~/lib/chat/service'

export const Route = createFileRoute('/api/admin/conversations/$id')({
  server: { handlers: {
    GET: async ({ request, params }) => {
      await requireAdmin(request)
      if (!z.uuid().safeParse(params.id).success) return Response.json({ error: 'not found' }, { status: 404 })
      try { return Response.json(await adminGetConversation(params.id)) }
      catch (e) { if (e instanceof NotFoundError) return Response.json({ error: 'not found' }, { status: 404 }); throw e }
    },
  } },
})
