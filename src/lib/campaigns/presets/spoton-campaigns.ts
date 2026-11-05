// SPOT ON campaign presets: the standard closing message, the rebuilt
// BMW test-drive automation, and a draft Flow per campaign.
//
// Pure data, no database ids (campaign ids are passed in). Applied by
// scripts/setup-campaign-drafts.mjs, which only ever creates drafts /
// inactive automations. Only `import type` here, so plain Node can
// load this file.

import type { CampaignFieldType } from '@/types'
import type { LanguageCode } from '@/lib/automations/language'

/** Every SPOT ON campaign automation and flow ends with this. */
export const CAMPAIGN_CLOSING =
  'Thanks for entering! 🎉\nWant to stay up to date with more competitions, news and opportunities?\nJoin the SPOT ON channel: https://whatsapp.com/channel/0029VbCkl4K3mFYD5DXE8g1r'

export interface PresetStep {
  step_type: string
  step_config: Record<string, unknown>
  branches?: { yes?: PresetStep[]; no?: PresetStep[] }
}

// ------------------------------------------------------------
// BMW Test Drive Experience — automation (rebuilt)
// ------------------------------------------------------------

export const BMW_AUTOMATION = {
  name: 'BMW — Test Drive Campaign Automation',
  description:
    'Customer sends BMWTEST2026 or BMW → entry added → menu (test drive / information / contact). Each choice is recorded, assigned and acknowledged, then the entry is completed and the SPOT ON closing is sent.',
}

export function bmwTriggerConfig(campaignId: string) {
  return {
    keywords: ['BMWTEST2026', 'BMW'],
    // Whole message or leading word: "BMW", "bmw please" — not "my BMW broke".
    match_type: 'exact' as const,
    case_sensitive: false,
    campaign_id: campaignId,
  }
}

export const BMW_FIELDS: {
  key: string
  label: string
  field_type: CampaignFieldType
  options: string[] | null
}[] = [
  { key: 'interest', label: 'Interest', field_type: 'select', options: ['Test drive', 'BMW information', 'Contact BMW team'] },
  { key: 'test_drive_details', label: 'Test drive model & area', field_type: 'text', options: null },
]

export const BMW_MESSAGES = {
  welcome:
    "Welcome to the BMW Test Drive Experience! We're excited to have you join us. What are you interested in?",
  retry: 'Please tap one of the options above: Book a test drive, BMW information or Contact BMW team.',
  testDriveQuestion:
    'Great choice! Which BMW model would you like to test drive, and which area or dealership suits you best?',
  testDriveAck: 'Thank you! A member of the BMW team will contact you to arrange your test drive.',
  infoAck: 'Thank you! A member of the BMW team will send you more information shortly.',
  contactAck: 'Thank you! A member of the BMW team will be in touch with you shortly.',
}

const BMW_BUTTONS = [
  { id: 'bmw_test_drive', title: 'Book a test drive' },
  { id: 'bmw_info', title: 'BMW information' },
  { id: 'bmw_contact', title: 'Contact BMW team' },
]

// Each branch completes the entry and sends the closing itself: after a
// wait inside a branch (the test-drive question) the engine resumes and
// finishes that branch only, so steps after the condition wouldn't run.
function bmwRoute(campaignId: string, interest: string, ack: string, extra: PresetStep[] = []): PresetStep[] {
  return [
    { step_type: 'campaign_set_field', step_config: { field_key: 'interest', value: interest } },
    ...extra,
    { step_type: 'add_note', step_config: { text: `BMW Test Drive Experience: customer chose "${interest}".` } },
    { step_type: 'assign_conversation', step_config: { mode: 'round_robin' } },
    { step_type: 'send_message', step_config: { text: ack } },
    {
      step_type: 'notify_agent',
      step_config: { title: `BMW Test Drive: ${interest}`, body: '{{contact.name}} ({{contact.phone}}) chose ' + interest + '.' },
    },
    { step_type: 'campaign_set_status', step_config: { campaign_id: campaignId, status: 'completed' } },
    { step_type: 'send_message', step_config: { text: CAMPAIGN_CLOSING } },
  ]
}

export function bmwSteps(campaignId: string): PresetStep[] {
  return [
    { step_type: 'campaign_add_entry', step_config: { campaign_id: campaignId } },
    {
      step_type: 'send_buttons',
      step_config: {
        kind: 'buttons',
        body: BMW_MESSAGES.welcome,
        buttons: BMW_BUTTONS,
        wait_for_reply: true,
        var_key: 'interest',
        timeout_hours: 24,
      },
    },
    {
      step_type: 'validate',
      step_config: {
        var_key: 'interest',
        rule: 'regex',
        pattern: '[Tt][Ee][Ss][Tt]|[Ii][Nn][Ff][Oo]|[Cc][Oo][Nn][Tt][Aa][Cc][Tt]',
        on_invalid: 'retry',
        retry_text: BMW_MESSAGES.retry,
        max_attempts: 3,
      },
    },
    {
      step_type: 'condition',
      step_config: { subject: 'message_content', operand: 'test' },
      branches: {
        yes: bmwRoute(campaignId, 'Test drive', BMW_MESSAGES.testDriveAck, [
          {
            step_type: 'ask_question',
            step_config: { text: BMW_MESSAGES.testDriveQuestion, var_key: 'test_drive_details', timeout_hours: 24 },
          },
          {
            step_type: 'campaign_set_field',
            step_config: { field_key: 'test_drive_details', value: '{{vars.test_drive_details}}' },
          },
        ]),
        no: [
          {
            step_type: 'condition',
            step_config: { subject: 'message_content', operand: 'info' },
            branches: {
              yes: bmwRoute(campaignId, 'BMW information', BMW_MESSAGES.infoAck),
              no: bmwRoute(campaignId, 'Contact BMW team', BMW_MESSAGES.contactAck),
            },
          },
        ],
      },
    },
  ]
}

// ------------------------------------------------------------
// Draft Flows, one per campaign with an automation
// ------------------------------------------------------------
//
// Trigger is `manual`: a manual flow never starts from an inbound
// message, so these can't intercept a campaign keyword. They start only
// from an automation's Start Flow step. Flows have no campaign-entry
// node, so the campaign automation stays the entry point that records
// the entry.

export interface PresetFlowNode {
  node_key: string
  node_type: string
  config: Record<string, unknown>
}

export interface PresetFlow {
  name: string
  description: string
  /** Campaign code the flow belongs to. */
  campaign_code: string
  trigger_type: 'manual'
  trigger_config: Record<string, never>
  entry_node_id: string
  nodes: PresetFlowNode[]
}

const closingNodes = (then: string): PresetFlowNode[] => [
  { node_key: 'closing', node_type: 'send_message', config: { text: CAMPAIGN_CLOSING, next_node_key: then } },
]
const endNode: PresetFlowNode = { node_key: 'end', node_type: 'end', config: {} }

export const CAMPAIGN_FLOWS: PresetFlow[] = [
  {
    name: 'Share a Coke — Win R20,000 — Flow',
    description:
      'Flow version of the Share a Coke conversation. Flows cannot record campaign entries or enforce the one-entry rule, so the automation remains the entry point.',
    campaign_code: 'SHAREACOKE',
    trigger_type: 'manual',
    trigger_config: {},
    entry_node_id: 'start',
    nodes: [
      { node_key: 'start', node_type: 'start', config: { next_node_key: 'ask_share' } },
      {
        node_key: 'ask_share',
        node_type: 'collect_input',
        config: {
          prompt_text:
            'Welcome to Share a Coke! You could win R20,000! Tell us who you would share a Coke with and why. Reply with your answer to enter the competition. Terms and conditions apply.\n\nWatch the advert: https://www.youtube.com/watch?v=0Ab-F7Y3IXc',
          var_key: 'share_answer',
          next_node_key: 'confirmation',
        },
      },
      {
        node_key: 'confirmation',
        node_type: 'send_message',
        config: {
          text: 'Thanks for entering Share a Coke! Your competition entry has been received. Good luck! Please refer to the official terms and conditions for eligibility, closing dates and winner selection.',
          next_node_key: 'closing',
        },
      },
      ...closingNodes('end'),
      endNode,
    ],
  },
  {
    name: 'WINICC2027 — Flow',
    description: 'Flow version of the WINICC2027 automation. Start it from the automation with a Start Flow step.',
    campaign_code: 'WINICC2027',
    trigger_type: 'manual',
    trigger_config: {},
    entry_node_id: 'start',
    nodes: [
      { node_key: 'start', node_type: 'start', config: { next_node_key: 'welcome' } },
      {
        node_key: 'welcome',
        node_type: 'send_message',
        config: { text: "Welcome to the WINICC2027 campaign!\nYou're officially in.\nHere's how it works 👇", next_node_key: 'question' },
      },
      {
        node_key: 'question',
        node_type: 'send_list',
        config: {
          header_text: 'Answer the question below:',
          text: 'What year did the ICC event begin?',
          button_label: 'Answers',
          sections: [
            {
              title: 'Options',
              rows: [
                { reply_id: 'row_1', title: 'A. 2000', next_node_key: 'closing' },
                { reply_id: 'row_2', title: 'B. 2003', next_node_key: 'closing' },
                { reply_id: 'row_3', title: 'C. 2005', next_node_key: 'closing' },
                { reply_id: 'row_4', title: 'D. 2007', next_node_key: 'closing' },
              ],
            },
          ],
        },
      },
      ...closingNodes('end'),
      endNode,
    ],
  },
  {
    name: 'BMW Test Drive Experience — Flow',
    description: 'Flow version of the BMW test-drive automation. Start it from the automation with a Start Flow step.',
    campaign_code: 'BMWTEST2026',
    trigger_type: 'manual',
    trigger_config: {},
    entry_node_id: 'start',
    nodes: [
      { node_key: 'start', node_type: 'start', config: { next_node_key: 'menu' } },
      {
        node_key: 'menu',
        node_type: 'send_buttons',
        config: {
          text: BMW_MESSAGES.welcome,
          buttons: [
            { reply_id: 'bmw_test_drive', title: 'Book a test drive', next_node_key: 'test_drive_details' },
            { reply_id: 'bmw_info', title: 'BMW information', next_node_key: 'info_ack' },
            { reply_id: 'bmw_contact', title: 'Contact BMW team', next_node_key: 'contact_ack' },
          ],
        },
      },
      {
        node_key: 'test_drive_details',
        node_type: 'collect_input',
        config: { prompt_text: BMW_MESSAGES.testDriveQuestion, var_key: 'test_drive_details', next_node_key: 'test_drive_ack' },
      },
      { node_key: 'test_drive_ack', node_type: 'send_message', config: { text: BMW_MESSAGES.testDriveAck, next_node_key: 'closing' } },
      { node_key: 'info_ack', node_type: 'send_message', config: { text: BMW_MESSAGES.infoAck, next_node_key: 'closing' } },
      { node_key: 'contact_ack', node_type: 'send_message', config: { text: BMW_MESSAGES.contactAck, next_node_key: 'closing' } },
      ...closingNodes('handoff'),
      {
        node_key: 'handoff',
        node_type: 'handoff',
        config: { note: 'BMW Test Drive lead. Test drive model & area: {{vars.test_drive_details}}' },
      },
    ],
  },
  {
    name: 'OUTsurance — Flow',
    description: 'Flow version of the OUTsurance automation. Start it from the automation with a Start Flow step.',
    campaign_code: 'OUTSURANCE',
    trigger_type: 'manual',
    trigger_config: {},
    entry_node_id: 'start',
    nodes: [
      { node_key: 'start', node_type: 'start', config: { next_node_key: 'ask_name' } },
      {
        node_key: 'ask_name',
        node_type: 'collect_input',
        config: {
          prompt_text: "Welcome to OUTsurance! 👋 Thank you for your interest. What's your name?",
          var_key: 'customer_name',
          next_node_key: 'callback',
        },
      },
      {
        node_key: 'callback',
        node_type: 'send_message',
        config: {
          text: "Thanks {{vars.customer_name}}! Please save this number: 08 600 60 000. That's OUTsurance, and we will call you.",
          next_node_key: 'closing',
        },
      },
      ...closingNodes('handoff'),
      { node_key: 'handoff', node_type: 'handoff', config: { note: 'OUTsurance call back: {{vars.customer_name}}.' } },
    ],
  },
]

// ------------------------------------------------------------
// SPOTON — Universal Welcome + language choice
// ------------------------------------------------------------
//
// Three automations, none of which waits for a reply (a wait would
// swallow the customer's next message, so a typed keyword like SAVE
// would be lost):
//
// 1. Universal Welcome (catch-all, new_message_received): once per
//    contact (tag "SPOT ON welcomed"), sends the language list.
// 2. Language chosen (interactive_reply on the list rows): saves the
//    language as a "Language: …" tag, then sends the campaign menu in
//    that language. Every later message step that has a translation
//    for it is sent in that language too.
// 3. Change language (keyword LANGUAGE / TAAL / ULIMI / ULWIMI / PUO):
//    sends the list again.
//
// Keywords always still work, because keyword automations run before
// the catch-all. Menu taps arrive as normal messages whose text is the
// button title, so each fires its campaign's keyword automation.
//
// Translations below need a check by a first-language speaker before
// going live.

export const UNIVERSAL_WELCOME = {
  name: 'SPOTON — Universal Welcome',
  description:
    'Catch-all for messages that match no keyword. Once per contact (tag "SPOT ON welcomed") it asks the customer to choose a language; the choice is handled by "SPOTON — Language chosen".',
  tagName: 'SPOT ON welcomed',
}

export const LANGUAGE_CHOSEN = {
  name: 'SPOTON — Language chosen',
  description:
    'Fires when a customer taps a language in the welcome list. Saves it as a "Language: …" tag and sends the campaign menu in that language.',
}

export const CHANGE_LANGUAGE = {
  name: 'SPOTON — Change language',
  description: 'Customer sends LANGUAGE (or TAAL / ULIMI / ULWIMI / PUO) → the language list again.',
  keywords: ['LANGUAGE', 'LANG', 'TAAL', 'ULIMI', 'ULWIMI', 'PUO'],
}

/**
 * The languages offered, in list order. Same codes and names as
 * LANGUAGES in @/lib/automations/language (a test checks); repeated
 * here so plain Node can load this file.
 */
export const PICKER_LANGUAGES: { code: LanguageCode; name: string }[] = [
  { code: 'en', name: 'English' },
  { code: 'af', name: 'Afrikaans' },
  { code: 'zu', name: 'isiZulu' },
  { code: 'xh', name: 'isiXhosa' },
  { code: 'st', name: 'Sesotho' },
]

/** List row ids, one per language: `lang_<code>`. */
export const LANGUAGE_ROW_IDS = PICKER_LANGUAGES.map((l) => `lang_${l.code}`)

export const LANGUAGE_PICKER = {
  kind: 'list' as const,
  header: 'SPOT ON',
  body:
    'Welcome to SPOT ON! 👋 Please choose your language.\n\n' +
    'Welkom! Kies asseblief jou taal.\n' +
    'Siyakwamukela! Sicela ukhethe ulimi lwakho.\n' +
    'Wamkelekile! Nceda ukhethe ulwimi lwakho.\n' +
    'Rea o amohela! Ka kopo kgetha puo ya hao.',
  footer: 'Send LANGUAGE to change it later',
  button_label: 'Choose language',
  sections: [
    {
      title: 'Languages',
      rows: PICKER_LANGUAGES.map((l) => ({ id: `lang_${l.code}`, title: l.name })),
    },
  ],
}

/** Button title must contain the campaign keyword (taps are matched by title). */
export const UNIVERSAL_WELCOME_BUTTONS = [
  { id: 'menu_outsurance', title: 'SAVE – OUTsurance', keyword: 'SAVE' },
  // Share a Coke: add { id: 'menu_coke', title: 'SHARE – Coca-Cola', keyword: 'SHARE' } to promote it here.
  { id: 'menu_icc', title: 'WINICC2027 – ICC', keyword: 'WINICC2027' },
]

export const UNIVERSAL_WELCOME_BODY =
  "Welcome to SPOT ON! 👋\n\nWe have a few deals and competitions running right now. Tap one below to enter, or send its keyword at any time."

/** The campaign menu body per language. Button titles stay the same (they carry the keyword). */
export const UNIVERSAL_WELCOME_BODY_TRANSLATIONS: Record<Exclude<LanguageCode, 'en'>, string> = {
  af: 'Welkom by SPOT ON! 👋\n\nOns het tans ’n paar aanbiedinge en kompetisies. Tik op een hieronder om in te skryf, of stuur enige tyd die sleutelwoord.',
  zu: 'Siyakwamukela ku-SPOT ON! 👋\n\nSinezipesheli nemiqhudelwano embalwa okwamanje. Thepha okukodwa ngezansi ukuze ungenele, noma uthumele igama lakho elingukhiye noma nini.',
  xh: 'Wamkelekile kwi-SPOT ON! 👋\n\nSinezaphulelo nokhuphiswano oluqhubekayo ngoku. Cofa enye engezantsi ukuze ungenele, okanye uthumele igama layo eliphambili nanini na.',
  st: 'Rea o amohela ho SPOT ON! 👋\n\nRe na le dithekiso le ditlhodisano tse mmalwa hona jwale. Tobetsa e nngwe ka tlase ho kena, kapa o romele lentswe la yona la sehlooho neng kapa neng.',
}

export const WELCOME_FOOTER_TRANSLATIONS: Record<Exclude<LanguageCode, 'en'>, string> = {
  af: 'Stuur TAAL om jou taal te verander',
  zu: 'Thumela ULIMI ukuze ushintshe ulimi',
  xh: 'Thumela ULWIMI ukutshintsha ulwimi',
  st: 'Romela PUO ho fetola puo',
}

function campaignMenuStep(): PresetStep {
  const buttons = UNIVERSAL_WELCOME_BUTTONS.map(({ id, title }) => ({ id, title }))
  return {
    step_type: 'send_buttons',
    step_config: {
      kind: 'buttons',
      header: 'SPOT ON',
      body: UNIVERSAL_WELCOME_BODY,
      footer: 'Send LANGUAGE to change language',
      buttons,
      translations: Object.fromEntries(
        Object.entries(UNIVERSAL_WELCOME_BODY_TRANSLATIONS).map(([code, body]) => [
          code,
          { body, footer: WELCOME_FOOTER_TRANSLATIONS[code as Exclude<LanguageCode, 'en'>] },
        ]),
      ),
    },
  }
}

function languagePickerStep(): PresetStep {
  return { step_type: 'send_list', step_config: { ...LANGUAGE_PICKER } }
}

/** 1. Catch-all: once per contact, ask for a language. */
export function universalWelcomeSteps(welcomedTagId: string): PresetStep[] {
  return [
    {
      step_type: 'condition',
      step_config: { subject: 'tag_presence', operand: welcomedTagId },
      branches: {
        yes: [{ step_type: 'end', step_config: { reason: 'already welcomed' } }],
        no: [
          languagePickerStep(),
          // Tagged after the send, so a failed send is retried next message.
          { step_type: 'add_tag', step_config: { tag_id: welcomedTagId } },
        ],
      },
    },
  ]
}

/** 2. A language row was tapped: save it, then the menu in that language. */
export function languageChosenTriggerConfig() {
  return { reply_ids: [...LANGUAGE_ROW_IDS] }
}

export function languageChosenSteps(welcomedTagId: string): PresetStep[] {
  return [
    // The tap's text is the row title ("isiZulu").
    { step_type: 'set_language', step_config: { value: '{{message.text}}' } },
    { step_type: 'add_tag', step_config: { tag_id: welcomedTagId } },
    campaignMenuStep(),
  ]
}

/** 3. LANGUAGE / TAAL / … → the list again. */
export function changeLanguageTriggerConfig() {
  return { keywords: [...CHANGE_LANGUAGE.keywords], match_type: 'exact' as const, case_sensitive: false }
}

export function changeLanguageSteps(): PresetStep[] {
  return [languagePickerStep()]
}
