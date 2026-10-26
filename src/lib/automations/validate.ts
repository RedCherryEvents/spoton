import type { AutomationTriggerType } from '@/types'
import { validateInteractivePayload } from '@/lib/whatsapp/interactive'
import { videoPageSite } from '@/lib/whatsapp/media-url'
import type { StepPath } from './builder-tree'

// ------------------------------------------------------------
// Pre-flight config validation for automations about to be activated.
//
// Activating a broken automation (e.g. an add_tag step with tag_id="")
// used to succeed silently — every trigger then produced a failed log
// row with a cryptic "add_tag needs contact + tag_id" message, and
// users often didn't notice until reviewing logs. This module lets
// the API refuse activation with a useful 400 response instead.
//
// The rules here mirror the runtime checks in engine.ts's runStep;
// they're the same invariants, enforced one step earlier so failures
// surface at save time.
// ------------------------------------------------------------

export interface ValidationIssue {
  /** Dot-path for the UI to highlight; stable enough to build a table. */
  path: string
  message: string
  /** Type of the step `path` points at, so the UI can name it. */
  step_type?: string
}

interface StepLike {
  step_type: string
  step_config: Record<string, unknown>
  branches?: { yes?: StepLike[]; no?: StepLike[] }
}

export function validateStepsForActivation(steps: StepLike[]): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  if (!Array.isArray(steps) || steps.length === 0) {
    issues.push({
      path: 'steps',
      message: 'active automations need at least one step',
    })
    return issues
  }
  walk(steps, '', issues)
  return issues
}

function walk(steps: StepLike[], prefix: string, issues: ValidationIssue[]): void {
  forEachStep(steps, prefix, (s, path) => validateOne(s, path, issues))
}

function forEachStep(
  steps: StepLike[],
  prefix: string,
  visit: (step: StepLike, path: string) => void,
): void {
  if (!Array.isArray(steps)) return
  steps.forEach((s, i) => {
    const path = `${prefix}steps[${i}]`
    visit(s, path)
    if (s.branches) {
      if (s.branches.yes) forEachStep(s.branches.yes, `${path}.yes.`, visit)
      if (s.branches.no) forEachStep(s.branches.no, `${path}.no.`, visit)
    }
  })
}

export interface StepReferences {
  /** The account's flows that a `start_flow` step may point at. */
  flows: { id: string; name: string; status: string }[]
  /**
   * The account's campaigns that `campaign_add_entry` steps point at.
   * Optional: campaign references are only checked when provided.
   */
  campaigns?: { id: string; name: string; status: string }[]
}

/** Condition subjects the engine can evaluate (engine.ts evaluateCondition). */
export const SUPPORTED_CONDITION_SUBJECTS = [
  'contact_field',
  'tag_presence',
  'message_content',
  'time_of_day',
] as const

/** Campaign ids referenced by `campaign_add_entry` steps, anywhere in the tree. */
export function referencedCampaignIds(steps: StepLike[]): string[] {
  const ids = new Set<string>()
  forEachStep(steps, '', (s) => {
    const id = s.step_config?.campaign_id
    if (s.step_type === 'campaign_add_entry' && nonEmpty(id)) ids.add(String(id).trim())
  })
  return [...ids]
}

/** Flow ids referenced by `start_flow` steps, anywhere in the tree. */
export function referencedFlowIds(steps: StepLike[]): string[] {
  const ids = new Set<string>()
  forEachStep(steps, '', (s) => {
    const id = s.step_config?.flow_id
    if (s.step_type === 'start_flow' && nonEmpty(id)) ids.add(String(id).trim())
  })
  return [...ids]
}

/**
 * Activation checks that need other records: a `start_flow` step must
 * point at a flow that exists in the account and is active, otherwise
 * every run would fail at that step. Empty ids are left to
 * validateStepsForActivation, which already reports them.
 */
export function validateStepReferences(
  steps: StepLike[],
  refs: StepReferences,
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const flows = new Map(refs.flows.map((f) => [f.id, f]))
  const campaigns = refs.campaigns ? new Map(refs.campaigns.map((c) => [c.id, c])) : null
  forEachStep(steps, '', (s, path) => {
    // The engine refuses entries into a campaign that isn't active, so
    // every run would fail at this step.
    const campaignId = s.step_config?.campaign_id
    if (campaigns && s.step_type === 'campaign_add_entry' && nonEmpty(campaignId)) {
      const campaign = campaigns.get(String(campaignId).trim())
      if (!campaign) {
        issues.push({
          path: `${path}.campaign_id`,
          message: 'the selected campaign no longer exists, pick another campaign',
        })
      } else if (campaign.status !== 'active') {
        issues.push({
          path: `${path}.campaign_id`,
          message: `campaign "${campaign.name}" is ${campaign.status}, activate the campaign first or pick another campaign`,
        })
      }
    }
    const id = s.step_config?.flow_id
    if (s.step_type !== 'start_flow' || !nonEmpty(id)) return
    const flow = flows.get(String(id).trim())
    if (!flow) {
      issues.push({
        path: `${path}.flow_id`,
        message: 'the selected flow no longer exists, pick another flow',
      })
    } else if (flow.status !== 'active') {
      issues.push({
        path: `${path}.flow_id`,
        message: `flow "${flow.name}" is not active, activate it or pick another flow`,
      })
    }
  })
  return issues
}

/**
 * Turns an issue path like `steps[2].yes.steps[0].text` back into the
 * builder's StepPath plus the offending field. Null for paths that
 * don't address a step (`steps`, `trigger.*`).
 */
export function issueStepPath(path: string): { path: StepPath; field?: string } | null {
  const head = /^steps\[(\d+)\]/.exec(path)
  if (!head) return null
  const markers: StepPath = [{ kind: 'root', index: Number(head[1]) }]
  let rest = path.slice(head[0].length)
  for (;;) {
    const branch = /^\.(yes|no)\.steps\[(\d+)\]/.exec(rest)
    if (!branch) break
    markers.push({ kind: 'branch', branch: branch[1] as 'yes' | 'no', index: Number(branch[2]) })
    rest = rest.slice(branch[0].length)
  }
  const field = /^\.(\w+)$/.exec(rest)?.[1]
  return field ? { path: markers, field } : { path: markers }
}

function validateOne(step: StepLike, path: string, issues: ValidationIssue[]): void {
  const c = step.step_config ?? {}
  switch (step.step_type) {
    case 'send_message':
      if (!nonEmpty(c.text)) {
        issues.push({ path: `${path}.text`, message: 'message text is required' })
      }
      break
    case 'send_buttons':
    case 'send_list': {
      // The whole step_config IS the interactive payload; validate it
      // against Meta's limits (same check the engine runs before send).
      const result = validateInteractivePayload(c)
      if (!result.ok) {
        issues.push({ path: `${path}.interactive`, message: result.error })
      }
      if (c.wait_for_reply === true && !nonEmpty(c.var_key)) {
        issues.push({ path: `${path}.var_key`, message: 'variable key is required when waiting for a reply' })
      }
      break
    }
    case 'send_template':
      if (!nonEmpty(c.template_name)) {
        issues.push({ path: `${path}.template_name`, message: 'template name is required' })
      }
      break
    case 'add_tag':
    case 'remove_tag':
      if (!nonEmpty(c.tag_id)) {
        issues.push({ path: `${path}.tag_id`, message: 'tag is required' })
      }
      break
    case 'assign_conversation':
      if (c.mode === 'specific' && !nonEmpty(c.agent_id)) {
        issues.push({
          path: `${path}.agent_id`,
          message: 'agent is required when mode is "specific"',
        })
      }
      break
    case 'update_contact_field':
      if (!nonEmpty(c.field)) {
        issues.push({ path: `${path}.field`, message: 'field name is required' })
      }
      if (c.value === undefined || c.value === null || c.value === '') {
        issues.push({ path: `${path}.value`, message: 'field value is required' })
      }
      break
    case 'create_deal':
      if (!nonEmpty(c.pipeline_id)) {
        issues.push({ path: `${path}.pipeline_id`, message: 'pipeline is required' })
      }
      if (!nonEmpty(c.stage_id)) {
        issues.push({ path: `${path}.stage_id`, message: 'stage is required' })
      }
      if (!nonEmpty(c.title)) {
        issues.push({ path: `${path}.title`, message: 'title is required' })
      }
      break
    case 'wait':
      if (nonEmpty(c.until)) break
      if (typeof c.amount !== 'number' || !Number.isFinite(c.amount) || c.amount <= 0) {
        issues.push({ path: `${path}.amount`, message: 'wait amount must be greater than 0' })
      }
      if (!['minutes', 'hours', 'days'].includes(String(c.unit))) {
        issues.push({
          path: `${path}.unit`,
          message: 'wait unit must be minutes, hours, or days',
        })
      }
      break
    case 'condition':
      if (!nonEmpty(c.subject)) {
        issues.push({ path: `${path}.subject`, message: 'condition subject is required' })
      } else if (!(SUPPORTED_CONDITION_SUBJECTS as readonly string[]).includes(String(c.subject))) {
        // The engine has no evaluator for it and would silently take
        // the No branch on every run.
        issues.push({
          path: `${path}.subject`,
          message: `condition "${String(c.subject)}" is not supported, use one of: contact field, tag presence, message content, time of day`,
        })
      }
      if (!nonEmpty(c.operand)) {
        issues.push({ path: `${path}.operand`, message: 'condition operand is required' })
      }
      break
    case 'send_webhook':
      if (!nonEmpty(c.url)) {
        issues.push({ path: `${path}.url`, message: 'webhook URL is required' })
        break
      }
      try {
        const u = new URL(String(c.url))
        if (u.protocol !== 'http:' && u.protocol !== 'https:') {
          issues.push({
            path: `${path}.url`,
            message: 'webhook URL must use http or https',
          })
        }
      } catch {
        issues.push({ path: `${path}.url`, message: 'webhook URL is not a valid URL' })
      }
      break
    case 'close_conversation':
    case 'end':
      break
    case 'send_media': {
      if (!nonEmpty(c.url)) {
        issues.push({ path: `${path}.url`, message: 'media URL is required' })
      }
      const site = nonEmpty(c.url) ? videoPageSite(String(c.url)) : null
      if (site) {
        issues.push({
          path: `${path}.url`,
          message: `${site} links can't be sent as media, send the link in a Send Message step instead`,
        })
      }
      if (!['image', 'video', 'document', 'audio'].includes(String(c.media_type))) {
        issues.push({ path: `${path}.media_type`, message: 'media type is required' })
      }
      break
    }
    case 'ask_question':
      if (!nonEmpty(c.text)) {
        issues.push({ path: `${path}.text`, message: 'question text is required' })
      }
      if (!nonEmpty(c.var_key)) {
        issues.push({ path: `${path}.var_key`, message: 'variable key is required' })
      }
      break
    case 'capture':
      if (!nonEmpty(c.var_key)) {
        issues.push({ path: `${path}.var_key`, message: 'variable key is required' })
      }
      break
    case 'validate':
      if (!nonEmpty(c.var_key)) {
        issues.push({ path: `${path}.var_key`, message: 'variable key is required' })
      }
      if (!['required', 'email', 'phone', 'number', 'regex'].includes(String(c.rule))) {
        issues.push({ path: `${path}.rule`, message: 'validation rule is required' })
      }
      // No pattern is allowed (the engine treats it as `required`), but
      // a pattern that doesn't compile would fail every answer at runtime.
      if (c.rule === 'regex' && nonEmpty(c.pattern)) {
        try {
          new RegExp(String(c.pattern))
        } catch {
          issues.push({ path: `${path}.pattern`, message: 'pattern is not a valid regular expression' })
        }
      }
      if (
        c.on_invalid === 'retry' &&
        c.max_attempts !== undefined &&
        !(Number.isInteger(c.max_attempts) && Number(c.max_attempts) >= 2 && Number(c.max_attempts) <= 10)
      ) {
        issues.push({ path: `${path}.max_attempts`, message: 'max attempts must be a whole number from 2 to 10' })
      }
      break
    case 'add_note':
      if (!nonEmpty(c.text)) {
        issues.push({ path: `${path}.text`, message: 'note text is required' })
      }
      break
    case 'set_conversation_status':
      if (!['open', 'closed', 'pending'].includes(String(c.status))) {
        issues.push({ path: `${path}.status`, message: 'conversation status is required' })
      }
      break
    case 'notify_agent':
      if (!nonEmpty(c.title)) {
        issues.push({ path: `${path}.title`, message: 'notification title is required' })
      }
      break
    case 'campaign_add_entry':
      if (!nonEmpty(c.campaign_id)) {
        issues.push({ path: `${path}.campaign_id`, message: 'campaign is required' })
      }
      break
    case 'campaign_set_status':
      if (!['in_progress', 'completed', 'invalid', 'duplicate', 'disqualified', 'active', 'withdrawn'].includes(String(c.status))) {
        issues.push({ path: `${path}.status`, message: 'entry status is required' })
      }
      break
    case 'campaign_generate_reference':
      break
    case 'campaign_set_field':
      if (!nonEmpty(c.field_key)) {
        issues.push({ path: `${path}.field_key`, message: 'field key is required' })
      }
      if (c.value === undefined || c.value === null || c.value === '') {
        issues.push({ path: `${path}.value`, message: 'field value is required' })
      }
      break
    case 'start_flow':
      if (!nonEmpty(c.flow_id)) {
        issues.push({ path: `${path}.flow_id`, message: 'flow is required' })
      }
      break
    case 'random_split': {
      const p = Number(c.percent)
      if (!Number.isFinite(p) || p < 0 || p > 100) {
        issues.push({ path: `${path}.percent`, message: 'split percent must be 0–100' })
      }
      break
    }
    case 'go_to':
      if (!nonEmpty(c.target_node_id)) {
        issues.push({ path: `${path}.target_node_id`, message: 'go-to target is required' })
      }
      break
    case 'update_deal':
      if (!c.stage_id && !c.title && c.value === undefined && !c.status) {
        issues.push({ path, message: 'update_deal needs at least one field' })
      }
      break
    case 'upsert_contact':
      if (!nonEmpty(c.field)) {
        issues.push({ path: `${path}.field`, message: 'field name is required' })
      }
      if (c.value === undefined || c.value === null || c.value === '') {
        issues.push({ path: `${path}.value`, message: 'field value is required' })
      }
      break
    default:
      issues.push({ path, message: `unknown step type: ${step.step_type}` })
  }
}

/** Adds `step_type` to every issue whose path resolves to a step. */
export function annotateIssues(issues: ValidationIssue[], steps: StepLike[]): ValidationIssue[] {
  return issues.map((issue) => {
    const loc = issueStepPath(issue.path)
    if (!loc || !Array.isArray(steps)) return issue
    let bucket: StepLike[] | undefined = steps
    let step: StepLike | undefined
    for (const marker of loc.path) {
      if (marker.kind === 'branch') bucket = step?.branches?.[marker.branch]
      step = bucket?.[marker.index]
      if (!step) return issue
    }
    return step ? { ...issue, step_type: step.step_type } : issue
  })
}

export function validateTriggerForActivation(
  triggerType: AutomationTriggerType | string,
  triggerConfig: unknown,
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const cfg = (triggerConfig ?? {}) as Record<string, unknown>

  if (triggerType === 'keyword_match') {
    const k = cfg.keywords
    if (!Array.isArray(k) || k.length === 0) {
      issues.push({ path: 'trigger.keywords', message: 'at least one keyword is required' })
    } else if (k.some((v) => typeof v !== 'string' || v.trim() === '')) {
      issues.push({ path: 'trigger.keywords', message: 'keywords cannot be empty strings' })
    }
    // A missing match_type defaults to "contains" at runtime (see
    // automations/engine.ts and flows/engine.ts, which both read
    // `match_type ?? "contains"`), so only an explicit, unrecognised
    // value is invalid here. This keeps activation validation in step
    // with the engine and with the builder's "Contains" default — an
    // automation that shows the default in the UI must not be rejected.
    if (
      cfg.match_type != null &&
      cfg.match_type !== 'exact' &&
      cfg.match_type !== 'contains' &&
      cfg.match_type !== 'word' &&
      cfg.match_type !== 'starts_with' &&
      cfg.match_type !== 'ends_with'
    ) {
      issues.push({
        path: 'trigger.match_type',
        message: 'match type must be "exact", "contains", "word", "starts_with" or "ends_with"',
      })
    }
  } else if (triggerType === 'time_based') {
    if (!nonEmpty(cfg.schedule)) {
      issues.push({ path: 'trigger.schedule', message: 'schedule is required' })
    }
  } else if (triggerType === 'tag_added') {
    if (!nonEmpty(cfg.tag_id)) {
      issues.push({ path: 'trigger.tag_id', message: 'tag is required' })
    }
  } else if (triggerType === 'interactive_reply') {
    const ids = cfg.reply_ids
    if (!Array.isArray(ids) || ids.length === 0) {
      issues.push({
        path: 'trigger.reply_ids',
        message: 'at least one reply id is required',
      })
    } else if (ids.some((v) => typeof v !== 'string' || v.trim() === '')) {
      issues.push({
        path: 'trigger.reply_ids',
        message: 'reply ids cannot be empty strings',
      })
    }
  } else if (triggerType === 'campaign_entry') {
    // Optional campaign_id filter — empty means any campaign.
  }

  return issues
}

function nonEmpty(v: unknown): boolean {
  return typeof v === 'string' && v.trim().length > 0
}
