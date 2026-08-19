import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRootRoute, HeadContent, Outlet, Scripts } from '@tanstack/react-router'
import { useState } from 'react'
import appCss from '~/styles.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [{ charSet: 'utf-8' }, { name: 'viewport', content: 'width=device-width, initial-scale=1' }, { title: 'Clippy Chat' }],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
    ],
  }),
  component: RootComponent,
})

function RootComponent() {
  // per-mount: fresh per SSR request (no cross-user cache leak), stable on client
  const [queryClient] = useState(() => new QueryClient())
  return (
    <html>
      <head><HeadContent /></head>
      <body>
        <QueryClientProvider client={queryClient}><Outlet /></QueryClientProvider>
        <Scripts />
      </body>
    </html>
  )
}
