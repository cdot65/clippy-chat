/** Postgres unique-constraint violation (drizzle may wrap the pg error in cause). */
export function isUniqueViolation(err: unknown): boolean {
  const code =
    (err as { code?: string })?.code ??
    (err as { cause?: { code?: string } })?.cause?.code
  return code === '23505'
}
