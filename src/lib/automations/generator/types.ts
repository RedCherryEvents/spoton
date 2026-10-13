import type { AutomationTriggerType } from '@/types'
import type { ValidationIssue } from '../validate'

// ------------------------------------------------------------
// Automation Generator: script → draft automation in the existing
// automations / automation_steps schema. Nothing here runs or saves an
// automation; the review screen saves through the normal API.
// ------------------------------------------------------------

/** Records a generated automation may point at, all from the caller's account. */
export interface GeneratorCatalog {
  campaigns: {
    id: string
    name: string
    code: string
    keyword: string | null
    status: string
    client_name: string | null
  }[]
  flows: {
    id: string
    name: string
    status: string
    trigger_type: string
    trigger_config: Record<string, unknown>
  }[]
  tags: { id: string; name: string }[]
  /** Approved WhatsApp templates only. */
  templates: { name: string; language: string }[]
  automations: {
    id: string
    name: string
    is_active: boolean
    trigger_type: string
    trigger_config: Record<string, unknown>
  }[]
}

/**
 * Parser output before normalization. Reference fields (`campaign_id`,
 * `flow_id`, `tag_id`) may hold a catalog ref (`C1`), a real id, or a
 * name; the normalizer resolves them against the catalog and blanks
 * anything it can't find.
 */
export interface DraftStep {
  type: string
  config: Record<string, unknown>
  yes?: DraftStep[]
  no?: DraftStep[]
  /** 1-based script line, for warnings. */
  line?: number
}

export interface DraftSpec {
  trigger: { type: string; config: Record<string, unknown> }
  steps: DraftStep[]
  notes: GeneratorNote[]
}

export interface GeneratorNote {
  level: 'warning' | 'info'
  message: string
  line?: number
}

/** Same tree shape the builder posts to /api/automations. */
export interface GeneratedStep {
  step_type: string
  step_config: Record<string, unknown>
  branches?: { yes: GeneratedStep[]; no: GeneratedStep[] }
}

export interface GeneratedAutomation {
  name: string
  trigger_type: AutomationTriggerType
  trigger_config: Record<string, unknown>
  steps: GeneratedStep[]
}

export type GeneratorSource = 'ai' | 'rules'

export interface GenerateResult {
  automation: GeneratedAutomation
  campaign_id: string | null
  /** Blocking for activation; drafts can still be saved. */
  issues: ValidationIssue[]
  warnings: GeneratorNote[]
  /** Plain-language description of what the automation will do. */
  summary: string[]
  source: GeneratorSource
}

export const GENERATOR_TRIGGERS = [
  'keyword_match',
  'new_message_received',
  'first_inbound_message',
  'campaign_entry',
] as const

export const GENERATOR_STEPS = [
  'send_message',
  'send_media',
  'send_template',
  'ask_question',
  'wait',
  'condition',
  'campaign_add_entry',
  'campaign_set_status',
  'campaign_generate_reference',
  'campaign_set_field',
  'start_flow',
  'add_tag',
  'remove_tag',
  'add_note',
  'set_conversation_status',
  'close_conversation',
  'end',
] as const
