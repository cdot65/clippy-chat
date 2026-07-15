import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { requireUser } from '~/lib/auth/middleware'
import { NotFoundError, softDeleteConversation } from '~/lib/chat/service'

const idSchema = z.uuid()

export const Route = createFileRoute('/api/conversations/$id')({
  server: { handlers: {
    DELETE: async ({ request, params }) => {
      const user = await requireUser(request)
      const id = idSchema.safeParse(params.id)
      // malformed id → 404, matching the ownership-hiding not-found semantics
      if (!id.success) return Response.json({ error: 'not found' }, { status: 404 })
      try { await softDeleteConversation(id.data, user.id) }
      catch (e) { if (e instanceof NotFoundError) return Response.json({ error: 'not found' }, { status: 404 }); throw e }
      return Response.json({ ok: true })
    },
  } },
})
