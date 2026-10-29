import { createHash, randomInt } from 'node:crypto'

// Winner draws for competitions. The pool, its hash and the random
// index are stored with each draw (campaign_draws), so anyone can later
// check which entries were eligible and which one the index picked.

export interface DrawCandidate {
  id: string
  status: string
  metadata?: Record<string, unknown> | null
}

/** Completed entries that aren't test entries, as sorted ids. */
export function eligiblePoolIds(entries: DrawCandidate[]): string[] {
  return entries
    .filter((e) => e.status === 'completed' && e.metadata?.test !== true)
    .map((e) => e.id)
    .sort()
}

/** sha256 of the sorted ids joined by "," (hex). */
export function poolHash(sortedIds: string[]): string {
  return createHash('sha256').update(sortedIds.join(',')).digest('hex')
}

export interface DrawResult {
  pool_entry_ids: string[]
  pool_size: number
  pool_hash: string
  random_index: number
  winner_entry_id: string
}

/**
 * Pick one winner uniformly at random. `pick` is injectable for tests;
 * in production it is crypto.randomInt (cryptographically secure).
 */
export function drawWinner(
  entries: DrawCandidate[],
  pick: (max: number) => number = (max) => randomInt(max),
): DrawResult | null {
  const ids = eligiblePoolIds(entries)
  if (ids.length === 0) return null
  const index = pick(ids.length)
  if (!Number.isInteger(index) || index < 0 || index >= ids.length) {
    throw new Error(`random index ${index} out of range 0..${ids.length - 1}`)
  }
  return {
    pool_entry_ids: ids,
    pool_size: ids.length,
    pool_hash: poolHash(ids),
    random_index: index,
    winner_entry_id: ids[index],
  }
}
