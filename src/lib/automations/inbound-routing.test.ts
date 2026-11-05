import { describe, expect, it } from 'vitest'
import type { Automation } from '@/types'
import {
  anyKeywordAutomationMatches,
  automationsForTrigger,
  isOpenReplyWait,
} from './inbound-routing'

const auto = (over: Partial<Automation>): Automation =>
  ({
    id: 'a',
    account_id: 'acct',
    user_id: 'u',
    name: 'x',
    trigger_type: 'keyword_match',
    trigger_config: { keywords: ['SAVE'], match_type: 'exact' },
    is_active: true,
    ...over,
  }) as Automation

describe('isOpenReplyWait', () => {
  const now = Date.parse('2026-11-05T12:00:00Z')
  it('is open before its timeout and closed after', () => {
    expect(isOpenReplyWait({ run_at: '2026-11-05T13:00:00Z' }, now)).toBe(true)
    expect(isOpenReplyWait({ run_at: '2026-11-05T11:00:00Z' }, now)).toBe(false)
  })
  it('treats a wait without a timeout as open, and no wait as closed', () => {
    expect(isOpenReplyWait({ run_at: null }, now)).toBe(true)
    expect(isOpenReplyWait(null, now)).toBe(false)
  })
})

describe('anyKeywordAutomationMatches', () => {
  it('matches active keyword automations with their own match rules', () => {
    const list = [auto({})]
    expect(anyKeywordAutomationMatches(list, 'SAVE')).toBe(true)
    expect(anyKeywordAutomationMatches(list, 'save please')).toBe(true)
    expect(anyKeywordAutomationMatches(list, 'hello')).toBe(false)
    expect(anyKeywordAutomationMatches(list, '   ')).toBe(false)
  })
  it('ignores paused automations and other trigger types', () => {
    expect(anyKeywordAutomationMatches([auto({ is_active: false })], 'SAVE')).toBe(false)
    expect(
      anyKeywordAutomationMatches([auto({ trigger_type: 'new_message_received' })], 'SAVE'),
    ).toBe(false)
  })
})

describe('automationsForTrigger', () => {
  it('keeps only active automations of the requested trigger', () => {
    const list = [
      auto({ id: 'k' }),
      auto({ id: 'n', trigger_type: 'new_message_received' }),
      auto({ id: 'off', trigger_type: 'new_message_received', is_active: false }),
    ]
    expect(automationsForTrigger(list, 'new_message_received').map((a) => a.id)).toEqual(['n'])
  })
})
