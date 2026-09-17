import type {
  Automation,
  AutomationLogStepResult,
  AutomationStep,
  AutomationTriggerType,
  ConditionStepConfig,
  KeywordMatchTriggerConfig,
  InteractiveReplyTriggerConfig,
  TagTriggerConfig,
  TimeBasedTriggerConfig,
  DealTriggerConfig,
  CampaignEntryTriggerConfig,
  SendMessageStepConfig,
  SendButtonsStepConfig,
  SendListStepConfig,
  SendTemplateStepConfig,
  SendWebhookStepConfig,
  SendMediaStepConfig,
  TagStepConfig,
  UpdateContactFieldStepConfig,
  UpsertContactStepConfig,
  WaitStepConfig,
  AskQuestionStepConfig,
  CaptureStepConfig,
  ValidateStepConfig,
  CreateDealStepConfig,
  UpdateDealStepConfig,
  AssignConversationStepConfig,
  AddNoteStepConfig,
  SetConversationStatusStepConfig,
  NotifyAgentStepConfig,
  CampaignAddEntryStepConfig,
  CampaignSetStatusStepConfig,
  CampaignGenerateReferenceStepConfig,
  CampaignSetFieldStepConfig,
  RandomSplitStepConfig,
  GoToStepConfig,
  EndStepConfig,
} from '@/types'
import { supabaseAdmin } from './admin-client'
import { addContactTagIfAbsent } from '@/lib/contacts/tag-write'
import { MAX_TAG_CHAIN_DEPTH, getTagChainDepth } from '@/lib/contacts/tag-chain'
import { engineSendText, engineSendTemplate, engineSendInteractive, engineSendMedia } from './meta-send'
import { validateInteractivePayload } from '@/lib/whatsapp/interactive'
import { isDeliverableUrl } from '@/lib/webhooks/ssrf'
import {
  addCampaignEntry,
  appendCampaignEntryEvent,
  campaignSnapshot,
  generateEntryReference,
  loadCampaign,
  loadEntryForContact,
  setCampaignEntryStatus,
  setCampaignFieldValue,
} from './campaign-ops'
import { minuteKey, scheduleMatchesNow } from './schedule'
import { keywordTextMatches } from './keyword-match'

export { matchesWholeWord, keywordTextMatches } from './keyword-match'

// ------------------------------------------------------------
// Public API
// ------------------------------------------------------------

export interface AutomationContext {
  /** Raw message text, for keyword_match + message_content conditions. */
  message_text?: string
  /** Conversation the event belongs to, if any. */
  conversation_id?: string
  /** Arbitrary variables accumulated during execution. */
  vars?: Record<string, unknown>
  /** The tag id that was added, for tag_added trigger. */
  tag_id?: string
  /** Agent the conversation was assigned to, for conversation_assigned. */
  agent_id?: string
  /** Button / list-row id the customer tapped, for interactive_reply. */
  interactive_reply_id?: string
  deal_id?: string
  pipeline_id?: string
  stage_id?: string
  campaign_id?: string
  contact?: {
    id?: string
    name?: string | null
    phone?: string | null
    email?: string | null
    company?: string | null
  }
  campaign?: {
    id?: string
    name?: string
    code?: string
    keyword?: string | null
    status?: string
  }
  entry?: {
    id?: string
    status?: string
    reference?: string | null
  }
  conversation?: {
    assignee?: string | null
  }
}

class AutomationEnded extends Error {
  constructor(detail: string) {
    super(detail)
    this.name = 'AutomationEnded'
  }
}

export interface DispatchInput {
  /** Account-level tenancy key. Drives the lookup of which active
   *  automations to fire — `automations.account_id` is the tenant
   *  isolation after migration 017. Replaces the previous `userId`
   *  field; the per-automation user_id is read off each row when
   *  needed (sender identity for outbound messages, log audit). */
  accountId: string
  triggerType: AutomationTriggerType
  contactId?: string | null
  context?: AutomationContext
}

/**
 * Fire all active automations matching the given trigger for an
 * account.
 *
 * Must never throw — callers use fire-and-forget from the webhook.
 * All errors are caught and logged; per-automation failures are
 * recorded into automation_logs with status='failed'.
 */
export async function runAutomationsForTrigger(input: DispatchInput): Promise<void> {
  try {
    const db = supabaseAdmin()

    // Tenant isolation. `contactId` can be caller-supplied (the manual
    // POST /api/automations/engine entrypoint reads it straight from the
    // request body), and every step below runs through the service-role
    // client, which bypasses RLS. So before any step can touch the
    // contact, verify it actually belongs to this account. A foreign or
    // forged id is refused silently — callers are fire-and-forget, and a
    // distinct error would leak whether a given contact UUID exists.
    if (input.contactId) {
      const { data: owned, error: ownErr } = await db
        .from('contacts')
        .select('id')
        .eq('id', input.contactId)
        .eq('account_id', input.accountId)
        .maybeSingle()
      if (ownErr) {
        console.error('[automations] contact ownership check failed:', ownErr)
        return
      }
      if (!owned) {
        console.warn('[automations] contact not in account, refusing dispatch', input.contactId)
        return
      }
    }

    const { data: automations, error } = await db
      .from('automations')
      .select('*')
      .eq('account_id', input.accountId)
      .eq('trigger_type', input.triggerType)
      .eq('is_active', true)

    if (error) {
      console.error('[automations] fetch failed:', error)
      return
    }
    if (!automations || automations.length === 0) return

    for (const automation of automations as Automation[]) {
      if (!triggerMatches(automation, input.context)) continue
      try {
        await executeAutomation(automation, input)
      } catch (err) {
        console.error('[automations] execute failed:', automation.id, err)
      }
    }
  } catch (err) {
    console.error('[automations] dispatch failed:', err)
  }
}

/**
 * If this contact has an inbound-wait park (Ask Question), resume it
 * with the latest message text and skip content-level triggers.
 * Returns true when a wait consumed the inbound.
 */
export async function tryResumeInboundWait(args: {
  accountId: string
  contactId: string
  conversationId?: string
  messageText: string
}): Promise<boolean> {
  const db = supabaseAdmin()
  const { data: row, error } = await db
    .from('automation_pending_executions')
    .select('*')
    .eq('account_id', args.accountId)
    .eq('contact_id', args.contactId)
    .eq('status', 'pending')
    .eq('wait_kind', 'inbound_reply')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error('[automations] inbound wait lookup failed:', error)
    return false
  }
  if (!row) return false

  const { data: claim } = await db
    .from('automation_pending_executions')
    .update({ status: 'running' })
    .eq('id', row.id)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle()
  if (!claim) return false

  const ctx = (row.context ?? {}) as AutomationContext
  const expectKey = typeof row.expect_var_key === 'string' ? row.expect_var_key : null
  const nextVars = { ...(ctx.vars ?? {}) }
  if (expectKey) nextVars[expectKey] = args.messageText

  await resumePendingExecution({
    id: row.id as string,
    automation_id: row.automation_id as string,
    account_id: row.account_id as string,
    user_id: row.user_id as string,
    contact_id: (row.contact_id as string | null) ?? null,
    log_id: (row.log_id as string | null) ?? null,
    parent_step_id: (row.parent_step_id as string | null) ?? null,
    branch: (row.branch as 'yes' | 'no' | null) ?? null,
    next_step_position: row.next_step_position as number,
    context: {
      ...ctx,
      message_text: args.messageText,
      conversation_id: args.conversationId ?? ctx.conversation_id,
      vars: nextVars,
    },
  })
  return true
}

/**
 * Fire due `time_based` automations. Called from the cron alongside
 * pending-wait drainage. Audience `none` runs once with no contact;
 * `campaign` / `tag` fan out (capped) to matching contacts.
 */
export async function fireTimeBasedAutomations(now: Date = new Date()): Promise<number> {
  const db = supabaseAdmin()
  const { data: automations, error } = await db
    .from('automations')
    .select('*')
    .eq('trigger_type', 'time_based')
    .eq('is_active', true)

  if (error) {
    console.error('[automations] time_based fetch failed:', error)
    return 0
  }
  if (!automations || automations.length === 0) return 0

  let fired = 0
  for (const automation of automations as Automation[]) {
    const cfg = (automation.trigger_config ?? {}) as TimeBasedTriggerConfig
    if (!cfg.schedule || !scheduleMatchesNow(cfg.schedule, cfg.timezone, now)) continue
    const lastKey = minuteKey(automation.last_executed_at, cfg.timezone)
    const nowKey = minuteKey(now.toISOString(), cfg.timezone)
    if (lastKey && nowKey && lastKey === nowKey) continue

    const audience = cfg.audience ?? 'none'
    if (audience === 'none') {
      await executeAutomation(automation, {
        accountId: automation.account_id,
        triggerType: 'time_based',
        contactId: null,
        context: {},
      })
      fired++
      continue
    }

    const contactIds = await resolveScheduleAudience(automation.account_id, cfg)
    for (const contactId of contactIds) {
      await executeAutomation(automation, {
        accountId: automation.account_id,
        triggerType: 'time_based',
        contactId,
        context: { campaign_id: cfg.campaign_id, tag_id: cfg.tag_id },
      })
      fired++
    }
  }
  return fired
}

async function resolveScheduleAudience(
  accountId: string,
  cfg: TimeBasedTriggerConfig,
): Promise<string[]> {
  const db = supabaseAdmin()
  if (cfg.audience === 'campaign' && cfg.campaign_id) {
    const { data } = await db
      .from('campaign_entries')
      .select('contact_id')
      .eq('account_id', accountId)
      .eq('campaign_id', cfg.campaign_id)
      .in('status', ['active', 'in_progress'])
      .limit(200)
    return (data ?? []).map((r) => r.contact_id as string).filter(Boolean)
  }
  if (cfg.audience === 'tag' && cfg.tag_id) {
    const { data: joins } = await db
      .from('contact_tags')
      .select('contact_id, contacts!inner(id, account_id)')
      .eq('tag_id', cfg.tag_id)
      .eq('contacts.account_id', accountId)
      .limit(200)
    return (joins ?? []).map((r) => r.contact_id as string).filter(Boolean)
  }
  return []
}

/**
 * Resume a run that was parked at a wait step. Called from the cron
 * endpoint after it grabs a due `automation_pending_executions` row.
 */
export async function resumePendingExecution(pending: {
  id: string
  automation_id: string
  /** Audit-only; the automation row carries account_id for tenancy. */
  user_id: string
  /** Account-scoped lookups read from the automation row, so this
   *  field is just here to mirror the row shape and keep the cron's
   *  pass-through self-documenting. */
  account_id: string
  contact_id: string | null
  log_id: string | null
  parent_step_id: string | null
  branch: 'yes' | 'no' | null
  next_step_position: number
  context: AutomationContext
}): Promise<void> {
  const db = supabaseAdmin()
  const { data: automation, error } = await db
    .from('automations')
    .select('*')
    .eq('id', pending.automation_id)
    .single()

  if (error || !automation) {
    console.error('[automations] resume: missing automation', pending.automation_id, error)
    await markPending(pending.id, 'failed')
    return
  }

  try {
    const context = await hydrateContext(
      (automation as Automation).account_id,
      pending.contact_id,
      pending.context ?? {},
    )
    try {
      await executeStepsFrom({
        automation: automation as Automation,
        contactId: pending.contact_id,
        context,
        parentStepId: pending.parent_step_id,
        branch: pending.branch,
        startPosition: pending.next_step_position,
        logId: pending.log_id,
        triggerEvent: 'resumed_wait',
      })
    } catch (err) {
      if (!(err instanceof AutomationEnded)) throw err
    }
    await markPending(pending.id, 'done')
  } catch (err) {
    console.error('[automations] resume failed:', err)
    await markPending(pending.id, 'failed')
  }
}

// ------------------------------------------------------------
// Internal execution
// ------------------------------------------------------------

async function executeAutomation(automation: Automation, input: DispatchInput) {
  const db = supabaseAdmin()
  const context = await hydrateContext(automation.account_id, input.contactId ?? null, input.context ?? {})

  const { data: log, error: logErr } = await db
    .from('automation_logs')
    .insert({
      automation_id: automation.id,
      // Tenancy: matches automation.account_id (NOT NULL post-017).
      account_id: automation.account_id,
      // Audit: keeps the historical "author of this automation"
      // pointer so logs still attribute to the right user even
      // after teammates join the account.
      user_id: automation.user_id,
      contact_id: input.contactId ?? null,
      trigger_event: input.triggerType,
      steps_executed: [],
      // Seeded pessimistically. The row is written BEFORE any step runs,
      // and every terminal path below overwrites it (`appendResults` at
      // the outermost scope, or `finalizeLog`). Seeding 'success' meant a
      // run that died mid-flight — the process frozen, the pod recycled —
      // left a permanent `status: 'success'` with `steps_executed: []`,
      // indistinguishable from an automation that genuinely had nothing
      // to do. 'failed' inverts that: the status only becomes success if
      // execution actually reached the end. See issue #409.
      status: 'failed',
    })
    .select()
    .single()

  if (logErr || !log) {
    console.error('[automations] cannot create log:', logErr)
    return
  }

  try {
    await executeStepsFrom({
      automation,
      contactId: input.contactId ?? null,
      context,
      parentStepId: null,
      branch: null,
      startPosition: 0,
      logId: log.id,
      triggerEvent: input.triggerType,
    })
  } catch (err) {
    if (!(err instanceof AutomationEnded)) throw err
  }

  // Atomic counter update via the SQL function from migration 007.
  // Doing this with a client-side read-modify-write raced when the
  // same automation fired for two contacts simultaneously — both
  // would read N and both write N+1, losing one count permanently.
  const { error: rpcErr } = await db.rpc('increment_automation_execution_count', {
    p_automation_id: automation.id,
  })
  if (rpcErr) {
    console.error('[automations] increment counter failed:', rpcErr)
  }
}

interface ExecuteArgs {
  automation: Automation
  contactId: string | null
  context: AutomationContext
  parentStepId: string | null
  branch: 'yes' | 'no' | null
  startPosition: number
  logId: string | null
  triggerEvent: string
}

async function executeStepsFrom(args: ExecuteArgs): Promise<void> {
  const db = supabaseAdmin()

  const baseQuery = db
    .from('automation_steps')
    .select('*')
    .eq('automation_id', args.automation.id)
    .gte('position', args.startPosition)
    .order('position', { ascending: true })

  const scoped =
    args.parentStepId === null
      ? baseQuery.is('parent_step_id', null)
      : baseQuery.eq('parent_step_id', args.parentStepId).eq('branch', args.branch ?? 'yes')

  const { data: steps, error: stepsErr } = await scoped

  if (stepsErr) {
    await finalizeLog(args.logId, 'failed', stepsErr.message)
    return
  }
  if (!steps || steps.length === 0) {
    if (args.parentStepId === null && args.logId) {
      await finalizeLog(args.logId, 'success', null)
    }
    return
  }

  const results: AutomationLogStepResult[] = []
  let status: 'success' | 'partial' | 'failed' = 'success'
  let errorMessage: string | null = null

  for (const step of steps as AutomationStep[]) {
    // `wait` and `ask_question` are suspension points: enqueue and stop
    // processing this scope. Cron (delay) or inbound webhook (reply)
    // pick the park up later.
    if (step.step_type === 'wait') {
      const cfg = step.step_config as WaitStepConfig
      await parkPending(args, step, {
        waitKind: 'delay',
        runAt: waitRunAt(cfg),
        detail: cfg.until
          ? `waiting until ${cfg.until}`
          : `waiting ${cfg.amount} ${cfg.unit}`,
      })
      results.push({
        step_id: step.id,
        step_type: step.step_type,
        status: 'success',
        detail: cfg.until
          ? `waiting until ${cfg.until}`
          : `waiting ${cfg.amount} ${cfg.unit}`,
      })
      status = 'partial'
      await appendResults(args.logId, results, status, errorMessage)
      return
    }

    if (step.step_type === 'ask_question') {
      const cfg = step.step_config as AskQuestionStepConfig
      if (!args.contactId) throw new Error('ask_question needs a contact')
      const text = interpolate(cfg.text, args)
      if (!text.trim()) throw new Error('ask_question has empty text')
      const conversationId = await resolveConversationId(args)
      const { whatsapp_message_id } = await engineSendText({
        accountId: args.automation.account_id,
        userId: args.automation.user_id,
        conversationId,
        contactId: args.contactId,
        text,
      })
      const hours = typeof cfg.timeout_hours === 'number' && cfg.timeout_hours > 0
        ? cfg.timeout_hours
        : 48
      await parkPending(args, step, {
        waitKind: 'inbound_reply',
        runAt: new Date(Date.now() + hours * 3_600_000),
        expectVarKey: cfg.var_key || 'answer',
        detail: `asked (${whatsapp_message_id})`,
      })
      results.push({
        step_id: step.id,
        step_type: step.step_type,
        status: 'success',
        detail: `asked via Meta (${whatsapp_message_id}); waiting for reply`,
      })
      status = 'partial'
      await appendResults(args.logId, results, status, errorMessage)
      return
    }

    try {
      if (step.step_type === 'end') {
        const cfg = step.step_config as EndStepConfig
        results.push({
          step_id: step.id,
          step_type: 'end',
          status: 'success',
          detail: cfg.reason || 'ended',
        })
        status = 'success'
        await appendResults(args.logId, results, status, errorMessage)
        throw new AutomationEnded(cfg.reason || 'ended')
      }

      if (step.step_type === 'condition' || step.step_type === 'random_split') {
        const taken = step.step_type === 'random_split'
          ? Math.random() * 100 < Number((step.step_config as RandomSplitStepConfig).percent ?? 50)
          : await evaluateCondition(step.step_config as ConditionStepConfig, args)
        results.push({
          step_id: step.id,
          step_type: step.step_type,
          status: 'success',
          detail: `branch=${taken ? 'yes' : 'no'}`,
        })
        await executeStepsFrom({
          ...args,
          parentStepId: step.id,
          branch: taken ? 'yes' : 'no',
          startPosition: 0,
          logId: args.logId,
        })
        continue
      }

      if (step.step_type === 'go_to') {
        const cfg = step.step_config as GoToStepConfig
        const target = await findStepByNodeId(args.automation.id, cfg.target_node_id)
        if (!target) throw new Error('go_to target not found')
        results.push({
          step_id: step.id,
          step_type: 'go_to',
          status: 'success',
          detail: `jump to ${cfg.target_node_id}`,
        })
        await appendResults(args.logId, results, 'partial', null)
        await executeStepsFrom({
          ...args,
          parentStepId: target.parent_step_id ?? null,
          branch: (target.branch as 'yes' | 'no' | null) ?? null,
          startPosition: target.position,
          logId: args.logId,
        })
        return
      }

      const detail = await runStep(step, args)
      results.push({
        step_id: step.id,
        step_type: step.step_type,
        status: 'success',
        detail,
      })
    } catch (err) {
      if (err instanceof AutomationEnded) {
        if (args.parentStepId === null) {
          await appendResults(args.logId, results, 'success', null)
        } else {
          await appendResults(args.logId, results, null, null)
        }
        throw err
      }
      const msg = err instanceof Error ? err.message : String(err)
      results.push({
        step_id: step.id,
        step_type: step.step_type,
        status: 'failed',
        detail: msg,
      })
      status = 'failed'
      errorMessage = msg
      break
    }
  }

  if (args.parentStepId === null) {
    await appendResults(args.logId, results, status, errorMessage)
  } else {
    // Nested branch — just append results; parent scope decides final status.
    await appendResults(args.logId, results, null, errorMessage)
  }
}

async function runStep(step: AutomationStep, args: ExecuteArgs): Promise<string> {
  const db = supabaseAdmin()

  switch (step.step_type) {
    case 'send_message': {
      const cfg = step.step_config as SendMessageStepConfig
      if (!args.contactId) throw new Error('send_message needs a contact')
      const text = interpolate(cfg.text, args)
      if (!text.trim()) throw new Error('send_message has empty text')
      const conversationId = await resolveConversationId(args)
      const { whatsapp_message_id } = await engineSendText({
        accountId: args.automation.account_id,
        userId: args.automation.user_id,
        conversationId,
        contactId: args.contactId,
        text,
      })
      if (args.context.entry?.id) {
        await appendCampaignEntryEvent({
          accountId: args.automation.account_id,
          entryId: args.context.entry.id,
          type: 'confirmation_sent',
          label: 'Confirmation sent',
          detail: whatsapp_message_id,
        })
      }
      return `sent via Meta (${whatsapp_message_id})`
    }

    case 'send_buttons':
    case 'send_list': {
      const payload = step.step_config as SendButtonsStepConfig | SendListStepConfig
      if (!args.contactId) throw new Error(`${step.step_type} needs a contact`)
      // Validate against Meta's limits before the network call so a bad
      // payload surfaces as a clear failed-step detail rather than a raw
      // Meta 400 mid-conversation.
      const check = validateInteractivePayload(payload)
      if (!check.ok) throw new Error(check.error)
      const conversationId = await resolveConversationId(args)
      const { whatsapp_message_id } = await engineSendInteractive({
        accountId: args.automation.account_id,
        userId: args.automation.user_id,
        conversationId,
        contactId: args.contactId,
        payload,
      })
      return `interactive sent via Meta (${whatsapp_message_id})`
    }

    case 'send_template': {
      const cfg = step.step_config as SendTemplateStepConfig
      if (!args.contactId) throw new Error('send_template needs a contact')
      if (!cfg.template_name) throw new Error('send_template needs template_name')
      const conversationId = await resolveConversationId(args)
      // Meta templates use positional {{1}}, {{2}}, … placeholders, so
      // we MUST emit params in strict numeric order. Lexicographic sort
      // of "1", "2", …, "10" yields "1", "10", "2", … which silently
      // scrambles every template with ≥10 variables.
      const params = cfg.variables
        ? Object.keys(cfg.variables)
            .sort((a, b) => {
              const na = Number(a)
              const nb = Number(b)
              const aNum = Number.isFinite(na)
              const bNum = Number.isFinite(nb)
              if (aNum && bNum) return na - nb
              if (aNum) return -1
              if (bNum) return 1
              return a.localeCompare(b)
            })
            .map((k) => String(cfg.variables![k]))
        : []
      const { whatsapp_message_id } = await engineSendTemplate({
        accountId: args.automation.account_id,
        userId: args.automation.user_id,
        conversationId,
        contactId: args.contactId,
        templateName: cfg.template_name,
        language: cfg.language,
        params,
      })
      return `template sent via Meta (${whatsapp_message_id})`
    }

    case 'add_tag': {
      const cfg = step.step_config as TagStepConfig
      if (!args.contactId || !cfg.tag_id) throw new Error('add_tag needs contact + tag_id')
      const added = await addContactTagIfAbsent(db, {
        accountId: args.automation.account_id,
        contactId: args.contactId,
        tagId: cfg.tag_id,
      })
      if (!added) return `tag ${cfg.tag_id} already present`

      const depth = getTagChainDepth(args.context)
      if (depth >= MAX_TAG_CHAIN_DEPTH) {
        console.warn('[automations] tag_added chain depth limit reached', {
          automationId: args.automation.id,
          contactId: args.contactId,
          tagId: cfg.tag_id,
          depth,
        })
        return `tag ${cfg.tag_id} added; tag_added dispatch skipped at depth ${depth}`
      }

      await runAutomationsForTrigger({
        accountId: args.automation.account_id,
        triggerType: 'tag_added',
        contactId: args.contactId,
        context: {
          ...args.context,
          tag_id: cfg.tag_id,
          vars: {
            ...(args.context.vars ?? {}),
            _tag_chain_depth: depth + 1,
          },
        },
      })
      return `tag ${cfg.tag_id} added and tag_added dispatched`
    }

    case 'remove_tag': {
      // See add_tag: tenant scoping relies on the runAutomationsForTrigger
      // ownership guard, since contact_tags carries no account_id.
      const cfg = step.step_config as TagStepConfig
      if (!args.contactId || !cfg.tag_id) throw new Error('remove_tag needs contact + tag_id')
      await db
        .from('contact_tags')
        .delete()
        .eq('contact_id', args.contactId)
        .eq('tag_id', cfg.tag_id)
      return `tag ${cfg.tag_id} removed`
    }

    case 'assign_conversation': {
      const cfg = step.step_config as AssignConversationStepConfig
      if (!args.contactId) throw new Error('assign_conversation needs a contact')
      let agentId = cfg.agent_id
      if (cfg.mode === 'round_robin') {
        // Pick any member of the account. The existing implementation
        // only ever returned the automation's author; preserving that
        // shape until a real round-robin algorithm replaces it.
        const { data: profiles } = await db
          .from('profiles')
          .select('user_id')
          .eq('account_id', args.automation.account_id)
          .limit(1)
        agentId = profiles?.[0]?.user_id
      }
      if (!agentId) return 'no agent resolved'
      await db
        .from('conversations')
        .update({ assigned_agent_id: agentId })
        .eq('account_id', args.automation.account_id)
        .eq('contact_id', args.contactId)
      args.context.agent_id = agentId
      args.context.conversation = { ...(args.context.conversation ?? {}), assignee: agentId }
      await runAutomationsForTrigger({
        accountId: args.automation.account_id,
        triggerType: 'conversation_assigned',
        contactId: args.contactId,
        context: {
          ...args.context,
          agent_id: agentId,
          conversation_id: args.context.conversation_id,
        },
      })
      return `assigned to ${agentId}`
    }

    case 'update_contact_field': {
      const cfg = step.step_config as UpdateContactFieldStepConfig
      if (!args.contactId) throw new Error('update_contact_field needs a contact')
      // Resolve workflow variables ({{ vars.* }}, {{ message.text }}) so custom
      // values can be populated dynamically from the triggering context.
      const value = interpolate(cfg.value, args)

      // Custom fields are encoded as `custom:<custom_field_id>`; anything else
      // is a built-in contact column.
      if (cfg.field.startsWith('custom:')) {
        const customFieldId = cfg.field.slice('custom:'.length)
        if (!customFieldId) {
          return `field ${cfg.field} not writable from automations`
        }
        // Defense in depth: the service-role client bypasses RLS, so confirm
        // the field definition belongs to this account before writing.
        const { data: field } = await db
          .from('custom_fields')
          .select('id')
          .eq('id', customFieldId)
          .eq('account_id', args.automation.account_id)
          .maybeSingle()
        if (!field) {
          return `field ${cfg.field} not writable from automations`
        }
        // Upsert on the table's UNIQUE(contact_id, custom_field_id) so repeated
        // runs overwrite rather than duplicate. Tenancy is enforced above and,
        // for the contact side, by the entry-point ownership guard.
        await db
          .from('contact_custom_values')
          .upsert(
            { contact_id: args.contactId, custom_field_id: customFieldId, value },
            { onConflict: 'contact_id,custom_field_id' },
          )
        return `custom field updated`
      }

      const allowed = new Set(['name', 'email', 'company'])
      if (!allowed.has(cfg.field)) {
        return `field ${cfg.field} not writable from automations`
      }
      // Defense in depth: scope the service-role write to the account so
      // a future caller that skips the entry-point ownership guard still
      // cannot write across tenants.
      await db
        .from('contacts')
        .update({ [cfg.field]: value, updated_at: new Date().toISOString() })
        .eq('id', args.contactId)
        .eq('account_id', args.automation.account_id)
      return `${cfg.field} updated`
    }

    case 'create_deal': {
      const cfg = step.step_config as CreateDealStepConfig
      if (!cfg.pipeline_id || !cfg.stage_id) throw new Error('create_deal needs pipeline + stage')
      // Match the account's configured default currency rather than
      // the static `deals.currency` DB default — keeps automation-
      // created deals consistent with the one-currency-per-account
      // rule (issue #218). Fall back to USD if the row is somehow
      // missing the value (pre-021 forks).
      const { data: acct } = await db
        .from('accounts')
        .select('default_currency')
        .eq('id', args.automation.account_id)
        .maybeSingle()
      const { data: dealRow } = await db.from('deals').insert({
        // Tenancy + audit, same split as automation_logs above.
        account_id: args.automation.account_id,
        user_id: args.automation.user_id,
        pipeline_id: cfg.pipeline_id,
        stage_id: cfg.stage_id,
        contact_id: args.contactId,
        title: interpolate(cfg.title, args),
        value: cfg.value ?? 0,
        currency: acct?.default_currency ?? 'USD',
        status: 'open',
      }).select('id').maybeSingle()
      if (dealRow?.id) {
        args.context.deal_id = dealRow.id as string
        args.context.pipeline_id = cfg.pipeline_id
        args.context.stage_id = cfg.stage_id
        await runAutomationsForTrigger({
          accountId: args.automation.account_id,
          triggerType: 'deal_created',
          contactId: args.contactId,
          context: {
            ...args.context,
            deal_id: dealRow.id as string,
            pipeline_id: cfg.pipeline_id,
            stage_id: cfg.stage_id,
          },
        })
      }
      return 'deal created'
    }

    case 'send_webhook': {
      const cfg = step.step_config as SendWebhookStepConfig
      if (!cfg.url) throw new Error('send_webhook needs url')
      // SSRF guard: the URL and headers are account-controlled and the
      // server makes the request, so refuse any destination that resolves
      // to a private / loopback / link-local / reserved address. Mirrors
      // the webhook_endpoints delivery path (see lib/webhooks/deliver.ts).
      if (!(await isDeliverableUrl(cfg.url))) {
        throw new Error('send_webhook: destination not allowed')
      }
      const body = cfg.body_template ? interpolate(cfg.body_template, args) : JSON.stringify(args.context)
      const res = await fetch(cfg.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(cfg.headers ?? {}) },
        body,
        // Do NOT follow redirects — a public URL could 3xx-bounce to an
        // internal address, defeating the guard above. Bound the request
        // so a hung/slow internal host can't tie up the runner.
        redirect: 'manual',
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) throw new Error(`webhook returned ${res.status}`)
      return `webhook ${res.status}`
    }

    case 'close_conversation': {
      if (!args.contactId) throw new Error('close_conversation needs a contact')
      await db
        .from('conversations')
        .update({ status: 'closed', updated_at: new Date().toISOString() })
        .eq('account_id', args.automation.account_id)
        .eq('contact_id', args.contactId)
      return 'conversation closed'
    }

    case 'set_conversation_status': {
      const cfg = step.step_config as SetConversationStatusStepConfig
      if (!args.contactId) throw new Error('set_conversation_status needs a contact')
      const status = cfg.status || 'open'
      if (!['open', 'closed', 'pending'].includes(status)) {
        throw new Error(`invalid conversation status: ${status}`)
      }
      await db
        .from('conversations')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('account_id', args.automation.account_id)
        .eq('contact_id', args.contactId)
      return `conversation status=${status}`
    }

    case 'send_media': {
      const cfg = step.step_config as SendMediaStepConfig
      if (!args.contactId) throw new Error('send_media needs a contact')
      const url = interpolate(cfg.url ?? '', args)
      if (!url.trim()) throw new Error('send_media needs a url')
      const conversationId = await resolveConversationId(args)
      const { whatsapp_message_id } = await engineSendMedia({
        accountId: args.automation.account_id,
        userId: args.automation.user_id,
        conversationId,
        contactId: args.contactId,
        kind: cfg.media_type,
        link: url,
        caption: cfg.caption ? interpolate(cfg.caption, args) : undefined,
        filename: cfg.filename,
      })
      return `media sent via Meta (${whatsapp_message_id})`
    }

    case 'capture': {
      const cfg = step.step_config as CaptureStepConfig
      if (!cfg.var_key) throw new Error('capture needs var_key')
      const source = cfg.source === 'last_reply'
        ? (args.context.interactive_reply_id ?? args.context.message_text ?? '')
        : (args.context.message_text ?? '')
      args.context.vars = { ...(args.context.vars ?? {}), [cfg.var_key]: source }
      if (args.context.entry?.id) {
        await appendCampaignEntryEvent({
          accountId: args.automation.account_id,
          entryId: args.context.entry.id,
          type: 'question_answered',
          label: `${cfg.var_key} captured`,
          detail: source,
        })
      }
      return `captured ${cfg.var_key}`
    }

    case 'validate': {
      const cfg = step.step_config as ValidateStepConfig
      if (!cfg.var_key) throw new Error('validate needs var_key')
      const raw = String(args.context.vars?.[cfg.var_key] ?? '')
      if (!passesValidation(cfg.rule, raw, cfg.pattern)) {
        throw new Error(`validate failed: ${cfg.var_key} (${cfg.rule})`)
      }
      if (args.context.entry?.id) {
        await appendCampaignEntryEvent({
          accountId: args.automation.account_id,
          entryId: args.context.entry.id,
          type: 'validation_completed',
          label: 'Validation completed',
          detail: cfg.var_key,
        })
      }
      return `validated ${cfg.var_key}`
    }

    case 'add_note': {
      const cfg = step.step_config as AddNoteStepConfig
      if (!args.contactId) throw new Error('add_note needs a contact')
      const text = interpolate(cfg.text ?? '', args)
      if (!text.trim()) throw new Error('add_note has empty text')
      await db.from('contact_notes').insert({
        account_id: args.automation.account_id,
        contact_id: args.contactId,
        user_id: args.automation.user_id,
        note_text: text,
      })
      return 'note added'
    }

    case 'notify_agent': {
      const cfg = step.step_config as NotifyAgentStepConfig
      const recipient = cfg.agent_id || args.context.agent_id
      if (!recipient) throw new Error('notify_agent needs an agent')
      await db.from('notifications').insert({
        account_id: args.automation.account_id,
        user_id: recipient,
        type: 'automation_notify',
        conversation_id: args.context.conversation_id ?? null,
        contact_id: args.contactId,
        actor_user_id: args.automation.user_id,
        title: interpolate(cfg.title ?? 'Automation', args),
        body: cfg.body ? interpolate(cfg.body, args) : null,
      })
      return `notified ${recipient}`
    }

    case 'campaign_add_entry': {
      const cfg = step.step_config as CampaignAddEntryStepConfig
      if (!args.contactId || !cfg.campaign_id) {
        throw new Error('campaign_add_entry needs contact + campaign_id')
      }
      const result = await addCampaignEntry({
        accountId: args.automation.account_id,
        campaignId: cfg.campaign_id,
        contactId: args.contactId,
        conversationId: args.context.conversation_id,
        automationId: args.automation.id,
        assignedAgentId: args.context.agent_id ?? args.context.conversation?.assignee ?? null,
        source: 'automation',
        messageText: args.context.message_text,
      })
      if ('error' in result) throw new Error(result.error)
      args.context.campaign_id = cfg.campaign_id
      args.context.entry = {
        id: result.entry.id,
        status: result.entry.status,
        reference: result.entry.entry_reference ?? null,
      }
      const campaign = await loadCampaign(args.automation.account_id, cfg.campaign_id)
      if (campaign) args.context.campaign = campaignSnapshot(campaign)
      if (result.duplicate) return `entry marked duplicate (${result.entry.id})`
      if (result.created) {
        await runAutomationsForTrigger({
          accountId: args.automation.account_id,
          triggerType: 'campaign_entry',
          contactId: args.contactId,
          context: {
            ...args.context,
            campaign_id: cfg.campaign_id,
          },
        })
        return `entry created (${result.entry.id})`
      }
      return `entry already existed (${result.entry.id})`
    }

    case 'campaign_set_status': {
      const cfg = step.step_config as CampaignSetStatusStepConfig
      const campaignId = cfg.campaign_id || args.context.campaign_id
      if (!args.contactId || !campaignId) {
        throw new Error('campaign_set_status needs contact + campaign')
      }
      const detail = await setCampaignEntryStatus({
        accountId: args.automation.account_id,
        campaignId,
        contactId: args.contactId,
        status: cfg.status,
        entryId: args.context.entry?.id,
      })
      if (args.context.entry) args.context.entry.status = cfg.status
      return detail
    }

    case 'campaign_generate_reference': {
      const cfg = step.step_config as CampaignGenerateReferenceStepConfig
      const campaignId = cfg.campaign_id || args.context.campaign_id
      if (!args.contactId || !campaignId) {
        throw new Error('campaign_generate_reference needs contact + campaign')
      }
      const reference = await generateEntryReference({
        accountId: args.automation.account_id,
        campaignId,
        contactId: args.contactId,
        entryId: args.context.entry?.id,
      })
      args.context.entry = { ...(args.context.entry ?? {}), reference }
      args.context.vars = { ...(args.context.vars ?? {}), entry_reference: reference }
      return `reference ${reference}`
    }

    case 'campaign_set_field': {
      const cfg = step.step_config as CampaignSetFieldStepConfig
      const campaignId = cfg.campaign_id || args.context.campaign_id
      if (!args.contactId || !campaignId || !cfg.field_key) {
        throw new Error('campaign_set_field needs contact + campaign + field_key')
      }
      return setCampaignFieldValue({
        accountId: args.automation.account_id,
        campaignId,
        contactId: args.contactId,
        fieldKey: cfg.field_key,
        value: interpolate(cfg.value ?? '', args),
        entryId: args.context.entry?.id,
      })
    }

    case 'update_deal': {
      const cfg = step.step_config as UpdateDealStepConfig
      const dealId = cfg.deal_id || args.context.deal_id
      if (!dealId) throw new Error('update_deal needs a deal')
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
      if (cfg.stage_id) patch.stage_id = cfg.stage_id
      if (cfg.title) patch.title = interpolate(cfg.title, args)
      if (typeof cfg.value === 'number') patch.value = cfg.value
      if (cfg.status) patch.status = cfg.status
      const { data: before } = await db
        .from('deals')
        .select('stage_id, contact_id')
        .eq('id', dealId)
        .eq('account_id', args.automation.account_id)
        .maybeSingle()
      await db
        .from('deals')
        .update(patch)
        .eq('id', dealId)
        .eq('account_id', args.automation.account_id)
      if (cfg.stage_id && before && before.stage_id !== cfg.stage_id) {
        args.context.stage_id = cfg.stage_id
        await runAutomationsForTrigger({
          accountId: args.automation.account_id,
          triggerType: 'deal_stage_changed',
          contactId: (before.contact_id as string | null) ?? args.contactId,
          context: {
            ...args.context,
            deal_id: dealId,
            stage_id: cfg.stage_id,
          },
        })
      }
      return 'deal updated'
    }

    case 'upsert_contact': {
      const cfg = step.step_config as UpsertContactStepConfig
      if (!args.contactId) throw new Error('upsert_contact needs a contact')
      const value = interpolate(cfg.value ?? '', args)
      const allowed = new Set(['name', 'email', 'company', 'phone'])
      if (!allowed.has(cfg.field)) {
        return `field ${cfg.field} not writable from automations`
      }
      await db
        .from('contacts')
        .update({ [cfg.field]: value, updated_at: new Date().toISOString() })
        .eq('id', args.contactId)
        .eq('account_id', args.automation.account_id)
      args.context.contact = { ...(args.context.contact ?? {}), [cfg.field]: value }
      return `${cfg.field} upserted`
    }

    default:
      return `unknown step: ${step.step_type}`
  }
}

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

/**
 * Pick the conversation a send-type step should use. Prefer the id the
 * webhook handed us (it's the one that just got the inbound message);
 * fall back to the contact's conversation for resumed/wait paths and
 * manual engine POSTs. Throws if none exists — send steps have
 * no meaningful target without a conversation.
 */
async function resolveConversationId(args: ExecuteArgs): Promise<string> {
  const fromCtx = args.context.conversation_id
  if (fromCtx) return fromCtx
  if (!args.contactId) throw new Error('cannot resolve conversation: no contact')
  const { data, error } = await supabaseAdmin()
    .from('conversations')
    .select('id')
    .eq('account_id', args.automation.account_id)
    .eq('contact_id', args.contactId)
    .maybeSingle()
  if (error) throw new Error(`conversation lookup failed: ${error.message}`)
  if (!data?.id) {
    const prefix = args.triggerEvent === 'tag_added'
      ? 'tag_added automation cannot send'
      : 'cannot send'
    throw new Error(`${prefix}: contact has no existing conversation`)
  }
  return data.id as string
}

export function triggerMatches(automation: Automation, ctx: AutomationContext | undefined): boolean {
  if (automation.trigger_type === 'keyword_match') {
    return keywordTextMatches(
      automation.trigger_config as KeywordMatchTriggerConfig,
      ctx?.message_text ?? '',
    )
  }

  // Match on the tapped button / list-row id (exact). Lets multi-step
  // menus be chained: automation A sends buttons, automation B fires on
  // the reply id and sends the next step.
  if (automation.trigger_type === 'interactive_reply') {
    const cfg = automation.trigger_config as InteractiveReplyTriggerConfig
    const replyId = ctx?.interactive_reply_id
    if (!replyId || !Array.isArray(cfg?.reply_ids) || cfg.reply_ids.length === 0) {
      return false
    }
    return cfg.reply_ids.includes(replyId)
  }

  if (automation.trigger_type === 'tag_added') {
    const cfg = automation.trigger_config as TagTriggerConfig
    const tagId = ctx?.tag_id
    return Boolean(tagId && cfg?.tag_id && cfg.tag_id === tagId)
  }

  if (automation.trigger_type === 'conversation_assigned') {
    const cfg = automation.trigger_config as { agent_id?: string }
    if (cfg?.agent_id) return ctx?.agent_id === cfg.agent_id
    return true
  }

  if (
    automation.trigger_type === 'deal_created' ||
    automation.trigger_type === 'deal_stage_changed'
  ) {
    const cfg = (automation.trigger_config ?? {}) as DealTriggerConfig
    if (cfg.pipeline_id && ctx?.pipeline_id && cfg.pipeline_id !== ctx.pipeline_id) {
      return false
    }
    if (cfg.stage_id && ctx?.stage_id && cfg.stage_id !== ctx.stage_id) {
      return false
    }
    return true
  }

  if (automation.trigger_type === 'campaign_entry') {
    const cfg = (automation.trigger_config ?? {}) as CampaignEntryTriggerConfig
    if (cfg.campaign_id) return ctx?.campaign_id === cfg.campaign_id
    return true
  }

  return true
}

async function evaluateCondition(cfg: ConditionStepConfig, args: ExecuteArgs): Promise<boolean> {
  const db = supabaseAdmin()
  switch (cfg.subject) {
    case 'tag_presence': {
      if (!args.contactId || !cfg.operand) return false
      // contact_tags has no account_id column (its RLS keys off the parent
      // contact), so tenant scoping here relies on the contact-ownership
      // guard in runAutomationsForTrigger.
      const { count } = await db
        .from('contact_tags')
        .select('id', { count: 'exact', head: true })
        .eq('contact_id', args.contactId)
        .eq('tag_id', cfg.operand)
      return (count ?? 0) > 0
    }
    case 'contact_field': {
      if (!args.contactId || !cfg.operand) return false
      // Scope to the account so the condition can't be turned into a
      // cross-tenant read oracle via the service-role client.
      const { data } = await db
        .from('contacts')
        .select(cfg.operand)
        .eq('id', args.contactId)
        .eq('account_id', args.automation.account_id)
        .maybeSingle()
      const v = (data as Record<string, unknown> | null)?.[cfg.operand]
      return v != null && String(v) === String(cfg.value ?? '')
    }
    case 'message_content': {
      const text = (args.context.message_text ?? '').toString()
      return text.toLowerCase().includes((cfg.value ?? '').toLowerCase())
    }
    case 'time_of_day': {
      // operand form "HH:mm-HH:mm" — true if now is within that window
      // (supports over-midnight ranges like "18:00-09:00").
      const [from, to] = (cfg.operand ?? '').split('-')
      if (!from || !to) return false
      const now = new Date()
      const mins = now.getHours() * 60 + now.getMinutes()
      const parse = (s: string) => {
        const [h, m] = s.split(':').map(Number)
        return (h || 0) * 60 + (m || 0)
      }
      const f = parse(from)
      const t = parse(to)
      return f <= t ? mins >= f && mins < t : mins >= f || mins < t
    }
    default:
      return false
  }
}

function waitMs(cfg: WaitStepConfig): number {
  const unitMs = cfg.unit === 'days' ? 86_400_000 : cfg.unit === 'hours' ? 3_600_000 : 60_000
  return Math.max(1_000, (cfg.amount || 0) * unitMs)
}

function waitRunAt(cfg: WaitStepConfig): Date {
  if (cfg.until) {
    const d = new Date(cfg.until)
    if (!Number.isNaN(d.getTime())) {
      return d.getTime() > Date.now() ? d : new Date(Date.now() + 1_000)
    }
  }
  return new Date(Date.now() + waitMs(cfg))
}

export function interpolateTemplate(s: string, ctx: AutomationContext): string {
  return s.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => {
    const parts = String(key).split('.')
    const ns = parts[0]
    const prop = parts[1]
    if (ns === 'message' && prop === 'text') return String(ctx.message_text ?? '')
    if (ns === 'vars' && prop) return String(ctx.vars?.[prop] ?? '')
    if (ns === 'contact' && prop) {
      const c = ctx.contact as Record<string, unknown> | undefined
      return String(c?.[prop] ?? '')
    }
    if (ns === 'campaign' && prop) {
      const c = ctx.campaign as Record<string, unknown> | undefined
      return String(c?.[prop] ?? '')
    }
    if (ns === 'entry') {
      if (prop === 'reference') return String(ctx.entry?.reference ?? '')
      if (prop) return String((ctx.entry as Record<string, unknown> | undefined)?.[prop] ?? '')
    }
    if (ns === 'conversation' && prop === 'assignee') {
      return String(ctx.conversation?.assignee ?? ctx.agent_id ?? '')
    }
    return ''
  })
}

function interpolate(s: string, args: ExecuteArgs): string {
  return interpolateTemplate(s, args.context)
}

function passesValidation(
  rule: ValidateStepConfig['rule'],
  value: string,
  pattern?: string,
): boolean {
  const v = value.trim()
  switch (rule) {
    case 'required':
      return v.length > 0
    case 'email':
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)
    case 'phone':
      return /^\+?[0-9]{7,15}$/.test(v.replace(/[\s()-]/g, ''))
    case 'number':
      return v.length > 0 && Number.isFinite(Number(v))
    case 'regex': {
      if (!pattern) return v.length > 0
      try {
        return new RegExp(pattern).test(v)
      } catch {
        return false
      }
    }
    default:
      return false
  }
}

async function parkPending(
  args: ExecuteArgs,
  step: AutomationStep,
  opts: {
    waitKind: 'delay' | 'inbound_reply'
    runAt: Date
    expectVarKey?: string
    detail?: string
  },
): Promise<void> {
  const db = supabaseAdmin()
  if (opts.waitKind === 'inbound_reply' && args.contactId) {
    await db
      .from('automation_pending_executions')
      .update({ status: 'failed' })
      .eq('account_id', args.automation.account_id)
      .eq('contact_id', args.contactId)
      .eq('wait_kind', 'inbound_reply')
      .in('status', ['pending', 'running'])
  }
  await db.from('automation_pending_executions').insert({
    automation_id: args.automation.id,
    account_id: args.automation.account_id,
    user_id: args.automation.user_id,
    contact_id: args.contactId,
    log_id: args.logId,
    parent_step_id: args.parentStepId,
    branch: args.branch,
    next_step_position: step.position + 1,
    context: args.context,
    run_at: opts.runAt.toISOString(),
    status: 'pending',
    wait_kind: opts.waitKind,
    expect_var_key: opts.expectVarKey ?? null,
  })
}

async function hydrateContext(
  accountId: string,
  contactId: string | null,
  incoming: AutomationContext,
): Promise<AutomationContext> {
  const ctx: AutomationContext = {
    ...incoming,
    vars: { ...(incoming.vars ?? {}) },
  }
  const db = supabaseAdmin()
  if (contactId && !ctx.contact) {
    const { data } = await db
      .from('contacts')
      .select('id, name, phone, email, company')
      .eq('id', contactId)
      .eq('account_id', accountId)
      .maybeSingle()
    if (data) ctx.contact = data
  }
  const campaignId = ctx.campaign_id
  if (campaignId && !ctx.campaign) {
    const campaign = await loadCampaign(accountId, campaignId)
    if (campaign) ctx.campaign = campaignSnapshot(campaign)
  }
  if (campaignId && contactId && !ctx.entry) {
    const entry = await loadEntryForContact(accountId, campaignId, contactId)
    if (entry) ctx.entry = {
      id: entry.id,
      status: entry.status,
      reference: entry.entry_reference ?? null,
    }
  }
  if (ctx.conversation_id && ctx.conversation?.assignee === undefined) {
    const { data } = await db
      .from('conversations')
      .select('assigned_agent_id')
      .eq('id', ctx.conversation_id)
      .eq('account_id', accountId)
      .maybeSingle()
    ctx.conversation = {
      ...(ctx.conversation ?? {}),
      assignee: (data?.assigned_agent_id as string | null) ?? null,
    }
  }
  return ctx
}

async function findStepByNodeId(
  automationId: string,
  nodeId: string,
): Promise<AutomationStep | null> {
  if (!nodeId) return null
  const { data } = await supabaseAdmin()
    .from('automation_steps')
    .select('*')
    .eq('automation_id', automationId)
  const rows = (data ?? []) as AutomationStep[]
  return (
    rows.find((s) => {
      const cfg = s.step_config as Record<string, unknown>
      return cfg?.node_id === nodeId
    }) ?? null
  )
}

async function appendResults(
  logId: string | null,
  newItems: AutomationLogStepResult[],
  status: 'success' | 'partial' | 'failed' | null,
  errorMessage: string | null,
) {
  if (!logId) return
  const db = supabaseAdmin()
  const { data: existing } = await db
    .from('automation_logs')
    .select('steps_executed, status')
    .eq('id', logId)
    .single()
  const merged = [
    ...((existing?.steps_executed as AutomationLogStepResult[] | undefined) ?? []),
    ...newItems,
  ]
  const update: Record<string, unknown> = { steps_executed: merged }
  // Only overwrite status on the outermost scope — nested branches pass null.
  if (status !== null) {
    update.status = status
  }
  if (errorMessage) update.error_message = errorMessage
  await db.from('automation_logs').update(update).eq('id', logId)
}

async function finalizeLog(
  logId: string | null,
  status: 'success' | 'partial' | 'failed',
  errorMessage: string | null,
) {
  if (!logId) return
  await supabaseAdmin()
    .from('automation_logs')
    .update({ status, error_message: errorMessage })
    .eq('id', logId)
}

async function markPending(id: string, status: 'done' | 'failed') {
  await supabaseAdmin()
    .from('automation_pending_executions')
    .update({ status })
    .eq('id', id)
}
