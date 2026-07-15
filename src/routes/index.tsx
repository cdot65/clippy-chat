import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { ChatLayout } from '~/components/ChatPane'

export const Route = createFileRoute('/')({ component: NewChat })

function NewChat() {
  const navigate = useNavigate()
  return <ChatLayout conversationId={null} onFirstSend={(id) => navigate({ to: '/c/$conversationId', params: { conversationId: id } })} />
}
