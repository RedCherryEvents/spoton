import { describe, expect, it } from 'vitest'
import {
  campaignAutomationLinks,
  inferAutomationCampaignId,
  sortCampaignAutomations,
  type CampaignAutomationSummary,
} from './automation-links'
import type { AutomationStepType, AutomationTriggerType } from '@/types'

const campaign = { id: 'camp-1', code: 'WINICC2027', keyword: 'win' }

function auto(trigger_type: AutomationTriggerType, trigger_config: Record<string, unknown> = {}) {
  return { trigger_type, trigger_config }
}

function step(step_type: AutomationStepType, step_config: Record<string, unknown>) {
  return { step_type, step_config }
}

describe('campaignAutomationLinks', () => {
  it('links a campaign_entry trigger pinned to this campaign', () => {
    expect(campaignAutomationLinks(campaign, auto('campaign_entry', { campaign_id: 'camp-1' }), [])).toEqual([
      { kind: 'entry_trigger' },
    ])
  })

  it('flags an unpinned campaign_entry trigger as applying to every campaign', () => {
    expect(campaignAutomationLinks(campaign, auto('campaign_entry'), [])).toEqual([
      { kind: 'entry_trigger_any' },
    ])
  })

  it('ignores a campaign_entry trigger pinned to another campaign', () => {
    expect(campaignAutomationLinks(campaign, auto('campaign_entry', { campaign_id: 'other' }), [])).toEqual([])
  })

  it('links a scheduled send whose audience is this campaign', () => {
    const a = auto('time_based', { schedule: '09:00', audience: 'campaign', campaign_id: 'camp-1' })
    expect(campaignAutomationLinks(campaign, a, [])).toEqual([{ kind: 'scheduled_audience' }])
  })

  it('matches keyword triggers on the campaign code or keyword, case-insensitively', () => {
    const byCode = auto('keyword_match', { keywords: ['hello', ' winicc2027 '] })
    const byKeyword = auto('keyword_match', { keywords: ['WIN'] })
    expect(campaignAutomationLinks(campaign, byCode, [])).toEqual([{ kind: 'keyword', detail: ' winicc2027 ' }])
    expect(campaignAutomationLinks(campaign, byKeyword, [])).toEqual([{ kind: 'keyword', detail: 'WIN' }])
    expect(campaignAutomationLinks(campaign, auto('keyword_match', { keywords: ['winner'] }), [])).toEqual([])
  })

  it('links steps that target the campaign, once per step type', () => {
    const links = campaignAutomationLinks(campaign, auto('new_message_received'), [
      step('campaign_add_entry', { campaign_id: 'camp-1' }),
      step('campaign_set_field', { campaign_id: 'camp-1', field_key: 'a', value: 'b' }),
      step('campaign_set_field', { campaign_id: 'camp-1', field_key: 'c', value: 'd' }),
      step('campaign_add_entry', { campaign_id: 'other' }),
      step('send_message', { text: 'hi' }),
    ])
    expect(links).toEqual([
      { kind: 'step', detail: 'campaign_add_entry' },
      { kind: 'step', detail: 'campaign_set_field' },
    ])
  })

  it('returns nothing for unrelated automations', () => {
    expect(campaignAutomationLinks(campaign, auto('new_message_received'), [step('send_message', { text: 'x' })])).toEqual([])
  })
})

describe('sortCampaignAutomations', () => {
  it('puts campaign-specific automations before catch-alls, active first', () => {
    const row = (name: string, is_active: boolean, kind: 'step' | 'entry_trigger_any') =>
      ({ name, is_active, links: [{ kind }] }) as unknown as CampaignAutomationSummary
    const sorted = sortCampaignAutomations([
      row('any', true, 'entry_trigger_any'),
      row('paused', false, 'step'),
      row('live', true, 'step'),
    ])
    expect(sorted.map((r) => r.name)).toEqual(['live', 'paused', 'any'])
  })
})

describe('inferAutomationCampaignId', () => {
  const campaigns = [
    { id: 'coke', code: 'COKE', keyword: 'WINCOKE' },
    { id: 'icc', code: 'WINICC2027', keyword: 'WINICC2027' },
    { id: 'bmw', code: 'BMW', keyword: 'DRIVEBMW' },
  ]

  it('resolves Coca-Cola from its keyword trigger', () => {
    const a = auto('keyword_match', { keywords: ['WINCOKE', 'Coca-Cola'], match_type: 'contains' })
    expect(inferAutomationCampaignId(a, [], campaigns)).toBe('coke')
  })

  it('resolves ICC by code and ignores a stale trigger campaign_id on keyword triggers', () => {
    const a = auto('keyword_match', { keywords: ['WINICC2027'], campaign_id: 'coke' })
    expect(inferAutomationCampaignId(a, [], campaigns)).toBe('icc')
  })

  it('resolves a campaign_entry trigger pinned to a campaign (BMW)', () => {
    expect(inferAutomationCampaignId(auto('campaign_entry', { campaign_id: 'bmw' }), [], campaigns)).toBe('bmw')
  })

  it('falls back to campaign steps when they all name one campaign', () => {
    const a = auto('new_message_received')
    expect(
      inferAutomationCampaignId(a, [step('campaign_set_status', { campaign_id: 'icc', status: 'completed' })], campaigns),
    ).toBe('icc')
  })

  it('returns null rather than guessing when it is ambiguous or unknown', () => {
    expect(
      inferAutomationCampaignId(auto('keyword_match', { keywords: ['WINCOKE', 'DRIVEBMW'] }), [], campaigns),
    ).toBeNull()
    expect(
      inferAutomationCampaignId(
        auto('new_message_received'),
        [step('campaign_add_entry', { campaign_id: 'coke' }), step('campaign_add_entry', { campaign_id: 'bmw' })],
        campaigns,
      ),
    ).toBeNull()
    expect(inferAutomationCampaignId(auto('campaign_entry', { campaign_id: 'deleted' }), [], campaigns)).toBeNull()
    expect(inferAutomationCampaignId(auto('keyword_match', { keywords: ['hello'] }), [], campaigns)).toBeNull()
  })
})
