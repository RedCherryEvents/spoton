import type { CampaignEntryStatus } from '@/types'

export const CAMPAIGN_ENTRY_STATUSES = [
  'in_progress',
  'completed',
  'invalid',
  'duplicate',
  'disqualified',
  'withdrawn',
] as const

export type CanonicalEntryStatus = (typeof CAMPAIGN_ENTRY_STATUSES)[number]

const ALIASES: Record<string, CanonicalEntryStatus> = {
  active: 'in_progress',
  in_progress: 'in_progress',
  completed: 'completed',
  invalid: 'invalid',
  duplicate: 'duplicate',
  disqualified: 'disqualified',
  withdrawn: 'withdrawn',
}

export function normalizeEntryStatus(value: unknown): CanonicalEntryStatus | null {
  if (typeof value !== 'string') return null
  return ALIASES[value] ?? null
}

export function isEntryStatus(value: unknown): value is CampaignEntryStatus {
  return normalizeEntryStatus(value) !== null
}

/** Statuses that count as "still being filled in". */
export const INCOMPLETE_STATUSES: CanonicalEntryStatus[] = ['in_progress']

/** Statuses that block a second unique entry under duplicate rules. */
export const QUALIFYING_DUPLICATE_STATUSES: CanonicalEntryStatus[] = [
  'completed',
  'disqualified',
  'invalid',
  'duplicate',
  'withdrawn',
]

export function statusFilterValues(status: string): string[] {
  const canonical = normalizeEntryStatus(status)
  if (!canonical) return [status]
  if (canonical === 'in_progress') return ['in_progress', 'active']
  return [canonical]
}
