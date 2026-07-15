import { createFileRoute } from '@tanstack/react-router'
import { startLogin } from '~/lib/auth/oidc'

export const Route = createFileRoute('/api/auth/login')({
  server: { handlers: {
    GET: async () => {
      const { url, pkceCookie } = await startLogin()
      return new Response(null, { status: 302, headers: { Location: url, 'Set-Cookie': pkceCookie } })
    },
  } },
})
