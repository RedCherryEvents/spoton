// OUTsurance — WhatsApp lead-generation campaign preset (keyword SAVE).
//
// Formerly the Hollard Pay as You Drive campaign: same campaign row,
// keyword, WhatsApp number and QR code (https://wa.me/27798637339?text=SAVE).
//
// Pure data: no database ids. The campaign id is passed in once the
// campaign row exists. Applied by scripts/setup-outsurance.mjs.
// Only `import type` here, so plain Node can load this file.

import type { AutomationTriggerType, CampaignSettings, CampaignFieldType } from '@/types'

export const OUTSURANCE_WHATSAPP_DISPLAY = '+27 79 863 7339'
export const OUTSURANCE_WHATSAPP_NUMBER = '27798637339'
export const OUTSURANCE_KEYWORD = 'SAVE'
/** OUTsurance's own number the customer is asked to save. */
export const OUTSURANCE_CALL_NUMBER = '08 600 60 000'

/** Campaign code before the rename; the setup script migrates it. */
export const OUTSURANCE_LEGACY_CODE = 'HOLLARDPAYD'
export const OUTSURANCE_LEGACY_AUTOMATION_NAME = 'Hollard — Pay as You Drive Welcome'

export const OUTSURANCE_CAMPAIGN = {
  name: 'OUTsurance',
  code: 'OUTSURANCE',
  keyword: OUTSURANCE_KEYWORD,
  description:
    'Lead generation for OUTsurance. Customers scan the QR code or open the WhatsApp link, send SAVE and give their name; OUTsurance calls them back.',
  status: 'draft' as const,
  settings: {
    client_name: 'OUTsurance',
    whatsapp_number: OUTSURANCE_WHATSAPP_NUMBER,
    duplicate_rule: 'whatsapp',
  } satisfies CampaignSettings,
}

export const OUTSURANCE_NAME_VAR = 'customer_name'

/** The one answer this automation captures. */
export const OUTSURANCE_FIELDS: {
  key: string
  label: string
  field_type: CampaignFieldType
  options: string[] | null
}[] = [{ key: 'name', label: 'Name', field_type: 'text', options: null }]

export const OUTSURANCE_MESSAGES = {
  welcome: "Welcome to OUTsurance! 👋 Thank you for your interest. What's your name?",
  retry: 'Please reply with your name so OUTsurance can call you.',
  callback: `Thanks {{vars.${OUTSURANCE_NAME_VAR}}}! Please save this number: ${OUTSURANCE_CALL_NUMBER}. That's OUTsurance, and we will call you.`,
  /** Standard closing every SPOT ON campaign automation ends with. */
  closing:
    'Thanks for entering! 🎉\nWant to stay up to date with more competitions, news and opportunities?\nJoin the SPOT ON channel: https://whatsapp.com/channel/0029VbCkl4K3mFYD5DXE8g1r',
}

/**
 * A name must contain a letter and can't just be the keyword again
 * (someone re-sending SAVE while the question is open is re-asked).
 */
// The engine compiles this with no flags, so no \p{L}: an explicit range.
export const OUTSURANCE_NAME_PATTERN = '^(?![Ss][Aa][Vv][Ee]$).*[A-Za-zÀ-ÖØ-öø-ÿ]'

export const OUTSURANCE_AUTOMATION = {
  name: 'OUTsurance — Welcome',
  description:
    "Customer sends SAVE → added to OUTsurance (open entry reused) → asked their name → told to save 08 600 60 000 and that OUTsurance will call → team notified, entry completed, SPOT ON closing.",
  trigger_type: 'keyword_match' as AutomationTriggerType,
}

export function outsuranceTriggerConfig(campaignId: string) {
  return {
    keywords: [OUTSURANCE_KEYWORD],
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

/**
 * One question, all at the root (no branches). Every send answers an
 * inbound message, so it is inside WhatsApp's 24-hour window.
 */
export function outsuranceSteps(campaignId: string): PresetStep[] {
  const name = `{{vars.${OUTSURANCE_NAME_VAR}}}`
  return [
    { step_type: 'campaign_add_entry', step_config: { campaign_id: campaignId } },
    {
      step_type: 'ask_question',
      step_config: { text: OUTSURANCE_MESSAGES.welcome, var_key: OUTSURANCE_NAME_VAR, timeout_hours: 24 },
    },
    {
      step_type: 'validate',
      step_config: {
        var_key: OUTSURANCE_NAME_VAR,
        rule: 'regex',
        pattern: OUTSURANCE_NAME_PATTERN,
        on_invalid: 'retry',
        retry_text: OUTSURANCE_MESSAGES.retry,
        max_attempts: 3,
      },
    },
    { step_type: 'campaign_set_field', step_config: { field_key: 'name', value: name } },
    // Round robin resolves to an account member; switch to a specific
    // agent in the builder if one handles OUTsurance leads.
    { step_type: 'assign_conversation', step_config: { mode: 'round_robin' } },
    { step_type: 'send_message', step_config: { text: OUTSURANCE_MESSAGES.callback } },
    {
      step_type: 'notify_agent',
      step_config: {
        title: 'OUTsurance: call back',
        body: `${name} ({{contact.phone}}) asked OUTsurance to call them.`,
      },
    },
    { step_type: 'campaign_set_status', step_config: { campaign_id: campaignId, status: 'completed' } },
    { step_type: 'send_message', step_config: { text: OUTSURANCE_MESSAGES.closing } },
  ]
}
