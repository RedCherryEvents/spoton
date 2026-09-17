import { describe, expect, it } from 'vitest'
import { normalizeEntryStatus, statusFilterValues } from './status'
import { findDuplicateMatch } from './duplicate'
import { exportColumns, toCsv, toExportRow } from './export'
import { generateReportToken, hashReportToken, isShareActive, reportUrl } from './share'
import { orderedAnswers, parseAnswers, upsertAnswer } from './answers'
import type { Campaign, CampaignFieldDefinition } from '@/types'
import type { HydratedCampaignEntry } from './query'

describe('normalizeEntryStatus', () => {
  it('maps legacy active to in_progress', () => {
    expect(normalizeEntryStatus('active')).toBe('in_progress')
    expect(normalizeEntryStatus('in_progress')).toBe('in_progress')
  })

  it('includes the alias when filtering in_progress', () => {
    expect(statusFilterValues('in_progress')).toEqual(['in_progress', 'active'])
  })
})

describe('findDuplicateMatch', () => {
  const existing = [
    {
      id: 'e1',
      contactId: 'c1',
      phone: '+271234',
      email: 'a@x.com',
      createdAt: '2026-09-15T10:00:00.000Z',
      status: 'completed',
    },
  ]

  it('matches one entry per WhatsApp number', () => {
    const hit = findDuplicateMatch({
      rule: 'whatsapp',
      candidate: {
        contactId: 'c1',
        phone: '+271234',
        email: 'other@x.com',
        createdAt: '2026-09-16T10:00:00.000Z',
        status: 'in_progress',
      },
      existing,
    })
    expect(hit?.id).toBe('e1')
  })

  it('allows a second day under whatsapp_per_day', () => {
    const hit = findDuplicateMatch({
      rule: 'whatsapp_per_day',
      candidate: {
        contactId: 'c1',
        phone: '+271234',
        email: 'a@x.com',
        createdAt: '2026-09-16T10:00:00.000Z',
        status: 'in_progress',
      },
      existing,
      now: new Date('2026-09-16T10:00:00.000Z'),
    })
    expect(hit).toBeNull()
  })

  it('never matches when unlimited', () => {
    expect(
      findDuplicateMatch({
        rule: 'unlimited',
        candidate: existing[0],
        existing,
      }),
    ).toBeNull()
  })
})

describe('dynamic export columns', () => {
  it('uses field labels instead of internal keys', () => {
    const fields: CampaignFieldDefinition[] = [
      {
        id: '1',
        campaign_id: 'c',
        account_id: 'a',
        key: 'favourite_product',
        label: 'Favourite Coca-Cola Product',
        field_type: 'select',
        required: false,
        position: 0,
      },
    ]
    const cols = exportColumns(fields, { includeAgent: false })
    expect(cols.map((c) => c.label)).toContain('Favourite Coca-Cola Product')
    expect(cols.map((c) => c.label).join(' ')).not.toMatch(/custom_field/)
  })

  it('writes human-readable CSV headers', () => {
    const fields: CampaignFieldDefinition[] = [
      {
        id: '1',
        campaign_id: 'c',
        account_id: 'a',
        key: 'artist',
        label: 'Favourite Artist',
        field_type: 'text',
        required: false,
        position: 0,
      },
    ]
    const campaign = { name: 'Radio Competition', code: 'RADIO' } as Campaign
    const entry = {
      id: 'e',
      campaign_id: 'c',
      account_id: 'a',
      contact_id: 'p',
      status: 'completed',
      created_at: '2026-09-15T10:00:00.000Z',
      updated_at: '2026-09-15T10:00:00.000Z',
      answers: { artist: { label: 'Favourite Artist', value: 'Tyla' } },
      contact: {
        id: 'p',
        name: 'Armando',
        phone: '27111',
        email: 'a@x.com',
        user_id: 'u',
        account_id: 'a',
        created_at: '',
        updated_at: '',
      },
    } as HydratedCampaignEntry
    const csv = toCsv(exportColumns(fields, { includeAgent: false }), [
      toExportRow(entry, campaign, fields),
    ])
    expect(csv).toContain('Favourite Artist')
    expect(csv).toContain('Tyla')
    expect(csv).toContain('Armando')
  })
})

describe('answers model', () => {
  it('keeps labels with values and orders by campaign fields', () => {
    const answers = upsertAnswer(parseAnswers({}), { key: 'age', label: 'Age' }, '22')
    const rows = orderedAnswers(
      [{ id: '1', campaign_id: 'c', account_id: 'a', key: 'age', label: 'Age', field_type: 'number', required: false, position: 0 }],
      answers,
    )
    expect(rows[0]).toEqual({ key: 'age', label: 'Age', value: '22' })
  })
})

describe('report branding sanitizers', () => {
  it('rejects non-hex brand colors and non-http logos', async () => {
    const { safeBrandColor, safeLogoUrl } = await import('./export')
    expect(safeBrandColor('red; } body { display:none')).toBe('#C8102E')
    expect(safeBrandColor('#C8102E')).toBe('#C8102E')
    expect(safeLogoUrl('javascript:alert(1)')).toBeNull()
    expect(safeLogoUrl('https://cdn.example/logo.png')).toBe('https://cdn.example/logo.png')
  })
})

describe('report share tokens', () => {
  it('stores a hash, never the plaintext', () => {
    const { token, hash } = generateReportToken()
    expect(hash).toBe(hashReportToken(token))
    expect(hash).not.toBe(token)
    expect(reportUrl(token, 'https://app.example/')).toBe(`https://app.example/report/${token}`)
  })

  it('treats expired and revoked shares as inactive', () => {
    expect(
      isShareActive({ expires_at: '2000-01-01T00:00:00.000Z', revoked_at: null }, new Date('2026-09-15')),
    ).toBe(false)
    expect(
      isShareActive(
        { expires_at: '2099-01-01T00:00:00.000Z', revoked_at: '2026-09-01T00:00:00.000Z' },
        new Date('2026-09-15'),
      ),
    ).toBe(false)
  })
})
