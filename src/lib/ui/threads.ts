export type ThreadGroupKey = 'today' | 'yesterday' | 'earlier'
export type ThreadGroup<T> = { key: ThreadGroupKey; label: string; items: T[] }

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

const dayIndex = (d: Date) => Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 86_400_000)

function bucket(iso: string, now: Date): ThreadGroupKey {
  const diff = dayIndex(now) - dayIndex(new Date(iso))
  return diff <= 0 ? 'today' : diff === 1 ? 'yesterday' : 'earlier'
}

/** Sidebar time label: HH:MM for today/yesterday, 'jul 8' earlier, year appended off-year. */
export function threadTime(iso: string, now = new Date()): string {
  const d = new Date(iso)
  if (bucket(iso, now) !== 'earlier') {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }
  const md = `${MONTHS[d.getMonth()]} ${d.getDate()}`
  return d.getFullYear() === now.getFullYear() ? md : `${md} ${d.getFullYear()}`
}

/** Bucket conversations into Today / Yesterday / Earlier, preserving input order; empty buckets dropped. */
export function groupThreads<T extends { updatedAt: string }>(convos: T[], now = new Date()): ThreadGroup<T>[] {
  const defs: [ThreadGroupKey, string][] = [['today', 'Today'], ['yesterday', 'Yesterday'], ['earlier', 'Earlier']]
  return defs
    .map(([key, label]) => ({ key, label, items: convos.filter((c) => bucket(c.updatedAt, now) === key) }))
    .filter((g) => g.items.length > 0)
}

/** One-line sidebar preview of the latest message. */
export function snippet(role: 'user' | 'assistant', content: string): string {
  return `${role === 'assistant' ? 'clippy' : 'you'}: ${content.replace(/\s+/g, ' ').trim()}`
}
