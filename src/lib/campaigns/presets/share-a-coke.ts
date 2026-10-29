// Share a Coke — Win R20,000. WhatsApp competition preset (keyword SHAREACOKE).
//
// Formerly the Coca-Cola Summer Competition: same campaign row and
// automation, updated in place by scripts/setup-share-a-coke.mjs.
// Pure data, no database ids. Only `import type`, so plain Node can load it.

import type { AutomationTriggerType, CampaignSettings, CampaignFieldType } from '@/types'

export const SHARE_A_COKE_KEYWORD = 'SHAREACOKE'
export const SHARE_A_COKE_ADVERT = 'https://www.youtube.com/watch?v=0Ab-F7Y3IXc'
export const SHARE_A_COKE_LEGACY_CODE = 'COKE'
export const SHARE_A_COKE_LEGACY_AUTOMATION_NAME = 'Coca-Cola Summer Competition'

export const SHARE_A_COKE_CAMPAIGN = {
  name: 'Share a Coke — Win R20,000',
  code: 'SHAREACOKE',
  keyword: SHARE_A_COKE_KEYWORD,
  description:
    'WhatsApp competition: send SHAREACOKE, tell us who you would share a Coke with and why. Prize R20,000. One entry per WhatsApp number; winner by audited random draw after the competition closes.',
  status: 'draft' as const,
  settings: {
    client_name: 'Coca-Cola',
    whatsapp_number: '27798637339',
    // One entry per WhatsApp number for the whole competition.
    duplicate_rule: 'whatsapp',
    // Can't be activated until the published T&C link is set.
    terms_required: true,
    closed_message:
      'Thanks for your interest in Share a Coke! The competition is not open for entries right now. Please see the official terms and conditions for the competition dates.',
    duplicate_message:
      "You've already entered Share a Coke. Only one entry per WhatsApp number is allowed. Good luck! Please refer to the official terms and conditions for eligibility, closing dates and winner selection.",
  } satisfies CampaignSettings,
}

export const SHARE_A_COKE_ANSWER_VAR = 'share_answer'

export const SHARE_A_COKE_FIELDS: {
  key: string
  label: string
  field_type: CampaignFieldType
  options: string[] | null
}[] = [{ key: 'answer', label: 'Who and why', field_type: 'text', options: null }]

export const SHARE_A_COKE_MESSAGES = {
  welcome: `Welcome to Share a Coke! You could win R20,000! Tell us who you would share a Coke with and why. Reply with your answer to enter the competition. Terms and conditions apply: {{campaign.terms_url}}\n\nWatch the advert: ${SHARE_A_COKE_ADVERT}`,
  retry:
    "Please tell us who you would share a Coke with and why, in a sentence of at least 10 characters, to enter the competition.",
  confirmation:
    'Thanks for entering Share a Coke! Your competition entry has been received. Good luck! Please refer to the official terms and conditions for eligibility, closing dates and winner selection.',
  /** Standard closing every SPOT ON campaign automation ends with. */
  closing:
    'Thanks for entering! 🎉\nWant to stay up to date with more competitions, news and opportunities?\nJoin the SPOT ON channel: https://whatsapp.com/channel/0029VbCkl4K3mFYD5DXE8g1r',
}

/**
 * At least 10 characters, and not just the keyword. The engine compiles
 * this with no flags and trims the answer first.
 */
export const SHARE_A_COKE_ANSWER_PATTERN = '^(?![Ss][Hh][Aa][Rr][Ee] ?[Aa] ?[Cc][Oo][Kk][Ee]$)[\\s\\S]{10,}$'

export const SHARE_A_COKE_AUTOMATION = {
  name: 'Share a Coke — Win R20,000',
  description:
    'SHAREACOKE → entry (In Progress; Draft = test numbers only) → welcome → answer (≥10 chars, re-asked up to 3×) → answer saved, entry Completed → confirmation → SPOT ON closing. Repeat entrants get the duplicate reply.',
  trigger_type: 'keyword_match' as AutomationTriggerType,
}

export function shareACokeTriggerConfig(campaignId: string) {
  return {
    keywords: [SHARE_A_COKE_KEYWORD],
    // Whole message or leading word, any case: "SHAREACOKE", "shareacoke pls".
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
 * The entry is added first: that is where the campaign's status, dates,
 * test numbers and one-entry rule are enforced, before any message goes
 * out. It stays In Progress (not eligible) until a valid answer is saved.
 * Every send answers an inbound message, so it is inside the 24-hour window.
 */
export function shareACokeSteps(campaignId: string): PresetStep[] {
  return [
    { step_type: 'campaign_add_entry', step_config: { campaign_id: campaignId } },
    {
      step_type: 'ask_question',
      step_config: { text: SHARE_A_COKE_MESSAGES.welcome, var_key: SHARE_A_COKE_ANSWER_VAR, timeout_hours: 24 },
    },
    {
      step_type: 'validate',
      step_config: {
        var_key: SHARE_A_COKE_ANSWER_VAR,
        rule: 'regex',
        pattern: SHARE_A_COKE_ANSWER_PATTERN,
        on_invalid: 'retry',
        retry_text: SHARE_A_COKE_MESSAGES.retry,
        max_attempts: 3,
      },
    },
    {
      step_type: 'campaign_set_field',
      step_config: { field_key: 'answer', value: `{{vars.${SHARE_A_COKE_ANSWER_VAR}}}` },
    },
    { step_type: 'campaign_set_status', step_config: { campaign_id: campaignId, status: 'completed' } },
    { step_type: 'send_message', step_config: { text: SHARE_A_COKE_MESSAGES.confirmation } },
    { step_type: 'send_message', step_config: { text: SHARE_A_COKE_MESSAGES.closing } },
  ]
}
