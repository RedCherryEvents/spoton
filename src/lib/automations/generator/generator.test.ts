import { describe, expect, it } from 'vitest'
import { parseAiDraft } from './ai'
import { inferCampaignFromScript } from './infer'
import { normalizeDraft } from './normalize'
import { parseScript } from './script-parser'
import type { GeneratedStep, GeneratorCatalog } from './types'

const COKE = '11111111-1111-4111-8111-111111111111'
const ICC = '22222222-2222-4222-8222-222222222222'
const FAQ_FLOW = '9907b409-dd92-4db0-a842-66f3d4e34de1'
const WELCOME_FLOW = '15832ac7-17b5-4c8b-b3a4-9b54af697c64'
const VIP_TAG = '33333333-3333-4333-8333-333333333333'

const catalog: GeneratorCatalog = {
  campaigns: [
    { id: COKE, name: 'Coca-Cola Summer Competition', code: 'COKE', keyword: 'WINCOKE', status: 'active', client_name: 'Coca-Cola' },
    { id: ICC, name: 'ICC2027', code: 'WINICC2027', keyword: 'WINICC2027', status: 'active', client_name: null },
  ],
  flows: [
    { id: FAQ_FLOW, name: 'FAQ bot', status: 'active', trigger_type: 'keyword', trigger_config: { keywords: ['faq', 'question', 'info'] } },
    { id: WELCOME_FLOW, name: 'Welcome menu', status: 'draft', trigger_type: 'manual', trigger_config: {} },
  ],
  tags: [{ id: VIP_TAG, name: 'VIP' }],
  templates: [{ name: 'coke_reminder', language: 'en_US' }],
  automations: [
    { id: 'a1', name: 'test 1', is_active: true, trigger_type: 'keyword_match', trigger_config: { keywords: ['spot on'], match_type: 'contains' } },
    { id: 'a2', name: 'SPOTON — Universal Welcome', is_active: true, trigger_type: 'new_message_received', trigger_config: {} },
  ],
}

const COKE_SCRIPT = `Name: Coca-Cola Welcome
Trigger: keyword SHARECOKE2026, Coke
Add campaign entry
Send message: Welcome to the Coca-Cola Summer Competition, {{ contact.name }}! 🥤
Watch how to enter:
https://youtu.be/0Ab-F7Y3IXc
Ask: What's the code under your cap? -> cap code
Save field cap_code = {{ vars.cap_code }}
If message contains SHARE:
  Send message: Thanks for sharing!
Else:
  Send message: Good luck!
End if
Set entry status: completed`

function generate(script: string, campaignId: string | null = COKE, name = 'Test') {
  return normalizeDraft(parseScript(script), catalog, { name, campaignId })
}

function types(steps: GeneratedStep[]): string[] {
  return steps.map((s) => s.step_type)
}

describe('automation generator: Coca-Cola welcome', () => {
  const result = generate(COKE_SCRIPT, COKE, 'Coca-Cola Welcome')
  const { automation } = result

  it('builds a keyword trigger tied to the campaign', () => {
    expect(automation.trigger_type).toBe('keyword_match')
    expect(automation.trigger_config).toMatchObject({
      keywords: ['SHARECOKE2026', 'Coke'],
      match_type: 'word',
      case_sensitive: false,
      campaign_id: COKE,
    })
  })

  it('keeps the steps in order with exactly one campaign entry', () => {
    expect(types(automation.steps)).toEqual([
      'campaign_add_entry',
      'send_message',
      'ask_question',
      'campaign_set_field',
      'condition',
      'campaign_set_status',
    ])
    expect(automation.steps[0].step_config.campaign_id).toBe(COKE)
  })

  it('sends the YouTube link inside the message, not as media', () => {
    const text = automation.steps[1].step_config.text as string
    expect(text).toContain('{{ contact.name }}')
    expect(text).toContain('Watch how to enter:')
    expect(text).toContain('https://youtu.be/0Ab-F7Y3IXc')
    expect(JSON.stringify(automation.steps)).not.toContain('"send_media"')
  })

  it('gives conditions an operand and branches', () => {
    const cond = automation.steps[4]
    expect(cond.step_config).toMatchObject({ subject: 'message_content', operand: 'SHARE', value: 'SHARE' })
    expect(types(cond.branches!.yes)).toEqual(['send_message'])
    expect(types(cond.branches!.no)).toEqual(['send_message'])
    expect(cond.branches!.yes[0].step_config.text).toBe('Thanks for sharing!')
  })

  it('normalizes the answer variable and entry status', () => {
    expect(automation.steps[2].step_config).toMatchObject({ var_key: 'cap_code' })
    expect(automation.steps[5].step_config).toMatchObject({ status: 'completed' })
  })

  it('stamps a unique node id on every step', () => {
    const ids: string[] = []
    const walk = (steps: GeneratedStep[]) => steps.forEach((s) => {
      ids.push(String(s.step_config.node_id))
      if (s.branches) { walk(s.branches.yes); walk(s.branches.no) }
    })
    walk(automation.steps)
    expect(ids.every((id) => /^c_[0-9a-f-]{36}$/.test(id))).toBe(true)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('passes activation validation with no blocking issues', () => {
    expect(result.issues).toEqual([])
    expect(result.warnings.filter((w) => w.level === 'warning')).toEqual([])
  })

  it('summarizes what will happen in plain language', () => {
    expect(result.summary[0]).toBe('When a customer sends a message containing the word "SHARECOKE2026" or "Coke":')
    expect(result.summary.some((l) => l.includes('Coca-Cola Summer Competition') && l.includes('no duplicates'))).toBe(true)
    expect(result.summary).toContain('   Otherwise:')
  })
})

describe('automation generator: references', () => {
  it('resolves flows by name to the real flow id', () => {
    const r = generate('Trigger: keyword help\nStart flow: FAQ bot', null)
    expect(r.automation.steps).toHaveLength(1)
    expect(r.automation.steps[0].step_config.flow_id).toBe(FAQ_FLOW)
    expect(r.issues).toEqual([])
  })

  it('resolves AI refs (F1, T1, C2) without ever trusting invented ids', () => {
    const spec = parseAiDraft(JSON.stringify({
      trigger: { type: 'keyword_match', keywords: ['help'] },
      steps: [
        { type: 'start_flow', flow_id: 'F1' },
        { type: 'add_tag', tag_id: 'T1' },
        { type: 'campaign_add_entry', campaign_id: 'C2' },
        { type: 'start_flow', flow_id: '00000000-0000-4000-8000-000000000000' },
      ],
    }))
    const r = normalizeDraft(spec, catalog, { name: 'x', campaignId: null })
    const cfgs = r.automation.steps.map((s) => s.step_config)
    expect(cfgs[0].flow_id).toBe(FAQ_FLOW)
    expect(cfgs[1].tag_id).toBe(VIP_TAG)
    expect(cfgs[2].campaign_id).toBe(ICC)
    expect(cfgs[3].flow_id).toBe('')
    expect(r.warnings.some((w) => w.message.includes('wasn\'t found') && w.message.includes('"FAQ bot"'))).toBe(true)
    expect(r.issues.some((i) => i.message.includes('flow is required') || i.path.includes('flow_id'))).toBe(true)
  })

  it('flags a flow that is not active', () => {
    const r = generate('Trigger: keyword menu\nStart flow: Welcome menu', null)
    expect(r.automation.steps[0].step_config.flow_id).toBe(WELCOME_FLOW)
    expect(r.issues.some((i) => i.message.includes('is not active'))).toBe(true)
  })

  it('blanks unknown tags and campaigns with a warning', () => {
    const r = generate('Trigger: keyword x\nAdd tag: Nope\nAdd entry in campaign Pepsi', null)
    expect(r.automation.steps[0].step_config.tag_id).toBe('')
    expect(r.automation.steps[1].step_config.campaign_id).toBe('')
    expect(r.warnings.filter((w) => w.level === 'warning').length).toBeGreaterThanOrEqual(2)
    expect(r.issues.length).toBeGreaterThan(0)
  })

  it('rejects a campaign id outside the catalog', () => {
    const r = generate('Trigger: keyword x\nSend message: hi', 'not-in-account')
    expect(r.campaign_id).toBeNull()
    expect(r.automation.trigger_config).not.toHaveProperty('campaign_id')
  })

  it('only allows approved templates and fills in their language', () => {
    const ok = generate('Trigger: keyword x\nSend template: coke_reminder', null)
    expect(ok.automation.steps[0].step_config).toMatchObject({ template_name: 'coke_reminder', language: 'en_US' })
    const bad = generate('Trigger: keyword x\nSend template: made_up', null)
    expect(bad.automation.steps[0].step_config.template_name).toBe('')
    expect(bad.issues.length).toBeGreaterThan(0)
  })
})

describe('automation generator: safety checks', () => {
  it('adds the campaign entry when the selected campaign has none, and dedupes repeats', () => {
    const added = generate('Trigger: keyword WINCOKE\nSend message: hi')
    expect(types(added.automation.steps)).toEqual(['campaign_add_entry', 'send_message'])
    const twice = generate('Trigger: keyword WINCOKE\nAdd campaign entry\nAdd campaign entry\nSend message: hi')
    expect(types(twice.automation.steps)).toEqual(['campaign_add_entry', 'send_message'])
  })

  it('uses the campaign keyword when the script names none', () => {
    const r = generate('Send message: hi')
    expect(r.automation.trigger_config).toMatchObject({ keywords: ['WINCOKE'], campaign_id: COKE })
  })

  it('warns when a free-form message falls outside the 24-hour window', () => {
    const r = generate('Trigger: keyword x\nSend message: hi\nWait 2 days\nSend message: reminder', null)
    expect(r.warnings.some((w) => w.message.includes('24-hour window'))).toBe(true)
    const ok = generate('Trigger: keyword x\nWait 2 days\nSend template: coke_reminder', null)
    expect(ok.warnings.some((w) => w.message.includes('24-hour window'))).toBe(false)
  })

  it('warns about keywords other automations or flows already catch', () => {
    const r = generate('Trigger: keyword spot on, faq\nSend message: hi', null)
    expect(r.warnings.some((w) => w.message.includes('"test 1"'))).toBe(true)
    expect(r.warnings.some((w) => w.message.includes('FAQ bot'))).toBe(true)
  })

  it('warns when a step uses the entry before it exists', () => {
    const r = normalizeDraft(
      { trigger: { type: 'keyword_match', config: { keywords: ['x'] } }, steps: [
        { type: 'campaign_set_status', config: { status: 'completed' } },
        { type: 'campaign_add_entry', config: {} },
      ], notes: [] },
      catalog,
      { name: 'x', campaignId: COKE },
    )
    expect(r.warnings.some((w) => w.message.includes('before "Add campaign entry"'))).toBe(true)
  })

  it('turns a video page sent as media into a message, and keeps real files as media', () => {
    const r = generate('Trigger: keyword x\nSend video: https://www.youtube.com/watch?v=abc | Watch this\nSend image: https://cdn.example.com/a.jpg', null)
    expect(r.automation.steps[0]).toMatchObject({ step_type: 'send_message', step_config: { text: 'Watch this\nhttps://www.youtube.com/watch?v=abc' } })
    expect(r.automation.steps[1]).toMatchObject({ step_type: 'send_media', step_config: { media_type: 'image', url: 'https://cdn.example.com/a.jpg' } })
  })

  it('drops unsupported step types instead of passing them through', () => {
    const r = normalizeDraft(
      { trigger: { type: 'keyword_match', config: { keywords: ['x'] } }, steps: [
        { type: 'send_webhook', config: { url: 'https://evil.example' } },
        { type: 'send_message', config: { text: 'hi', exec: 'rm -rf /' } },
      ], notes: [] },
      catalog,
      { name: 'x', campaignId: null },
    )
    expect(types(r.automation.steps)).toEqual(['send_message'])
    expect(Object.keys(r.automation.steps[0].step_config).sort()).toEqual(['node_id', 'text'])
  })

  it('reports activation issues for missing message text', () => {
    const r = generate('Trigger: keyword x\nSend message:', null)
    expect(r.issues.some((i) => i.path.includes('text'))).toBe(true)
  })
})

describe('script parser', () => {
  it('reports lines it does not understand instead of guessing', () => {
    const spec = parseScript('Trigger: keyword x\nDo a backflip')
    expect(spec.steps).toEqual([])
    expect(spec.notes[0]).toMatchObject({ level: 'warning', line: 2 })
  })

  it('closes If blocks by indentation and parses time ranges', () => {
    const spec = parseScript('If time is 08:00-17:00:\n  Send message: open\nSend message: always')
    expect(spec.steps).toHaveLength(2)
    expect(spec.steps[0].config).toMatchObject({ subject: 'time_of_day', operand: '08:00-17:00' })
    expect(spec.steps[0].yes).toHaveLength(1)
  })

  it('handles waits with an inline follow-up and conversation status', () => {
    const spec = parseScript('Wait 30 minutes then send message: still there?\nSet conversation status to closed')
    expect(spec.steps.map((s) => s.type)).toEqual(['wait', 'send_message', 'set_conversation_status'])
    expect(spec.steps[0].config).toEqual({ amount: 30, unit: 'minutes' })
    expect(spec.steps[2].config).toEqual({ status: 'closed' })
  })

  it('recognizes first-message and any-message triggers', () => {
    expect(parseScript('When: first message').trigger.type).toBe('first_inbound_message')
    expect(parseScript('Trigger: any message').trigger.type).toBe('new_message_received')
  })
})

describe('AI output parsing', () => {
  it('strips code fences and reads the JSON', () => {
    const spec = parseAiDraft('```json\n{"trigger":{"type":"keyword_match","keywords":["a"]},"steps":[{"type":"send_message","text":"hi"}],"warnings":["check this"]}\n```')
    expect(spec.trigger).toEqual({ type: 'keyword_match', config: { keywords: ['a'] } })
    expect(spec.steps[0]).toMatchObject({ type: 'send_message', config: { text: 'hi' } })
    expect(spec.notes).toEqual([{ level: 'warning', message: 'check this' }])
  })

  it('throws a clear error on unusable output', () => {
    expect(() => parseAiDraft('Sorry, I cannot help with that.')).toThrow(/usable automation/)
  })
})

describe('campaign inference', () => {
  it('finds the one campaign a script mentions', () => {
    expect(inferCampaignFromScript('Send WINCOKE to enter', catalog.campaigns)).toBe(COKE)
    expect(inferCampaignFromScript('Coca-Cola Summer Competition welcome', catalog.campaigns)).toBe(COKE)
  })

  it('returns null when none or several match', () => {
    expect(inferCampaignFromScript('Hello there', catalog.campaigns)).toBeNull()
    expect(inferCampaignFromScript('COKE and WINICC2027', catalog.campaigns)).toBeNull()
  })
})
