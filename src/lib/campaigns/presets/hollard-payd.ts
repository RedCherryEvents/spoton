// Hollard Pay as You Drive — WhatsApp lead-generation campaign preset.
//
// Pure data: no database ids. The campaign id is passed in once the
// campaign row exists. Applied by scripts/setup-hollard-payd.mjs, which
// creates the campaign as a draft and the automation as inactive, so
// both are reviewed in the app before anything goes live.
//
// Only `import type` here, so plain Node can load this file.

import type { AutomationTriggerType, CampaignSettings, CampaignFieldType } from '@/types'

export const HOLLARD_PAYD_WHATSAPP_DISPLAY = '+27 79 863 7339'
export const HOLLARD_PAYD_WHATSAPP_NUMBER = '27798637339'
export const HOLLARD_PAYD_KEYWORD = 'SAVE'

export const HOLLARD_PAYD_CAMPAIGN = {
  name: 'Hollard Pay as You Drive',
  code: 'HOLLARDPAYD',
  keyword: HOLLARD_PAYD_KEYWORD,
  description:
    'Lead generation for Hollard Pay as You Drive car insurance. Customers scan the QR code or open the WhatsApp link and send SAVE.',
  status: 'draft' as const,
  settings: {
    client_name: 'Hollard',
    whatsapp_number: HOLLARD_PAYD_WHATSAPP_NUMBER,
    duplicate_rule: 'whatsapp',
  } satisfies CampaignSettings,
}

/** Records which option the customer picked on their entry. */
export const HOLLARD_PAYD_REQUEST_FIELD = {
  key: 'request',
  label: 'Customer request',
  field_type: 'select' as CampaignFieldType,
  options: ['INFO', 'HELP'],
}

/**
 * What the INFO path asks, in order. Each answer is kept in vars[var_key]
 * and saved to the entry's campaign field `key`.
 */
export const HOLLARD_PAYD_INFO_QUESTIONS = [
  {
    key: 'vehicle',
    label: 'Car they drive',
    var_key: 'payd_vehicle',
    text: "Great! A few quick questions so the Hollard team can help you. We'll only share your answers with Hollard.\n\nWhich car do you drive? (make, model and year)",
  },
  {
    key: 'area',
    label: 'Where they live',
    var_key: 'payd_area',
    text: 'Thanks! Where do you live? (suburb and city)',
  },
  {
    key: 'current_premium',
    label: 'Currently paying',
    var_key: 'payd_current_premium',
    text: "And how much do you currently pay for car insurance per month? If you don't have car insurance yet, reply NONE.",
  },
] as const

/** All campaign fields this automation writes. */
export const HOLLARD_PAYD_FIELDS: {
  key: string
  label: string
  field_type: CampaignFieldType
  options: string[] | null
}[] = [
  { key: 'request', label: 'Customer request', field_type: 'select', options: ['INFO', 'HELP'] },
  ...HOLLARD_PAYD_INFO_QUESTIONS.map((q) => ({ key: q.key, label: q.label, field_type: 'text' as CampaignFieldType, options: null })),
]

export const HOLLARD_PAYD_MESSAGES = {
  welcome:
    'Welcome to Hollard Pay as You Drive! Thank you for your interest in car insurance based on how much you drive. Reply INFO to learn more or HELP if you need assistance with your enquiry.',
  retry:
    "Sorry, we didn't catch that. Please reply INFO to learn more about Hollard Pay as You Drive, or HELP if you need assistance with your enquiry.",
  infoAck:
    "Thank you! We've passed your request to the Hollard team, and someone will contact you with more information about Pay as You Drive.",
  helpAck:
    "Thank you! We've passed your request to the Hollard team, and someone will contact you to help with your enquiry.",
  /** Standard closing every SPOT ON campaign automation ends with. */
  closing:
    'Thanks for entering! 🎉\nWant to stay up to date with more competitions, news and opportunities?\nJoin the SPOT ON channel: https://whatsapp.com/channel/0029VbCkl4K3mFYD5DXE8g1r',
}

/** The reply wait is var `payd_request`; accepts INFO or HELP as a word, any case. */
export const HOLLARD_PAYD_REPLY_VAR = 'payd_request'
export const HOLLARD_PAYD_REPLY_PATTERN = '\\b(?:[Ii][Nn][Ff][Oo]|[Hh][Ee][Ll][Pp])\\b'

export const HOLLARD_PAYD_AUTOMATION = {
  name: 'Hollard — Pay as You Drive Welcome',
  description:
    'Customer sends SAVE → added to Hollard Pay as You Drive (open entry reused) → welcome. INFO asks for their car, where they live and what they pay now, then is recorded and routed; HELP is recorded and routed; anything else gets a prompt to reply INFO or HELP.',
  trigger_type: 'keyword_match' as AutomationTriggerType,
}

export function hollardPaydTriggerConfig(campaignId: string) {
  return {
    keywords: [HOLLARD_PAYD_KEYWORD],
    // Whole message or leading word, any case: "SAVE", "save please".
    match_type: 'exact' as const,
    case_sensitive: false,
    campaign_id: campaignId,
  }
}

export interface PresetStep {
  step_type: string
  step_config: Record<string, unknown>
  branches?: { yes?: PresetStep[]; no?: PresetStep[] }
}

const INFO_DETAILS =
  'Car: {{vars.payd_vehicle}}. Lives in: {{vars.payd_area}}. Currently pays: {{vars.payd_current_premium}}.'

// INFO asks the questions above, saving each answer, before routing.
function infoQuestions(): PresetStep[] {
  return HOLLARD_PAYD_INFO_QUESTIONS.flatMap((q) => [
    { step_type: 'ask_question', step_config: { text: q.text, var_key: q.var_key, timeout_hours: 24 } },
    { step_type: 'campaign_set_field', step_config: { field_key: q.key, value: `{{vars.${q.var_key}}}` } },
  ])
}

// Each branch ends with the closing itself: after a wait inside a branch
// (the INFO questions) the engine resumes and finishes that branch only,
// so a step after the condition would not run.
function routeRequest(kind: 'INFO' | 'HELP'): PresetStep[] {
  const what =
    kind === 'INFO' ? 'wants more information' : 'needs assistance with their enquiry'
  return [
    { step_type: 'campaign_set_field', step_config: { field_key: HOLLARD_PAYD_REQUEST_FIELD.key, value: kind } },
    ...(kind === 'INFO' ? infoQuestions() : []),
    {
      step_type: 'add_note',
      step_config: {
        text:
          kind === 'INFO'
            ? `Hollard Pay as You Drive: customer replied INFO and ${what}. ${INFO_DETAILS}`
            : `Hollard Pay as You Drive: customer replied HELP and ${what}. Message: "{{message.text}}"`,
      },
    },
    // Round robin resolves to an account member. Switch to a specific
    // Hollard agent during review if one is set up.
    { step_type: 'assign_conversation', step_config: { mode: 'round_robin' } },
    {
      step_type: 'send_message',
      step_config: { text: kind === 'INFO' ? HOLLARD_PAYD_MESSAGES.infoAck : HOLLARD_PAYD_MESSAGES.helpAck },
    },
    // No agent_id: notifies whoever the step above assigned.
    {
      step_type: 'notify_agent',
      step_config: {
        title: `Hollard Pay as You Drive: ${kind} request`,
        body: `{{contact.name}} ({{contact.phone}}) ${what}.` + (kind === 'INFO' ? ` ${INFO_DETAILS}` : ''),
      },
    },
    { step_type: 'send_message', step_config: { text: HOLLARD_PAYD_MESSAGES.closing } },
  ]
}

/**
 * Builder-shaped step tree. Every send answers an inbound message, so
 * it is inside WhatsApp's 24-hour customer-service window and needs no
 * template. The reply wait is capped at 24 hours for the same reason.
 */
export function hollardPaydSteps(campaignId: string): PresetStep[] {
  return [
    { step_type: 'campaign_add_entry', step_config: { campaign_id: campaignId } },
    {
      step_type: 'ask_question',
      step_config: {
        text: HOLLARD_PAYD_MESSAGES.welcome,
        var_key: HOLLARD_PAYD_REPLY_VAR,
        timeout_hours: 24,
      },
    },
    {
      step_type: 'validate',
      step_config: {
        var_key: HOLLARD_PAYD_REPLY_VAR,
        rule: 'regex',
        pattern: HOLLARD_PAYD_REPLY_PATTERN,
        on_invalid: 'retry',
        retry_text: HOLLARD_PAYD_MESSAGES.retry,
        max_attempts: 3,
      },
    },
    {
      step_type: 'condition',
      step_config: { subject: 'message_content', operand: 'info' },
      branches: { yes: routeRequest('INFO'), no: routeRequest('HELP') },
    },
  ]
}
