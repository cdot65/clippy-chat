import { and, asc, desc, eq, isNull, ne, sql } from 'drizzle-orm'
import { db } from '~/db/client'
import { isUniqueViolation } from '~/db/errors'
import { conversations, messages } from '~/db/schema'
import { env } from '~/lib/env'
import { CLIPPY_SYSTEM_PROMPT } from './persona'

export class NotFoundError extends Error { constructor() { super('not found') } }

/** Create on first use (client-supplied uuid) or return existing owned convo. */
export async function ensureConversation(id: string, userId: string, firstMessage: string) {
  // undefined when absent; NotFoundError when present but foreign/deleted
  const findOwned = async () => {
    const existing = await db().query.conversations.findFirst({ where: eq(conversations.id, id) })
    if (!existing) return undefined
    if (existing.userId !== userId || existing.deletedAt) throw new NotFoundError()
    return existing
  }
  const existing = await findOwned()
  if (existing) return existing
  try {
    // one transaction: a convo without its persona row must never be observable
    return await db().transaction(async (tx) => {
      const [row] = await tx.insert(conversations)
        .values({ id, userId, model: env().INFERENCE_MODEL, title: firstMessage.slice(0, 80) }).returning()
      await tx.insert(messages).values({ conversationId: id, role: 'system', content: CLIPPY_SYSTEM_PROMPT })
      return row
    })
  } catch (err) {
    // lost a concurrent create race on the client-supplied uuid — the winner's
    // row exists; the same ownership/deleted checks apply to it
    if (isUniqueViolation(err)) {
      const winner = await findOwned()
      if (winner) return winner
    }
    throw err
  }
}

export async function appendMessage(
  conversationId: string, role: 'system' | 'user' | 'assistant', content: string,
  extra: { promptTokens?: number; completionTokens?: number; interrupted?: boolean } = {},
) {
  const [row] = await db().insert(messages).values({ conversationId, role, content, ...extra }).returning()
  await db().update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, conversationId))
  return row
}

export async function loadHistory(conversationId: string) {
  return db().query.messages.findMany({
    where: eq(messages.conversationId, conversationId),
    orderBy: asc(messages.createdAt),
    columns: { role: true, content: true },
  })
}

export async function listConversations(userId: string) {
  // correlated scalar subqueries ride messages_conversation_created_idx; the
  // 120-char cap keeps sidebar snippets from dragging whole transcripts over.
  // NB: ${conversations.id} renders UNQUALIFIED ("id") in select-list sql and
  // would bind to m.id inside the subquery — correlate via ${conversations}.id
  const lastRole = sql<'user' | 'assistant' | null>`(select m.role from ${messages} m
    where m.conversation_id = ${conversations}.id and m.role <> 'system'
    order by m.created_at desc limit 1)`.as('last_role')
  const lastContent = sql<string | null>`(select left(m.content, 120) from ${messages} m
    where m.conversation_id = ${conversations}.id and m.role <> 'system'
    order by m.created_at desc limit 1)`.as('last_content')
  const query = db().select({
    id: conversations.id, title: conversations.title, model: conversations.model,
    createdAt: conversations.createdAt, updatedAt: conversations.updatedAt,
    lastRole, lastContent,
  }).from(conversations)
    .where(and(eq(conversations.userId, userId), isNull(conversations.deletedAt)))
    .orderBy(desc(conversations.updatedAt))
  const rows = await query
  return rows.map(({ lastRole, lastContent, ...c }) => ({
    ...c,
    lastMessage: lastRole != null && lastContent != null ? { role: lastRole, content: lastContent } : null,
  }))
}

async function requireOwned(conversationId: string, userId: string) {
  const convo = await db().query.conversations.findFirst({ where: eq(conversations.id, conversationId) })
  if (!convo || convo.userId !== userId || convo.deletedAt) throw new NotFoundError()
  return convo
}

export async function listMessages(conversationId: string, userId: string) {
  await requireOwned(conversationId, userId)
  return db().query.messages.findMany({
    where: and(eq(messages.conversationId, conversationId), ne(messages.role, 'system')),
    orderBy: asc(messages.createdAt),
    columns: { id: true, role: true, content: true, interrupted: true, createdAt: true },
  })
}

export async function softDeleteConversation(conversationId: string, userId: string) {
  await requireOwned(conversationId, userId)
  await db().update(conversations).set({ deletedAt: new Date() }).where(eq(conversations.id, conversationId))
}
