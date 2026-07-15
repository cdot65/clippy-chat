import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { requireUser } from '~/lib/auth/middleware'
import { foldSystem, trimHistory } from '~/lib/chat/history'
import { NotFoundError, appendMessage, ensureConversation, loadHistory } from '~/lib/chat/service'
import { chatStream } from '~/lib/chat/vllm'

const bodySchema = z.object({ conversationId: z.uuid(), message: z.string().min(1).max(8000) })
const CONTEXT_BUDGET = 8192 - 1024 // reserve for completion

const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`

export const Route = createFileRoute('/api/chat')({
  server: { handlers: {
    POST: async ({ request }) => {
      const user = await requireUser(request)
      const parsed = bodySchema.safeParse(await request.json().catch(() => null))
      if (!parsed.success) return Response.json({ error: 'invalid body' }, { status: 400 })
      const { conversationId, message } = parsed.data

      try { await ensureConversation(conversationId, user.id, message) }
      catch (e) { if (e instanceof NotFoundError) return Response.json({ error: 'not found' }, { status: 404 }); throw e }
      await appendMessage(conversationId, 'user', message)
      // foldSystem: Mistral v0.3 template rejects the system role — see history.ts
      const history = foldSystem(trimHistory(await loadHistory(conversationId), CONTEXT_BUDGET))

      const encoder = new TextEncoder()
      const stream = new ReadableStream({
        async start(controller) {
          let content = ''
          let usage: { promptTokens?: number; completionTokens?: number } = {}
          // client disconnects (request.signal.aborted) can race an in-flight
          // enqueue after the consumer has gone away; guard so that race
          // doesn't surface as an unhandled controller error.
          const safeEnqueue = (chunk: string) => {
            try { controller.enqueue(encoder.encode(chunk)) } catch { /* consumer gone */ }
          }
          try {
            for await (const ev of chatStream(history, request.signal)) {
              if (ev.type === 'delta') { content += ev.content; safeEnqueue(sse('delta', { content: ev.content })) }
              else usage = { promptTokens: ev.promptTokens, completionTokens: ev.completionTokens }
            }
            const row = await appendMessage(conversationId, 'assistant', content, usage)
            safeEnqueue(sse('done', { messageId: row.id, ...usage }))
          } catch (err) {
            if (request.signal.aborted) {
              if (content) await appendMessage(conversationId, 'assistant', content, { interrupted: true })
                .catch((e) => console.error('persist interrupted row failed', e))
            } else {
              await appendMessage(conversationId, 'assistant', content, { interrupted: true })
                .catch((e) => console.error('persist interrupted row failed', e))
              safeEnqueue(sse('error', { message: 'inference failed, try again' }))
              console.error('chat stream error', err)
            }
          } finally { try { controller.close() } catch { /* already closed by disconnect */ } }
        },
      })
      return new Response(stream, {
        headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' },
      })
    },
  } },
})
