import { createFileRoute } from '@tanstack/react-router'
import { ChatLayout } from '~/components/ChatPane'

export const Route = createFileRoute('/c/$conversationId')({ component: ConversationPage })

function ConversationPage() {
  const { conversationId } = Route.useParams()
  return <ChatLayout conversationId={conversationId} />
}
