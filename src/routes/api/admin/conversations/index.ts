import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { requireAdmin } from '~/lib/auth/middleware'
import { adminListConversations } from '~/lib/chat/admin'

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  username: z.string().optional(),
})

export const Route = createFileRoute('/api/admin/conversations/')({
  server: { handlers: {
    GET: async ({ request }) => {
      await requireAdmin(request)
      const url = new URL(request.url)
      const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams))
      if (!parsed.success) return Response.json({ error: 'invalid query' }, { status: 400 })
      return Response.json(await adminListConversations(parsed.data))
    },
  } },
})
