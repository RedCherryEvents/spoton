import type { Automation, AutomationTriggerType, KeywordMatchTriggerConfig } from '@/types'
import { keywordTextMatches } from './keyword-match'

// Pure routing decisions for an inbound WhatsApp message. The webhook
// loads everything these need in one parallel round trip
// (`loadInboundRouting` in ./engine), so deciding who handles the
// message costs no further database calls.

/** Trigger types the inbound webhook can dispatch. */
export const INBOUND_TRIGGER_TYPES = [
  'first_inbound_message',
  'new_contact_created',
  'new_message_received',
  'keyword_match',
  'interactive_reply',
] as const satisfies readonly AutomationTriggerType[]

/** A parked `automation_pending_executions` row of kind inbound_reply. */
export interface PendingReplyWait {
  id: string
  automation_id: string
  account_id: string
  user_id: string
  contact_id: string | null
  log_id: string | null
  parent_step_id: string | null
  branch: 'yes' | 'no' | null
  next_step_position: number
  run_at: string | null
  expect_var_key: string | null
  context: unknown
}

export interface InboundRouting {
  /** Active automations of the inbound trigger types, for this account. */
  automations: Automation[]
  /** The contact's pending reply wait, if any. It may have expired. */
  replyWait: PendingReplyWait | null
}

/** True when the wait is still inside its timeout. */
export function isOpenReplyWait(
  wait: Pick<PendingReplyWait, 'run_at'> | null,
  now: number = Date.now(),
): boolean {
  if (!wait) return false
  const runAt = wait.run_at ? Date.parse(wait.run_at) : NaN
  // No timeout recorded: treat it as open, which is how the resume path
  // treats it too.
  return !Number.isFinite(runAt) || runAt > now
}

/** True when an active keyword automation in `automations` matches `text`. */
export function anyKeywordAutomationMatches(automations: Automation[], text: string): boolean {
  if (!text.trim()) return false
  return automations.some(
    (a) =>
      a.trigger_type === 'keyword_match' &&
      a.is_active !== false &&
      keywordTextMatches(a.trigger_config as KeywordMatchTriggerConfig, text),
  )
}

/** The prefetched automations for one trigger type, as the dispatcher wants them. */
export function automationsForTrigger(
  automations: Automation[],
  triggerType: AutomationTriggerType,
): Automation[] {
  return automations.filter((a) => a.trigger_type === triggerType && a.is_active !== false)
}
