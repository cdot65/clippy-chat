import { createFileRoute } from '@tanstack/react-router'
import { requireUser } from '~/lib/auth/middleware'
import { listConversations } from '~/lib/chat/service'

export const Route = createFileRoute('/api/conversations/')({
  server: { handlers: {
    GET: async ({ request }) => Response.json(await listConversations((await requireUser(request)).id)),
  } },
})
