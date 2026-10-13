import { AiError } from '@/lib/ai/types'
import { catalogRefs } from './normalize'
import { GENERATOR_TRIGGERS, type DraftSpec, type DraftStep, type GeneratorCatalog } from './types'

// ------------------------------------------------------------
// AI path: the account's own provider turns a free-form script into
// JSON in the generator's draft shape. The model only ever sees short
// refs (C1, F1, T1) for records, never ids, and its output goes through
// normalizeDraft like the built-in parser's, so nothing it returns is
// trusted as-is or executed.
// ------------------------------------------------------------

export const GENERATOR_MAX_TOKENS = 4000
const MAX_STEPS = 60

const STEP_FIELDS = `
- send_message: { "text": string }
- send_media: { "media_type": "image"|"video"|"document"|"audio", "url": direct file URL, "caption"?: string }
- send_template: { "template_name": one of the approved templates }
- ask_question: { "text": string, "var_key": snake_case name for the answer, "timeout_hours"?: number }
- wait: { "amount": number, "unit": "minutes"|"hours"|"days" }
- condition: { "subject": "message_content", "value": text to look for } or { "subject": "tag_presence", "operand": tag ref } or { "subject": "contact_field", "operand": "name"|"email"|"company"|"phone", "value": string } or { "subject": "time_of_day", "operand": "HH:mm-HH:mm" }, plus "yes": [steps], "no": [steps]
- campaign_add_entry: { "campaign_id": campaign ref }
- campaign_set_status: { "status": "in_progress"|"completed"|"invalid"|"duplicate"|"disqualified"|"withdrawn" }
- campaign_generate_reference: {}
- campaign_set_field: { "field_key": snake_case, "value": string }
- start_flow: { "flow_id": flow ref }
- add_tag / remove_tag: { "tag_id": tag ref }
- add_note: { "text": string }
- set_conversation_status: { "status": "open"|"pending"|"closed" }
- close_conversation: {}
- end: {}`

export function buildGeneratorPrompt(catalog: GeneratorCatalog, selectedCampaignId: string | null): string {
  const refs = catalogRefs(catalog)
  const campaigns = refs.campaigns.map(({ ref, record: c }) =>
    `${ref}: "${c.name}" (code ${c.code}${c.keyword ? `, keyword ${c.keyword}` : ''}${c.client_name ? `, client ${c.client_name}` : ''}, ${c.status})`)
  const flows = refs.flows.map(({ ref, record: f }) => `${ref}: "${f.name}" (${f.status})`)
  const tags = refs.tags.map(({ ref, record: t }) => `${ref}: "${t.name}"`)
  const selected = refs.campaigns.find((c) => c.record.id === selectedCampaignId)?.ref

  return [
    'You convert a WhatsApp CRM automation script into JSON. Reply with ONE JSON object and nothing else: no prose, no code fences.',
    '',
    'Shape: { "trigger": { "type": ..., "keywords"?: [string], "match_type"?: "word"|"contains"|"exact"|"starts_with"|"ends_with" }, "steps": [step], "warnings": [string] }',
    'Each step: { "type": ..., ...fields }. Steps run in order.',
    `Trigger types: ${GENERATOR_TRIGGERS.join(', ')}. keyword_match needs "keywords".`,
    `Step types and fields:${STEP_FIELDS}`,
    '',
    'Rules:',
    '- Use only the trigger and step types above. If the script asks for something they cannot do, leave it out and say so in "warnings".',
    '- Refer to campaigns, flows and tags only by the refs listed below (C1, F1, T1). Never write an id. If the script names one that is not listed, put the name it used in the field and add a warning.',
    '- YouTube, Vimeo and other web pages go inside a send_message text. send_media is only for links that point straight at a file (.jpg, .png, .mp4, .pdf, .mp3).',
    '- Copy message wording from the script exactly, including emoji and line breaks. Do not invent messages, links or keywords; when something is missing use an empty string and add a warning.',
    '- Variables: {{ contact.name }}, {{ vars.<var_key> }}, {{ message.text }}, {{ campaign.name }}, {{ entry.reference }}.',
    '- At most one campaign_add_entry per campaign, placed before any step that uses the entry.',
    '- Plain messages only deliver within 24 hours of the customer\'s last message. After a longer wait, use send_template.',
    '',
    `Campaigns:\n${campaigns.join('\n') || '(none)'}`,
    `Selected campaign: ${selected ?? 'none'}`,
    `Flows:\n${flows.join('\n') || '(none)'}`,
    `Tags:\n${tags.join('\n') || '(none)'}`,
    `Approved templates: ${catalog.templates.map((t) => `"${t.name}"`).join(', ') || '(none)'}`,
  ].join('\n')
}

function asObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

function toDraftSteps(raw: unknown, budget: { left: number }): DraftStep[] {
  if (!Array.isArray(raw)) return []
  const steps: DraftStep[] = []
  for (const item of raw) {
    const o = asObject(item)
    if (!o || budget.left <= 0) continue
    budget.left--
    const { type, yes, no, ...config } = o
    steps.push({
      type: typeof type === 'string' ? type : '',
      config,
      ...(type === 'condition' ? { yes: toDraftSteps(yes, budget), no: toDraftSteps(no, budget) } : {}),
    })
  }
  return steps
}

/** Parse the model's reply into a draft. Throws AiError when it isn't usable JSON. */
export function parseAiDraft(raw: string): DraftSpec {
  const text = raw.replace(/```(?:json)?/gi, '')
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  let parsed: unknown = null
  if (start !== -1 && end > start) {
    try {
      parsed = JSON.parse(text.slice(start, end + 1))
    } catch {
      parsed = null
    }
  }
  const obj = asObject(parsed)
  if (!obj) {
    throw new AiError('The AI reply wasn\'t a usable automation. Try again, or use the built-in parser.', {
      code: 'invalid_output',
      status: 502,
    })
  }
  const trig = asObject(obj.trigger) ?? {}
  const { type, ...triggerConfig } = trig
  const budget = { left: MAX_STEPS }
  const steps = toDraftSteps(obj.steps, budget)
  const notes = (Array.isArray(obj.warnings) ? obj.warnings : [])
    .filter((w): w is string => typeof w === 'string' && w.trim().length > 0)
    .slice(0, 20)
    .map((message) => ({ level: 'warning' as const, message: message.slice(0, 300) }))
  if (budget.left <= 0) {
    notes.push({ level: 'warning', message: `Only the first ${MAX_STEPS} steps were kept.` })
  }
  return {
    trigger: { type: typeof type === 'string' ? type : '', config: triggerConfig },
    steps,
    notes,
  }
}

export function aiUserMessage(name: string, script: string): string {
  return `Automation name: ${name || '(none)'}\nScript:\n<<<\n${script}\n>>>`
}