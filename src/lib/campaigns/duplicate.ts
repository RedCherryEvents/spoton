import type { CampaignDuplicateRule } from '@/types'

export const DUPLICATE_RULES = [
  'whatsapp',
  'email',
  'whatsapp_per_day',
  'unlimited',
] as const

export function isDuplicateRule(value: unknown): value is CampaignDuplicateRule {
  return (
    typeof value === 'string' &&
    (DUPLICATE_RULES as readonly string[]).includes(value)
  )
}

export function parseDuplicateRule(value: unknown): CampaignDuplicateRule {
  return isDuplicateRule(value) ? value : 'whatsapp'
}

export interface DuplicateCandidate {
  id?: string
  contactId: string
  phone?: string | null
  email?: string | null
  createdAt: string
  status: string
}

/**
 * Pure duplicate check used by campaign-ops and unit tests.
 * `existing` is other entries in the same campaign (never `candidate` itself).
 */
export function findDuplicateMatch(args: {
  rule: CampaignDuplicateRule
  candidate: DuplicateCandidate
  existing: DuplicateCandidate[]
  now?: Date
}): DuplicateCandidate | null {
  const { rule, candidate, existing } = args
  if (rule === 'unlimited') return null

  const now = args.now ?? new Date(candidate.createdAt)
  const dayStart = startOfUtcDay(now)

  for (const row of existing) {
    if (rule === 'email') {
      const email = normalizeEmail(candidate.email)
      if (!email || normalizeEmail(row.email) !== email) continue
      return row
    }

    const sameContact = row.contactId === candidate.contactId
    const samePhone =
      normalizePhone(candidate.phone) !== '' &&
      normalizePhone(candidate.phone) === normalizePhone(row.phone)
    if (!sameContact && !samePhone) continue

    if (rule === 'whatsapp_per_day') {
      if (new Date(row.createdAt) < dayStart) continue
    }
    return row
  }
  return null
}

export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

function normalizeEmail(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase()
}

function normalizePhone(value: string | null | undefined): string {
  return (value ?? '').replace(/\D/g, '')
}
