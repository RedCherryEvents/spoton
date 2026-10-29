import type { Campaign } from '@/types'

export type EntryClosedReason = 'draft' | 'paused' | 'closed' | 'archived' | 'not_started' | 'ended'

export type EntryGate =
  | { open: true; test: boolean }
  | { open: false; reason: EntryClosedReason }

type GateCampaign = Pick<Campaign, 'status' | 'starts_at' | 'ends_at' | 'settings'>

function digits(value: string | null | undefined): string {
  return String(value ?? '').replace(/\D/g, '')
}

/**
 * True when `phone` is one of the campaign's test numbers. Matches the
 * full number, or the last 9 digits so "082 123 4567" and
 * "+27 82 123 4567" are the same number.
 */
export function isTestNumber(phone: string | null | undefined, testNumbers: unknown): boolean {
  const p = digits(phone)
  if (!p || !Array.isArray(testNumbers)) return false
  return testNumbers.some((raw) => {
    const t = digits(typeof raw === 'string' ? raw : '')
    if (!t) return false
    return t === p || (t.length >= 9 && p.length >= 9 && t.slice(-9) === p.slice(-9))
  })
}

/**
 * Can this contact enter the campaign right now?
 * - Active: yes, within starts_at / ends_at when they are set.
 * - Draft: only the campaign's test numbers (their entries are tagged
 *   test and kept out of draws), whatever the dates.
 * - Paused / closed / archived: no.
 */
export function campaignEntryGate(
  campaign: GateCampaign,
  contactPhone: string | null | undefined,
  now: Date = new Date(),
): EntryGate {
  if (campaign.status === 'draft') {
    return isTestNumber(contactPhone, campaign.settings?.test_numbers)
      ? { open: true, test: true }
      : { open: false, reason: 'draft' }
  }
  if (campaign.status !== 'active') {
    return { open: false, reason: campaign.status as EntryClosedReason }
  }
  if (campaign.starts_at && now < new Date(campaign.starts_at)) return { open: false, reason: 'not_started' }
  if (campaign.ends_at && now > new Date(campaign.ends_at)) return { open: false, reason: 'ended' }
  return { open: true, test: false }
}
