import type { AutomationTriggerType, KeywordMatchTriggerConfig } from '@/types'
import { normalizeEntryStatus } from '@/lib/campaigns/status'
import { videoPageSite } from '@/lib/whatsapp/media-url'
import { blockedAutomationKeywords } from '../keyword-conflicts'
import { keywordTextMatches } from '../keyword-match'
import {
  annotateIssues,
  validateStepReferences,
  validateStepsForActivation,
  validateTriggerForActivation,
} from '../validate'
import {
  GENERATOR_STEPS,
  GENERATOR_TRIGGERS,
  type DraftSpec,
  type DraftStep,
  type GenerateResult,
  type GeneratedStep,
  type GeneratorCatalog,
  type GeneratorNote,
} from './types'

const MATCH_TYPES = ['exact', 'contains', 'word', 'starts_with', 'ends_with'] as const
const MEDIA_TYPES = ['image', 'video', 'document', 'audio'] as const
const WAIT_UNITS = ['minutes', 'hours', 'days'] as const
const CONDITION_SUBJECTS = ['message_content', 'contact_field', 'tag_presence', 'time_of_day'] as const
const CONTACT_FIELDS = ['name', 'email', 'company', 'phone'] as const
const CONVERSATION_STATUSES = ['open', 'pending', 'closed'] as const
const MAX_BRANCH_DEPTH = 3
const WHATSAPP_WINDOW_HOURS = 24
/** Triggers that always follow a customer message, so the 24-hour window is open. */
const INBOUND_TRIGGERS = new Set(['keyword_match', 'new_message_received', 'first_inbound_message'])
const FREE_FORM_SENDS = new Set(['send_message', 'send_media', 'ask_question'])

const MEDIA_EXTENSIONS: Record<string, (typeof MEDIA_TYPES)[number]> = {
  jpg: 'image', jpeg: 'image', png: 'image', webp: 'image',
  mp4: 'video', '3gp': 'video',
  pdf: 'document', doc: 'document', docx: 'document', xls: 'document', xlsx: 'document',
  ppt: 'document', pptx: 'document', txt: 'document', csv: 'document',
  mp3: 'audio', ogg: 'audio', aac: 'audio', amr: 'audio', m4a: 'audio', opus: 'audio',
}

/** Short refs (C1, F1, T1) the AI prompt uses instead of real ids. */
export function catalogRefs(catalog: GeneratorCatalog) {
  return {
    campaigns: catalog.campaigns.map((c, i) => ({ ref: `C${i + 1}`, record: c })),
    flows: catalog.flows.map((f, i) => ({ ref: `F${i + 1}`, record: f })),
    tags: catalog.tags.map((t, i) => ({ ref: `T${i + 1}`, record: t })),
  }
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : ''
}

function lower(v: unknown): string {
  return str(v).toLowerCase()
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[]): T | null {
  const s = lower(v)
  return (allowed as readonly string[]).includes(s) ? (s as T) : null
}

function slug(v: unknown, fallback: string): string {
  const s = lower(v).replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '')
  return s || fallback
}

/**
 * Resolve a ref (`C1`), real id, or name to one catalog record. Names
 * must match exactly one record (case-insensitive), so an ambiguous name
 * never picks a record by guesswork.
 */
function resolveRecord<R extends { id: string }>(
  value: unknown,
  entries: { ref: string; record: R }[],
  names: (r: R) => (string | null)[],
): R | null {
  const v = str(value)
  if (!v) return null
  const byRef = entries.find((e) => e.ref.toLowerCase() === v.toLowerCase())
  if (byRef) return byRef.record
  const byId = entries.find((e) => e.record.id === v)
  if (byId) return byId.record
  const hits = entries.filter((e) =>
    names(e.record).some((n) => !!n && n.trim().toLowerCase() === v.toLowerCase()),
  )
  return hits.length === 1 ? hits[0].record : null
}

export function mediaTypeForUrl(url: string): (typeof MEDIA_TYPES)[number] | null {
  try {
    const path = new URL(url).pathname.toLowerCase()
    const ext = path.split('.').pop() ?? ''
    return MEDIA_EXTENSIONS[ext] ?? null
  } catch {
    return null
  }
}

function newNodeId(): string {
  return `c_${globalThis.crypto.randomUUID()}`
}

interface Ctx {
  catalog: GeneratorCatalog
  refs: ReturnType<typeof catalogRefs>
  campaignId: string | null
  notes: GeneratorNote[]
  addedEntryCampaigns: Set<string>
}

function resolveCampaign(ctx: Ctx, value: unknown) {
  return resolveRecord(value, ctx.refs.campaigns, (c) => [c.name, c.code, c.keyword])
}

function campaignName(ctx: Ctx, id: string | null | undefined): string {
  return ctx.catalog.campaigns.find((c) => c.id === id)?.name ?? 'the campaign'
}

/** Optional campaign on entry steps: blank means "the entry from Add Campaign Entry". */
function optionalCampaign(ctx: Ctx, raw: unknown, line?: number): Record<string, unknown> {
  if (!str(raw)) return {}
  const c = resolveCampaign(ctx, raw)
  if (c) return { campaign_id: c.id }
  ctx.notes.push({ level: 'warning', line, message: `Campaign "${str(raw)}" wasn't found, so this step uses the campaign entry created earlier in the automation.` })
  return {}
}

function normalizeStep(ctx: Ctx, step: DraftStep, depth: number): GeneratedStep[] {
  const c = step.config ?? {}
  const line = step.line
  const type = lower(step.type)
  const warn = (message: string) => ctx.notes.push({ level: 'warning', line, message })
  const info = (message: string) => ctx.notes.push({ level: 'info', line, message })
  const out = (step_type: string, config: Record<string, unknown>, branches?: GeneratedStep['branches']): GeneratedStep[] => [
    { step_type, step_config: { ...config, node_id: newNodeId() }, ...(branches ? { branches } : {}) },
  ]

  if (!(GENERATOR_STEPS as readonly string[]).includes(type)) {
    warn(`"${step.type}" isn't a supported step, so it was left out.`)
    return []
  }

  switch (type) {
    case 'send_message':
      return out('send_message', { text: str(c.text) })

    case 'send_media': {
      const url = str(c.url)
      const caption = str(c.caption)
      const site = url ? videoPageSite(url) : null
      if (site) {
        info(`${site} links can't be sent as WhatsApp media, so the link is sent in a message instead.`)
        return out('send_message', { text: [caption, url].filter(Boolean).join('\n') })
      }
      const media_type = oneOf(c.media_type, MEDIA_TYPES) ?? (url ? mediaTypeForUrl(url) : null)
      if (url && !media_type) {
        warn('The media type couldn\'t be worked out from the link. Pick image, video, document or audio, and make sure the link points straight at the file.')
      }
      return out('send_media', {
        media_type: media_type ?? '',
        url,
        ...(caption ? { caption } : {}),
        ...(str(c.filename) ? { filename: str(c.filename) } : {}),
      })
    }

    case 'send_template': {
      const wanted = lower(c.template_name ?? c.name)
      const tpl = ctx.catalog.templates.find((t) => t.name.toLowerCase() === wanted)
      if (!tpl) {
        warn(wanted
          ? `Template "${str(c.template_name ?? c.name)}" isn't an approved template in this account. Pick an approved one.`
          : 'Pick an approved template for this step.')
      }
      const vars = c.variables && typeof c.variables === 'object' && !Array.isArray(c.variables)
        ? Object.fromEntries(
            Object.entries(c.variables as Record<string, unknown>)
              .filter(([k]) => /^\d+$/.test(k))
              .map(([k, v]) => [k, str(v)]),
          )
        : undefined
      return out('send_template', {
        template_name: tpl?.name ?? '',
        ...(tpl ? { language: tpl.language } : {}),
        ...(vars && Object.keys(vars).length > 0 ? { variables: vars } : {}),
      })
    }

    case 'ask_question': {
      const hours = Number(c.timeout_hours)
      return out('ask_question', {
        text: str(c.text),
        var_key: slug(c.var_key, 'answer'),
        ...(Number.isFinite(hours) && hours > 0 ? { timeout_hours: Math.round(hours) } : {}),
      })
    }

    case 'wait': {
      const amount = Math.round(Number(c.amount))
      return out('wait', {
        amount: Number.isFinite(amount) && amount > 0 ? amount : 1,
        unit: oneOf(c.unit, WAIT_UNITS) ?? 'hours',
      })
    }

    case 'condition': {
      if (depth >= MAX_BRANCH_DEPTH) {
        warn(`Conditions can be nested at most ${MAX_BRANCH_DEPTH} deep; this one was left out.`)
        return []
      }
      let subject = oneOf(c.subject, CONDITION_SUBJECTS)
      if (!subject) {
        warn('The condition type wasn\'t clear, so it was set to "message contains". Check it.')
        subject = 'message_content'
      }
      const config: Record<string, unknown> = { subject }
      if (subject === 'message_content') {
        // The engine reads `value`; validation requires `operand`. Keep both.
        const needle = str(c.value) || str(c.operand)
        config.operand = needle
        config.value = needle
      } else if (subject === 'contact_field') {
        const field = oneOf(c.operand ?? c.field, CONTACT_FIELDS)
        if (!field) warn('Pick which contact field the condition checks (name, email, company or phone).')
        config.operand = field ?? ''
        config.value = str(c.value)
      } else if (subject === 'tag_presence') {
        const tag = resolveRecord(c.operand ?? c.tag_id ?? c.tag, ctx.refs.tags, (t) => [t.name])
        if (!tag) warn(`Tag "${str(c.operand ?? c.tag_id ?? c.tag)}" doesn't exist. Create it under Contacts, then pick it here.`)
        config.operand = tag?.id ?? ''
      } else {
        const range = str(c.operand).replace(/\s+/g, '')
        const ok = /^\d{1,2}:\d{2}-\d{1,2}:\d{2}$/.test(range)
        if (!ok) warn('Time conditions need a range like 08:00-17:00.')
        config.operand = ok ? range : ''
      }
      const yes = normalizeSteps(ctx, step.yes ?? [], depth + 1)
      const no = normalizeSteps(ctx, step.no ?? [], depth + 1)
      return out('condition', config, { yes, no })
    }

    case 'campaign_add_entry': {
      const named = str(c.campaign_id)
      const resolved = named ? resolveCampaign(ctx, named) : null
      if (named && !resolved) warn(`Campaign "${named}" wasn't found.`)
      const id = resolved?.id ?? ctx.campaignId
      if (!id) {
        warn('Pick the campaign this entry belongs to.')
        return out('campaign_add_entry', { campaign_id: '' })
      }
      if (ctx.campaignId && id !== ctx.campaignId) {
        warn(`This step adds entries to ${campaignName(ctx, id)}, but you selected ${campaignName(ctx, ctx.campaignId)}.`)
      }
      if (ctx.addedEntryCampaigns.has(id)) {
        info(`A second "Add campaign entry" for ${campaignName(ctx, id)} was removed; one per automation is enough.`)
        return []
      }
      ctx.addedEntryCampaigns.add(id)
      return out('campaign_add_entry', { campaign_id: id })
    }

    case 'campaign_set_status': {
      const status = normalizeEntryStatus(lower(c.status).replace(/\s+/g, '_'))
      if (!status) warn(`"${str(c.status)}" isn't an entry status. Use in progress, completed, invalid, duplicate, disqualified or withdrawn.`)
      return out('campaign_set_status', { status: status ?? '', ...optionalCampaign(ctx, c.campaign_id, line) })
    }

    case 'campaign_generate_reference':
      return out('campaign_generate_reference', optionalCampaign(ctx, c.campaign_id, line))

    case 'campaign_set_field':
      return out('campaign_set_field', {
        field_key: slug(c.field_key, ''),
        value: str(c.value),
        ...optionalCampaign(ctx, c.campaign_id, line),
      })

    case 'start_flow': {
      const flow = resolveRecord(c.flow_id ?? c.flow, ctx.refs.flows, (f) => [f.name])
      if (!flow) {
        const available = ctx.catalog.flows.filter((f) => f.status === 'active').map((f) => `"${f.name}"`)
        warn(`Flow "${str(c.flow_id ?? c.flow)}" wasn't found.${available.length ? ` Active flows: ${available.join(', ')}.` : ' There are no active flows.'}`)
      }
      return out('start_flow', { flow_id: flow?.id ?? '' })
    }

    case 'add_tag':
    case 'remove_tag': {
      const tag = resolveRecord(c.tag_id ?? c.tag, ctx.refs.tags, (t) => [t.name])
      if (!tag) warn(`Tag "${str(c.tag_id ?? c.tag)}" doesn't exist. Create it under Contacts, then pick it here.`)
      return out(type, { tag_id: tag?.id ?? '' })
    }

    case 'add_note':
      return out('add_note', { text: str(c.text) })

    case 'set_conversation_status':
      return out('set_conversation_status', { status: oneOf(c.status, CONVERSATION_STATUSES) ?? '' })

    case 'close_conversation':
      return out('close_conversation', {})

    case 'end':
      return out('end', str(c.reason) ? { reason: str(c.reason) } : {})
  }
  return []
}

function normalizeSteps(ctx: Ctx, steps: DraftStep[], depth: number): GeneratedStep[] {
  return (Array.isArray(steps) ? steps : []).flatMap((s) => normalizeStep(ctx, s, depth))
}

function normalizeTrigger(ctx: Ctx, spec: DraftSpec): { type: AutomationTriggerType; config: Record<string, unknown> } {
  const raw = spec.trigger ?? { type: '', config: {} }
  const cfg = raw.config ?? {}
  const keywords = Array.isArray(cfg.keywords)
    ? [...new Set((cfg.keywords as unknown[]).map(str).filter(Boolean))]
    : []
  let type = oneOf(raw.type, GENERATOR_TRIGGERS)
  if (!type) {
    type = 'keyword_match'
    if (keywords.length === 0) {
      ctx.notes.push({ level: 'warning', message: 'No trigger was found in the script, so it was set to "Keyword detected". Add the keywords that should start it.' })
    }
  }

  if (type === 'keyword_match') {
    if (keywords.length === 0 && ctx.campaignId) {
      const camp = ctx.catalog.campaigns.find((c) => c.id === ctx.campaignId)
      const kw = camp?.keyword || camp?.code
      if (kw) {
        keywords.push(kw)
        ctx.notes.push({ level: 'info', message: `No keyword was given, so the campaign keyword "${kw}" is used.` })
      }
    }
    return {
      type,
      config: {
        keywords,
        match_type: oneOf(cfg.match_type, MATCH_TYPES) ?? 'word',
        case_sensitive: false,
        ...(ctx.campaignId ? { campaign_id: ctx.campaignId } : {}),
      },
    }
  }
  if (type === 'campaign_entry') {
    const id = ctx.campaignId ?? resolveCampaign(ctx, cfg.campaign_id)?.id ?? null
    return { type, config: id ? { campaign_id: id } : {} }
  }
  return { type, config: {} }
}

function forEach(steps: GeneratedStep[], visit: (s: GeneratedStep) => void): void {
  for (const s of steps) {
    visit(s)
    if (s.branches) {
      forEach(s.branches.yes, visit)
      forEach(s.branches.no, visit)
    }
  }
}

function usesEntry(step: GeneratedStep): boolean {
  const c = step.step_config
  if (
    (step.step_type === 'campaign_set_status' ||
      step.step_type === 'campaign_generate_reference' ||
      step.step_type === 'campaign_set_field') &&
    !c.campaign_id
  ) {
    return true
  }
  return Object.values(c).some((v) => typeof v === 'string' && /\{\{\s*(entry|campaign)\./.test(v))
}

/** Warn about steps that read the campaign entry before it exists. */
function checkEntryOrder(steps: GeneratedStep[], notes: GeneratorNote[], step = { n: 0, added: false }): void {
  for (const s of steps) {
    step.n++
    if (s.step_type === 'campaign_add_entry') step.added = true
    else if (!step.added && usesEntry(s)) {
      notes.push({ level: 'warning', message: `Step ${step.n} uses the campaign entry before "Add campaign entry" runs, so it will be blank. Move "Add campaign entry" above it.` })
    }
    if (s.branches) {
      const before = step.added
      checkEntryOrder(s.branches.yes, notes, step)
      step.added = before
      checkEntryOrder(s.branches.no, notes, step)
      step.added = before
    }
  }
}

/**
 * Free-form WhatsApp messages only deliver within 24 hours of the
 * customer's last message. Ask Question waits for a reply, which
 * reopens the window.
 */
function checkMessagingWindow(steps: GeneratedStep[], notes: GeneratorNote[], hours: number): number {
  let elapsed = hours
  for (const s of steps) {
    if (s.step_type === 'wait') {
      const amount = Number(s.step_config.amount) || 0
      const unit = s.step_config.unit
      elapsed += unit === 'days' ? amount * 24 : unit === 'minutes' ? amount / 60 : amount
    } else if (FREE_FORM_SENDS.has(s.step_type) && elapsed >= WHATSAPP_WINDOW_HOURS) {
      notes.push({ level: 'warning', message: `A message after ${Math.round(elapsed)} hours of waiting falls outside WhatsApp's 24-hour window and won't deliver. Use "Send template" with an approved template instead.` })
      elapsed = -Infinity
    }
    if (s.step_type === 'ask_question') elapsed = 0
    if (s.branches) {
      const yes = checkMessagingWindow(s.branches.yes, notes, elapsed)
      const no = checkMessagingWindow(s.branches.no, notes, elapsed)
      elapsed = Math.max(yes, no)
    }
  }
  return elapsed
}

function checkKeywordConflicts(ctx: Ctx, config: Record<string, unknown>): void {
  const mine = config as unknown as KeywordMatchTriggerConfig
  for (const kw of mine.keywords ?? []) {
    for (const a of ctx.catalog.automations) {
      if (a.trigger_type !== 'keyword_match') continue
      const theirs = a.trigger_config as unknown as KeywordMatchTriggerConfig
      if (keywordTextMatches({ ...theirs, match_type: theirs.match_type ?? 'contains' }, kw)) {
        ctx.notes.push({
          level: 'warning',
          message: `A customer sending "${kw}" also starts "${a.name}"${a.is_active ? ' (active)' : ' (paused)'}. Both would run; change the keyword or pause one.`,
        })
      }
    }
  }
  for (const f of ctx.catalog.flows) {
    if (f.status !== 'active' || f.trigger_type !== 'keyword') continue
    for (const hit of blockedAutomationKeywords(mine, f.trigger_config)) {
      ctx.notes.push({
        level: 'warning',
        message: `The active flow "${f.name}" catches "${hit.automationKeyword}" first (its keyword "${hit.flowKeyword}"), so this automation would never run for it.`,
      })
    }
  }
}

/**
 * Turn parser output into a draft in the real automation schema:
 * resolves every record reference against the caller's catalog (blanking
 * unknowns), keeps only supported steps and fields, stamps node ids,
 * then runs the same activation validators the save API uses.
 */
export function normalizeDraft(
  spec: DraftSpec,
  catalog: GeneratorCatalog,
  opts: { name: string; campaignId: string | null },
): Omit<GenerateResult, 'source'> {
  const campaignId = catalog.campaigns.some((c) => c.id === opts.campaignId) ? opts.campaignId : null
  const ctx: Ctx = {
    catalog,
    refs: catalogRefs(catalog),
    campaignId,
    notes: [...(spec.notes ?? [])],
    addedEntryCampaigns: new Set(),
  }

  const trigger = normalizeTrigger(ctx, spec)
  const steps = normalizeSteps(ctx, spec.steps ?? [], 0)

  if (campaignId && INBOUND_TRIGGERS.has(trigger.type) && ctx.addedEntryCampaigns.size === 0) {
    steps.unshift({ step_type: 'campaign_add_entry', step_config: { campaign_id: campaignId, node_id: newNodeId() } })
    ctx.notes.push({ level: 'info', message: `"Add campaign entry" for ${campaignName(ctx, campaignId)} was added as the first step so entries are tracked. Remove it if this automation shouldn't record entries.` })
  }

  if (trigger.type !== 'campaign_entry') checkEntryOrder(steps, ctx.notes)
  if (trigger.type === 'keyword_match') checkKeywordConflicts(ctx, trigger.config)
  if (INBOUND_TRIGGERS.has(trigger.type)) {
    checkMessagingWindow(steps, ctx.notes, 0)
  } else {
    let sendsFreeForm = false
    forEach(steps, (s) => { if (FREE_FORM_SENDS.has(s.step_type)) sendsFreeForm = true })
    if (sendsFreeForm) {
      ctx.notes.push({ level: 'warning', message: 'Campaign entries can also be added by hand or through the API. If that contact hasn\'t messaged in the last 24 hours, plain messages won\'t deliver; use an approved template for the first message.' })
    }
  }

  const automation = {
    name: opts.name.trim() || 'Generated automation',
    trigger_type: trigger.type,
    trigger_config: trigger.config,
    steps,
  }

  const issues = annotateIssues(
    [
      ...validateTriggerForActivation(trigger.type, trigger.config),
      ...validateStepsForActivation(steps),
      ...validateStepReferences(steps, { flows: catalog.flows }),
    ],
    steps,
  )

  return {
    automation,
    campaign_id: campaignId,
    issues,
    warnings: ctx.notes,
    summary: summarize(automation, catalog),
  }
}

// ------------------------------------------------------------
// Plain-language summary
// ------------------------------------------------------------

function quote(s: unknown, max = 120): string {
  const t = str(s).replace(/\s+/g, ' ')
  return `"${t.length > max ? `${t.slice(0, max - 1)}…` : t}"`
}

const MATCH_WORDING: Record<string, string> = {
  word: 'containing the word',
  contains: 'containing',
  exact: 'that is exactly',
  starts_with: 'starting with',
  ends_with: 'ending with',
}

function describeTrigger(a: { trigger_type: string; trigger_config: Record<string, unknown> }, catalog: GeneratorCatalog): string {
  const cfg = a.trigger_config
  switch (a.trigger_type) {
    case 'keyword_match': {
      const kws = (Array.isArray(cfg.keywords) ? cfg.keywords : []).map((k) => quote(k))
      return `When a customer sends a message ${MATCH_WORDING[String(cfg.match_type)] ?? 'containing'} ${kws.length ? kws.join(' or ') : '(no keyword yet)'}:`
    }
    case 'new_message_received':
      return 'When a customer sends a message that no keyword or button-reply automation handles:'
    case 'first_inbound_message':
      return 'When a contact messages you for the first time:'
    case 'campaign_entry': {
      const name = catalog.campaigns.find((c) => c.id === cfg.campaign_id)?.name
      return `When a contact gets a new entry in ${name ?? 'any campaign'}:`
    }
  }
  return `When ${a.trigger_type}:`
}

function describeStep(s: GeneratedStep, catalog: GeneratorCatalog): string {
  const c = s.step_config
  const tag = () => catalog.tags.find((t) => t.id === c.tag_id)?.name
  switch (s.step_type) {
    case 'send_message': return `Send the message ${quote(c.text)}`
    case 'send_media': return `Send ${str(c.media_type) || 'media'} ${str(c.url) || '(no link yet)'}${str(c.caption) ? ` with the caption ${quote(c.caption, 60)}` : ''}`
    case 'send_template': return `Send the approved template ${str(c.template_name) ? quote(c.template_name) : '(not picked yet)'}, which also works outside the 24-hour window`
    case 'ask_question': return `Ask ${quote(c.text)} and wait up to ${Number(c.timeout_hours) || 48} hours for the reply, saved as {{ vars.${str(c.var_key)} }}`
    case 'wait': return `Wait ${c.amount} ${c.unit}`
    case 'campaign_add_entry': return `Add them as an entry in ${catalog.campaigns.find((x) => x.id === c.campaign_id)?.name ?? '(campaign not picked yet)'}; an existing open entry is reused, so there are no duplicates`
    case 'campaign_set_status': return `Set their entry status to ${str(c.status).replace(/_/g, ' ') || '(not set)'}`
    case 'campaign_generate_reference': return 'Generate an entry reference, available as {{ entry.reference }}'
    case 'campaign_set_field': return `Save ${quote(c.value, 60)} to the campaign field ${str(c.field_key) || '(not set)'}`
    case 'start_flow': return `Hand over to the flow ${quote(catalog.flows.find((f) => f.id === c.flow_id)?.name ?? '(not picked yet)')}`
    case 'add_tag': return `Add the tag ${quote(tag() ?? '(not picked yet)')}`
    case 'remove_tag': return `Remove the tag ${quote(tag() ?? '(not picked yet)')}`
    case 'add_note': return 'Add an internal note to the contact'
    case 'set_conversation_status': return `Set the conversation to ${str(c.status) || '(not set)'}`
    case 'close_conversation': return 'Close the conversation'
    case 'end': return 'Stop here'
    case 'condition': {
      switch (c.subject) {
        case 'message_content': return `If their message contains ${quote(c.value)}:`
        case 'contact_field': return `If their ${str(c.operand) || 'field'} is ${quote(c.value)}:`
        case 'tag_presence': return `If they have the tag ${quote(tag() ?? catalog.tags.find((t) => t.id === c.operand)?.name ?? '(not picked yet)')}:`
        case 'time_of_day': return `If the time (UTC) is within ${str(c.operand) || '(no range yet)'}:`
      }
      return 'If (condition not set):'
    }
  }
  return s.step_type
}

function summarizeSteps(steps: GeneratedStep[], catalog: GeneratorCatalog, indent: string, lines: string[]): void {
  steps.forEach((s, i) => {
    lines.push(`${indent}${i + 1}. ${describeStep(s, catalog)}`)
    if (s.branches) {
      if (s.branches.yes.length) summarizeSteps(s.branches.yes, catalog, `${indent}   `, lines)
      else lines.push(`${indent}   (nothing)`)
      lines.push(`${indent}   Otherwise:`)
      if (s.branches.no.length) summarizeSteps(s.branches.no, catalog, `${indent}   `, lines)
      else lines.push(`${indent}   (nothing)`)
    }
  })
}

export function summarize(
  a: { trigger_type: string; trigger_config: Record<string, unknown>; steps: GeneratedStep[] },
  catalog: GeneratorCatalog,
): string[] {
  const lines = [describeTrigger(a, catalog)]
  if (a.steps.length === 0) lines.push('   (no steps)')
  summarizeSteps(a.steps, catalog, '', lines)
  return lines
}
