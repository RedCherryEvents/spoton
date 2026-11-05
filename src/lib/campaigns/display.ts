// Pure display helpers for the campaign list and the campaign overview:
// status as people read it (Live / Scheduled / Ended), date ranges,
// masked mobile numbers, where an entry came from, and whether its
// answer is correct. No runtime imports beyond types.

import type { Campaign, CampaignAnswerMap, CampaignFieldDefinition, CampaignType } from '@/types'

export const CAMPAIGN_TYPES: CampaignType[] = [
  'competition',
  'insurance',
  'voucher',
  'survey',
  'lead_gen',
  'other',
]

export type CampaignDisplayStatus =
  | 'live'
  | 'scheduled'
  | 'ended'
  | 'paused'
  | 'draft'
  | 'closed'
  | 'archived'

/**
 * Active campaigns read as Scheduled before their start date and Ended
 * after their end date (the entry gate refuses entries then too).
 */
export function campaignDisplayStatus(
  c: Pick<Campaign, 'status' | 'starts_at' | 'ends_at'>,
  now: number = Date.now(),
): CampaignDisplayStatus {
  if (c.status === 'active') {
    const starts = c.starts_at ? Date.parse(c.starts_at) : NaN
    const ends = c.ends_at ? Date.parse(c.ends_at) : NaN
    if (Number.isFinite(starts) && starts > now) return 'scheduled'
    if (Number.isFinite(ends) && ends < now) return 'ended'
    return 'live'
  }
  return c.status
}

/** Sort order for the list: what needs attention first. */
export const DISPLAY_STATUS_ORDER: CampaignDisplayStatus[] = [
  'live',
  'scheduled',
  'paused',
  'draft',
  'ended',
  'closed',
  'archived',
]

const MONTH = new Intl.DateTimeFormat('en-ZA', { month: 'short', timeZone: 'Africa/Johannesburg' })
const DAY = new Intl.DateTimeFormat('en-ZA', { day: 'numeric', timeZone: 'Africa/Johannesburg' })
const YEAR = new Intl.DateTimeFormat('en-ZA', { year: 'numeric', timeZone: 'Africa/Johannesburg' })

function parts(iso: string) {
  const d = new Date(iso)
  return { day: DAY.format(d), month: MONTH.format(d), year: YEAR.format(d) }
}

/**
 * "1–30 Nov", "12 Nov – 5 Dec", "From 20 Nov", "Until 30 Nov", or null.
 * The year is added when it isn't the current one.
 */
export function formatCampaignDates(
  startsAt: string | null | undefined,
  endsAt: string | null | undefined,
  now: Date = new Date(),
): string | null {
  const thisYear = YEAR.format(now)
  const fmt = (p: ReturnType<typeof parts>) =>
    `${p.day} ${p.month}${p.year === thisYear ? '' : ` ${p.year}`}`
  const s = startsAt ? parts(startsAt) : null
  const e = endsAt ? parts(endsAt) : null
  if (s && e) {
    if (s.month === e.month && s.year === e.year) {
      const range = s.day === e.day ? s.day : `${s.day}–${e.day}`
      return `${range} ${s.month}${s.year === thisYear ? '' : ` ${s.year}`}`
    }
    return `${fmt(s)} – ${fmt(e)}`
  }
  if (s) return `From ${fmt(s)}`
  if (e) return `Until ${fmt(e)}`
  return null
}

/** "27821234471" → "+27 82 *** 4471". Keeps the last four digits only. */
export function maskMobile(phone: string | null | undefined): string {
  const digits = String(phone ?? '').replace(/\D/g, '')
  if (digits.length < 7) return digits ? '***' : '—'
  if (digits.startsWith('27') && digits.length === 11) {
    return `+27 ${digits.slice(2, 4)} *** ${digits.slice(-4)}`
  }
  if (digits.startsWith('0') && digits.length === 10) {
    return `${digits.slice(0, 3)} *** ${digits.slice(-4)}`
  }
  return `+${digits.slice(0, 2)} *** ${digits.slice(-4)}`
}

interface EntryEvent {
  type?: string
  detail?: string
}

/**
 * Where an entry came from, from what the customer sent:
 * "Welcome menu" (a menu button, whose title is "KEYWORD – Name"),
 * "Keyword · SAVE" (the keyword, plus anything after it, such as a
 * placement code a QR prefilled), "Test", or the stored source.
 */
export function entrySourceLabel(entry: {
  source?: string | null
  metadata?: Record<string, unknown> | null
}): string {
  const meta = entry.metadata ?? {}
  if (meta.test === true) return 'Test'
  const events = Array.isArray(meta.events) ? (meta.events as EntryEvent[]) : []
  const keyword = events.find((e) => e?.type === 'keyword_detected')?.detail?.trim()
  if (keyword) {
    if (/\s[–-]\s/.test(keyword)) return 'Welcome menu'
    const short = keyword.length > 28 ? `${keyword.slice(0, 27)}…` : keyword
    return `Keyword · ${short}`
  }
  const source = String(entry.source ?? '').trim()
  if (!source || source === 'automation') return 'WhatsApp'
  return source.charAt(0).toUpperCase() + source.slice(1)
}

function normalizeAnswer(v: string): string {
  return v.trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * True when `answer` is the correct one: the same text (ignoring case
 * and spacing), or it starts with it as a separate token, so "B" also
 * accepts "B - Durban" and "b) Durban". Several correct answers can be
 * given separated by "|".
 */
export function isCorrectAnswer(answer: string | null | undefined, correct: string | null | undefined): boolean {
  const a = normalizeAnswer(String(answer ?? ''))
  if (!a) return false
  return String(correct ?? '')
    .split('|')
    .map(normalizeAnswer)
    .filter(Boolean)
    .some((c) => a === c || (a.startsWith(c) && /^[^\p{L}\p{N}]/u.test(a.slice(c.length))))
}

export interface EntryAnswerCell {
  value: string | null
  /** null when the campaign has no correct answer set. */
  correct: boolean | null
}

/**
 * The answer to show for an entry: the field the correct answer is set
 * on, else the first captured field in field order.
 */
export function entryAnswer(
  answers: CampaignAnswerMap | null | undefined,
  fields: Pick<CampaignFieldDefinition, 'key' | 'position'>[],
  correctAnswer?: { field_key?: string; value?: string } | null,
): EntryAnswerCell {
  const map = answers ?? {}
  const key =
    correctAnswer?.field_key && correctAnswer.value
      ? correctAnswer.field_key
      : [...fields].sort((a, b) => a.position - b.position).find((f) => map[f.key]?.value)?.key ??
        Object.keys(map).find((k) => map[k]?.value)
  const value = key ? (map[key]?.value ?? '').trim() || null : null
  if (!correctAnswer?.field_key || !correctAnswer.value) return { value, correct: null }
  return { value, correct: value ? isCorrectAnswer(value, correctAnswer.value) : null }
}

/** "Language: isiZulu" tag → "isiZulu"; null when the contact has none. */
export function contactLanguageName(tags: { name: string }[] | null | undefined): string | null {
  const tag = (tags ?? []).find((t) => t.name.startsWith('Language: '))
  return tag ? tag.name.slice('Language: '.length) : null
}

/** "Thabo Mokoena" → "T. Mokoena"; one word stays as it is. */
export function shortName(name: string | null | undefined): string {
  const words = String(name ?? '').trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '—'
  if (words.length === 1) return words[0]
  return `${words[0].charAt(0).toUpperCase()}. ${words.slice(1).join(' ')}`
}
