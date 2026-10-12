import { describe, expect, it } from 'vitest'
import { blockedAutomationKeywords } from './keyword-conflicts'

describe('blockedAutomationKeywords', () => {
  it('flags identical keywords against a contains flow, case-insensitively', () => {
    expect(
      blockedAutomationKeywords({ keywords: ['WINICC2027'] }, { keywords: ['winicc2027'] }),
    ).toEqual([{ automationKeyword: 'WINICC2027', flowKeyword: 'winicc2027' }])
  })

  it('flags automation keywords that contain a contains-flow keyword', () => {
    expect(
      blockedAutomationKeywords({ keywords: ['win coke now'] }, { keywords: ['coke'], match_type: 'contains' }),
    ).toEqual([{ automationKeyword: 'win coke now', flowKeyword: 'coke' }])
  })

  it('does not flag a shorter automation keyword inside a longer flow keyword', () => {
    expect(blockedAutomationKeywords({ keywords: ['win'] }, { keywords: ['wincoke'] })).toEqual([])
  })

  it('only flags exact equality when the flow matches exactly', () => {
    const flow = { keywords: ['shell'], match_type: 'exact' }
    expect(blockedAutomationKeywords({ keywords: ['Shell'] }, flow)).toHaveLength(1)
    expect(blockedAutomationKeywords({ keywords: ['shell 2026'] }, flow)).toEqual([])
  })

  it('respects case sensitivity only when both sides opt in', () => {
    const automation = { keywords: ['Shell'], case_sensitive: true }
    expect(blockedAutomationKeywords(automation, { keywords: ['shell'], case_sensitive: true })).toEqual([])
    expect(blockedAutomationKeywords(automation, { keywords: ['shell'] })).toHaveLength(1)
  })

  it('ignores empty and non-string keywords', () => {
    expect(blockedAutomationKeywords({ keywords: ['', 5, 'hi'] }, { keywords: [' ', null] })).toEqual([])
    expect(blockedAutomationKeywords({}, { keywords: ['x'] })).toEqual([])
  })
})
