import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { env } from '~/lib/env'
import * as schema from './schema'

let _db: ReturnType<typeof create> | undefined
function create() {
  const pool = new pg.Pool({
    connectionString: env().DATABASE_URL,
    connectionTimeoutMillis: 5000,
    max: 10,
  })
  // without this, a server-side kill of an idle pooled connection crashes the process
  pool.on('error', (err) => console.error('pg pool error', err))
  return drizzle(pool, { schema })
}
export function db() { return (_db ??= create()) }
export type Db = ReturnType<typeof db>
