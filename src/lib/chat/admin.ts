import { desc, eq, ilike, sql } from 'drizzle-orm'
import { db } from '~/db/client'
import { conversations, messages, userProfiles } from '~/db/schema'
import { NotFoundError } from './service'

export const ADMIN_PAGE_SIZE = 50

export async function adminListConversations(opts: { page?: number; username?: string }) {
  const page = Math.max(1, opts.page ?? 1)
  const filter = opts.username ? ilike(userProfiles.username, `%${opts.username}%`) : undefined

  const base = db()
    .select({
      id: conversations.id,
      title: conversations.title,
      model: conversations.model,
      createdAt: conversations.createdAt,
      updatedAt: conversations.updatedAt,
      deletedAt: conversations.deletedAt,
      ownerUsername: userProfiles.username,
      ownerAuthProvider: userProfiles.authProvider,
      messageCount: sql<number>`count(${messages.id})::int`,
      promptTokens: sql<number>`coalesce(sum(${messages.promptTokens}), 0)::int`,
      completionTokens: sql<number>`coalesce(sum(${messages.completionTokens}), 0)::int`,
    })
    .from(conversations)
    .innerJoin(userProfiles, eq(conversations.userId, userProfiles.id))
    .leftJoin(messages, eq(messages.conversationId, conversations.id))
    .$dynamic()

  const filtered = filter ? base.where(filter) : base

  const raw = await filtered
    .groupBy(conversations.id, userProfiles.username, userProfiles.authProvider)
    .orderBy(desc(conversations.updatedAt))
    .limit(ADMIN_PAGE_SIZE)
    .offset((page - 1) * ADMIN_PAGE_SIZE)

  const countBase = db()
    .select({ n: sql<number>`count(*)::int` })
    .from(conversations)
    .innerJoin(userProfiles, eq(conversations.userId, userProfiles.id))
    .$dynamic()
  const [{ n: total }] = await (filter ? countBase.where(filter) : countBase)

  const rows = raw.map(({ ownerUsername, ownerAuthProvider, ...r }) => ({
    ...r,
    owner: { username: ownerUsername, authProvider: ownerAuthProvider },
  }))
  return { rows, total, page, pageSize: ADMIN_PAGE_SIZE }
}

export async function adminGetConversation(id: string) {
  const convo = await db().query.conversations.findFirst({ where: eq(conversations.id, id) })
  if (!convo) throw new NotFoundError()
  const owner = await db().query.userProfiles.findFirst({
    where: eq(userProfiles.id, convo.userId),
    columns: { id: true, username: true, email: true, authProvider: true, isServiceAccount: true },
  })
  const msgs = await db().query.messages.findMany({
    where: eq(messages.conversationId, id),
    orderBy: (m, { asc }) => asc(m.createdAt),
    columns: { id: true, role: true, content: true, promptTokens: true, completionTokens: true, interrupted: true, createdAt: true },
  })
  return {
    conversation: {
      id: convo.id, title: convo.title, model: convo.model,
      createdAt: convo.createdAt, updatedAt: convo.updatedAt, deletedAt: convo.deletedAt,
    },
    owner,
    messages: msgs,
  }
}
