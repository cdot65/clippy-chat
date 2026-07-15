import { sql } from 'drizzle-orm'
import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

export const userProfiles = pgTable('user_profiles', {
  id: uuid('id').primaryKey().defaultRandom(),
  keycloakSub: text('keycloak_sub').unique(),
  authProvider: text('auth_provider', { enum: ['keycloak', 'local'] }).notNull(),
  username: text('username').notNull(),
  email: text('email'),
  displayName: text('display_name'),
  passwordHash: text('password_hash'),
  isAdmin: boolean('is_admin').notNull().default(false),
  isServiceAccount: boolean('is_service_account').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // guards the 2-replica admin bootstrap race; keycloak usernames stay unconstrained
  uniqueIndex('user_profiles_local_username_idx').on(t.username).where(sql`${t.authProvider} = 'local'`),
])

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  userId: uuid('user_id').notNull().references(() => userProfiles.id, { onDelete: 'cascade' }),
  kcTokens: jsonb('kc_tokens'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const conversations = pgTable('conversations', {
  id: uuid('id').primaryKey(), // CLIENT-SUPPLIED
  userId: uuid('user_id').notNull().references(() => userProfiles.id),
  title: text('title'),
  model: text('model').notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('conversations_user_updated_idx').on(t.userId, t.updatedAt)])

export const messages = pgTable('messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  conversationId: uuid('conversation_id').notNull().references(() => conversations.id),
  role: text('role', { enum: ['system', 'user', 'assistant'] }).notNull(),
  content: text('content').notNull(),
  promptTokens: integer('prompt_tokens'),
  completionTokens: integer('completion_tokens'),
  interrupted: boolean('interrupted').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('messages_conversation_created_idx').on(t.conversationId, t.createdAt)])
