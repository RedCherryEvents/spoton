import { describe, expect, it } from 'vitest'
import {
  campaignDisplayStatus,
  contactLanguageName,
  entryAnswer,
  entrySourceLabel,
  formatCampaignDates,
  isCorrectAnswer,
  maskMobile,
  shortName,
} from './display'

const NOW = Date.parse('2026-11-05T10:00:00Z')

describe('campaignDisplayStatus', () => {
  it('reads active campaigns as live, scheduled or ended by their dates', () => {
    expect(campaignDisplayStatus({ status: 'active' }, NOW)).toBe('live')
    expect(campaignDisplayStatus({ status: 'active', starts_at: '2026-11-20T00:00:00Z' }, NOW)).toBe('scheduled')
    expect(campaignDisplayStatus({ status: 'active', ends_at: '2026-11-01T00:00:00Z' }, NOW)).toBe('ended')
    expect(campaignDisplayStatus({ status: 'draft' }, NOW)).toBe('draft')
    expect(campaignDisplayStatus({ status: 'closed' }, NOW)).toBe('closed')
  })
})

describe('formatCampaignDates', () => {
  const now = new Date(NOW)
  it('collapses a range within one month', () => {
    expect(formatCampaignDates('2026-11-01T00:00:00Z', '2026-11-30T21:00:00Z', now)).toBe('1–30 Nov')
  })
  it('spans months, open ends and other years', () => {
    expect(formatCampaignDates('2026-11-12T00:00:00Z', '2026-12-05T00:00:00Z', now)).toBe('12 Nov – 5 Dec')
    expect(formatCampaignDates('2026-11-20T00:00:00Z', null, now)).toBe('From 20 Nov')
    expect(formatCampaignDates(null, '2027-01-31T00:00:00Z', now)).toBe('Until 31 Jan 2027')
    expect(formatCampaignDates(null, null, now)).toBeNull()
  })
})

describe('maskMobile', () => {
  it('keeps only the network code and last four digits', () => {
    expect(maskMobile('27821234471')).toBe('+27 82 *** 4471')
    expect(maskMobile('+27 71 555 0932')).toBe('+27 71 *** 0932')
    expect(maskMobile('0631237715')).toBe('063 *** 7715')
    expect(maskMobile(null)).toBe('—')
  })
})

describe('entrySourceLabel', () => {
  const withMessage = (detail: string) => ({ metadata: { events: [{ type: 'keyword_detected', detail }] } })
  it('tells keyword, menu tap and test entries apart', () => {
    expect(entrySourceLabel(withMessage('SAVE'))).toBe('Keyword · SAVE')
    expect(entrySourceLabel(withMessage('SAVE ETV1930'))).toBe('Keyword · SAVE ETV1930')
    expect(entrySourceLabel(withMessage('SAVE – OUTsurance'))).toBe('Welcome menu')
    expect(entrySourceLabel({ metadata: { test: true } })).toBe('Test')
    expect(entrySourceLabel({ source: 'automation', metadata: {} })).toBe('WhatsApp')
  })
})

describe('correct answers', () => {
  it('matches ignoring case, spacing and a trailing description', () => {
    expect(isCorrectAnswer('b', 'B')).toBe(true)
    expect(isCorrectAnswer('B - Durban', 'B')).toBe(true)
    expect(isCorrectAnswer('Bloemfontein', 'B')).toBe(false)
    expect(isCorrectAnswer('Durban', 'B|Durban')).toBe(true)
    expect(isCorrectAnswer('', 'B')).toBe(false)
  })

  it('shows the answer field, and only judges it when a correct answer is set', () => {
    const fields = [
      { key: 'name', position: 0 },
      { key: 'q1', position: 1 },
    ]
    const answers = { q1: { label: 'Question', value: 'A' } }
    expect(entryAnswer(answers, fields)).toEqual({ value: 'A', correct: null })
    expect(entryAnswer(answers, fields, { field_key: 'q1', value: 'B' })).toEqual({ value: 'A', correct: false })
    expect(entryAnswer({}, fields, { field_key: 'q1', value: 'B' })).toEqual({ value: null, correct: null })
  })
})

describe('names and languages', () => {
  it('shortens names and reads the language tag', () => {
    expect(shortName('Thabo Mokoena')).toBe('T. Mokoena')
    expect(shortName('Jan van Wyk')).toBe('J. van Wyk')
    expect(shortName('Lerato')).toBe('Lerato')
    expect(contactLanguageName([{ name: 'SPOT ON welcomed' }, { name: 'Language: isiXhosa' }])).toBe('isiXhosa')
    expect(contactLanguageName([])).toBeNull()
  })
})
