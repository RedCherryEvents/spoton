import type {
  Campaign,
  CampaignEntry,
  CampaignEntryStatus,
} from '@/types'
import { parseAnswers, upsertAnswer } from '@/lib/campaigns/answers'
import { findDuplicateMatch, parseDuplicateRule } from '@/lib/campaigns/duplicate'
import { appendEntryEvent } from '@/lib/campaigns/events'
import { normalizeEntryStatus } from '@/lib/campaigns/status'
import { supabaseAdmin } from './admin-client'

export interface CampaignSnapshot {
  id: string
  name: string
  code: string
  keyword: string | null
  status: string
}

export interface EntrySnapshot {
  id: string
  campaign_id: string
  status: string
  entry_reference: string | null
}

export async function loadCampaign(
  accountId: string,
  campaignId: string,
): Promise<Campaign | null> {
  const { data } = await supabaseAdmin()
    .from('campaigns')
    .select('*')
    .eq('id', campaignId)
    .eq('account_id', accountId)
    .maybeSingle()
  return (data as Campaign | null) ?? null
}

export async function loadEntryById(
  accountId: string,
  entryId: string,
): Promise<CampaignEntry | null> {
  const { data } = await supabaseAdmin()
    .from('campaign_entries')
    .select('*')
    .eq('id', entryId)
    .eq('account_id', accountId)
    .maybeSingle()
  return data ? hydrateEntry(data) : null
}

/**
 * Working entry for a contact in a campaign: the latest in-progress
 * row if one exists, otherwise the most recent row. Multiple rows are
 * allowed (duplicates are kept for audit).
 */
export async function loadEntryForContact(
  accountId: string,
  campaignId: string,
  contactId: string,
): Promise<CampaignEntry | null> {
  const { data: open } = await supabaseAdmin()
    .from('campaign_entries')
    .select('*')
    .eq('account_id', accountId)
    .eq('campaign_id', campaignId)
    .eq('contact_id', contactId)
    .in('status', ['in_progress', 'active'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (open) return hydrateEntry(open)

  const { data } = await supabaseAdmin()
    .from('campaign_entries')
    .select('*')
    .eq('account_id', accountId)
    .eq('campaign_id', campaignId)
    .eq('contact_id', contactId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data ? hydrateEntry(data) : null
}

export interface AddCampaignEntryArgs {
  accountId: string
  campaignId: string
  contactId: string
  conversationId?: string | null
  automationId?: string | null
  assignedAgentId?: string | null
  source?: string
  messageText?: string | null
}

export interface AddCampaignEntryResult {
  entry: CampaignEntry
  created: boolean
  duplicate: boolean
}

/**
 * Insert a campaign entry, applying the campaign's duplicate rule.
 *
 * - An in-progress entry for the same contact is resumed (not duplicated).
 * - A matching completed/qualifying entry creates a new row with
 *   status=duplicate. The original is never deleted.
 * - `unlimited` always creates a fresh in-progress row once no open
 *   entry remains.
 */
export async function addCampaignEntry(
  args: AddCampaignEntryArgs,
): Promise<AddCampaignEntryResult | { error: string }> {
  const campaign = await loadCampaign(args.accountId, args.campaignId)
  if (!campaign) return { error: 'campaign not found' }
  if (campaign.status !== 'active') {
    return { error: `campaign is ${campaign.status}` }
  }

  const open = await loadOpenEntry(args.accountId, args.campaignId, args.contactId)
  if (open) return { entry: open, created: false, duplicate: false }

  const contact = await loadContact(args.accountId, args.contactId)
  if (!contact) return { error: 'contact not found' }

  const rule = parseDuplicateRule(campaign.settings?.duplicate_rule)
  const existing = await listCampaignEntriesForDuplicate(args.accountId, args.campaignId)
  const match = findDuplicateMatch({
    rule,
    candidate: {
      contactId: args.contactId,
      phone: contact.phone,
      email: contact.email,
      createdAt: new Date().toISOString(),
      status: 'in_progress',
    },
    existing,
  })

  const isDuplicate = Boolean(match)
  const now = new Date().toISOString()
  let metadata: Record<string, unknown> = {}
  if (campaign.keyword && args.messageText) {
    metadata = appendEntryEvent(metadata, {
      type: 'keyword_detected',
      label: `Keyword ${campaign.keyword} detected`,
      detail: args.messageText,
      at: now,
    })
  }
  metadata = appendEntryEvent(metadata, {
    type: 'campaign_started',
    label: 'Campaign started',
    at: now,
  })
  if (args.source === 'automation' || args.automationId) {
    metadata = appendEntryEvent(metadata, {
      type: 'automation_started',
      label: 'Automation started',
      at: now,
    })
  }
  if (isDuplicate) {
    metadata = appendEntryEvent(metadata, {
      type: 'duplicate_detected',
      label: 'Duplicate entry detected',
      detail: match?.id,
      at: now,
    })
    metadata.duplicate_of = match?.id ?? null
    metadata.duplicate_rule = rule
  }

  const entryNumber = await nextEntryNumber(args.accountId, args.campaignId)
  const { data, error } = await supabaseAdmin()
    .from('campaign_entries')
    .insert({
      campaign_id: args.campaignId,
      account_id: args.accountId,
      contact_id: args.contactId,
      conversation_id: args.conversationId ?? null,
      automation_id: args.automationId ?? null,
      assigned_agent_id: args.assignedAgentId ?? null,
      status: isDuplicate ? 'duplicate' : 'in_progress',
      source: args.source ?? 'automation',
      entry_number: entryNumber,
      answers: {},
      metadata,
    })
    .select('*')
    .single()

  if (error || !data) {
    const raced = await loadOpenEntry(args.accountId, args.campaignId, args.contactId)
    if (raced) return { entry: raced, created: false, duplicate: false }
    return { error: error?.message ?? 'failed to add campaign entry' }
  }
  return { entry: hydrateEntry(data), created: true, duplicate: isDuplicate }
}

export async function setCampaignEntryStatus(args: {
  accountId: string
  campaignId: string
  contactId: string
  status: CampaignEntryStatus | string
  entryId?: string | null
}): Promise<string> {
  const status = normalizeEntryStatus(args.status)
  if (!status) throw new Error(`invalid entry status: ${args.status}`)

  const entry = args.entryId
    ? await loadEntryById(args.accountId, args.entryId)
    : await loadEntryForContact(args.accountId, args.campaignId, args.contactId)
  if (!entry) return 'no entry to update'

  const now = new Date().toISOString()
  const patch: Record<string, unknown> = {
    status,
    updated_at: now,
    metadata: appendEntryEvent(entry.metadata, {
      type: status === 'completed' ? 'entry_completed' : 'status_changed',
      label:
        status === 'completed'
          ? 'Entry completed'
          : status === 'invalid'
            ? 'Entry marked invalid'
            : status === 'duplicate'
              ? 'Entry marked duplicate'
              : status === 'disqualified'
                ? 'Entry disqualified'
                : `Status set to ${status}`,
      at: now,
    }),
  }
  if (status === 'completed') patch.completed_at = entry.completed_at ?? now

  const { error, count } = await supabaseAdmin()
    .from('campaign_entries')
    .update(patch)
    .eq('id', entry.id)
    .eq('account_id', args.accountId)
  if (error) throw new Error(error.message)
  return count === 0 ? 'no entry to update' : `entry status=${status}`
}

/**
 * Assign `{campaign.code}-{n}` where n is 1-based among this campaign's
 * entries, ordered by created_at. Idempotent: existing references stay.
 */
export async function generateEntryReference(args: {
  accountId: string
  campaignId: string
  contactId: string
  entryId?: string | null
}): Promise<string> {
  const campaign = await loadCampaign(args.accountId, args.campaignId)
  if (!campaign) throw new Error('campaign not found')
  const entry = args.entryId
    ? await loadEntryById(args.accountId, args.entryId)
    : await loadEntryForContact(args.accountId, args.campaignId, args.contactId)
  if (!entry) throw new Error('campaign entry not found')
  if (entry.entry_reference) return entry.entry_reference

  const n = entry.entry_number && entry.entry_number > 0
    ? entry.entry_number
    : await countEntriesUpTo(args.accountId, args.campaignId, entry.created_at)
  const reference = `${campaign.code}-${n}`
  const now = new Date().toISOString()
  const { error } = await supabaseAdmin()
    .from('campaign_entries')
    .update({
      entry_reference: reference,
      updated_at: now,
      metadata: appendEntryEvent(entry.metadata, {
        type: 'reference_generated',
        label: `Entry reference ${reference}`,
        at: now,
      }),
    })
    .eq('id', entry.id)
    .eq('account_id', args.accountId)
    .is('entry_reference', null)
  if (error) throw new Error(error.message)
  return reference
}

export async function setCampaignFieldValue(args: {
  accountId: string
  campaignId: string
  contactId: string
  fieldKey: string
  value: string
  entryId?: string | null
}): Promise<string> {
  const { data: field } = await supabaseAdmin()
    .from('campaign_field_definitions')
    .select('*')
    .eq('campaign_id', args.campaignId)
    .eq('account_id', args.accountId)
    .eq('key', args.fieldKey)
    .maybeSingle()
  if (!field) throw new Error(`unknown campaign field: ${args.fieldKey}`)

  const entry = args.entryId
    ? await loadEntryById(args.accountId, args.entryId)
    : await loadEntryForContact(args.accountId, args.campaignId, args.contactId)
  if (!entry) throw new Error('campaign entry not found')

  const { error } = await supabaseAdmin()
    .from('campaign_entry_values')
    .upsert(
      {
        entry_id: entry.id,
        field_id: field.id,
        value: args.value,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'entry_id,field_id' },
    )
  if (error) throw new Error(error.message)

  const now = new Date().toISOString()
  const answers = upsertAnswer(entry.answers ?? {}, field, args.value)
  await supabaseAdmin()
    .from('campaign_entries')
    .update({
      answers,
      updated_at: now,
      metadata: appendEntryEvent(entry.metadata, {
        type: 'field_captured',
        label: `${field.label} captured`,
        detail: args.value,
        at: now,
      }),
    })
    .eq('id', entry.id)
    .eq('account_id', args.accountId)

  return `field ${args.fieldKey} set`
}

export async function appendCampaignEntryEvent(args: {
  accountId: string
  entryId: string
  type: string
  label: string
  detail?: string
}): Promise<void> {
  const entry = await loadEntryById(args.accountId, args.entryId)
  if (!entry) return
  await supabaseAdmin()
    .from('campaign_entries')
    .update({
      metadata: appendEntryEvent(entry.metadata, {
        type: args.type,
        label: args.label,
        detail: args.detail,
      }),
      updated_at: new Date().toISOString(),
    })
    .eq('id', entry.id)
    .eq('account_id', args.accountId)
}

export function campaignSnapshot(c: Campaign): CampaignSnapshot {
  return {
    id: c.id,
    name: c.name,
    code: c.code,
    keyword: c.keyword ?? null,
    status: c.status,
  }
}

export function entrySnapshot(e: CampaignEntry): EntrySnapshot {
  return {
    id: e.id,
    campaign_id: e.campaign_id,
    status: e.status,
    entry_reference: e.entry_reference ?? null,
  }
}

function hydrateEntry(row: Record<string, unknown>): CampaignEntry {
  return {
    ...(row as unknown as CampaignEntry),
    answers: parseAnswers(row.answers),
    metadata:
      row.metadata && typeof row.metadata === 'object'
        ? (row.metadata as Record<string, unknown>)
        : {},
  }
}

async function loadOpenEntry(
  accountId: string,
  campaignId: string,
  contactId: string,
): Promise<CampaignEntry | null> {
  const { data } = await supabaseAdmin()
    .from('campaign_entries')
    .select('*')
    .eq('account_id', accountId)
    .eq('campaign_id', campaignId)
    .eq('contact_id', contactId)
    .in('status', ['in_progress', 'active'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data ? hydrateEntry(data) : null
}

async function loadContact(accountId: string, contactId: string) {
  const { data } = await supabaseAdmin()
    .from('contacts')
    .select('id, phone, email, name')
    .eq('id', contactId)
    .eq('account_id', accountId)
    .maybeSingle()
  return data
}

async function listCampaignEntriesForDuplicate(
  accountId: string,
  campaignId: string,
): Promise<
  Array<{
    id: string
    contactId: string
    phone?: string | null
    email?: string | null
    createdAt: string
    status: string
  }>
> {
  const { data } = await supabaseAdmin()
    .from('campaign_entries')
    .select('id, contact_id, status, created_at, contact:contacts(phone, email)')
    .eq('account_id', accountId)
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: true })
    .limit(5000)

  return (data ?? []).map((row) => {
    const contact = Array.isArray(row.contact) ? row.contact[0] : row.contact
    return {
      id: row.id as string,
      contactId: row.contact_id as string,
      phone: (contact as { phone?: string } | null)?.phone ?? null,
      email: (contact as { email?: string } | null)?.email ?? null,
      createdAt: row.created_at as string,
      status: row.status as string,
    }
  })
}

async function nextEntryNumber(accountId: string, campaignId: string): Promise<number> {
  const { data } = await supabaseAdmin()
    .from('campaign_entries')
    .select('entry_number')
    .eq('account_id', accountId)
    .eq('campaign_id', campaignId)
    .order('entry_number', { ascending: false })
    .limit(1)
    .maybeSingle()
  const max = typeof data?.entry_number === 'number' ? data.entry_number : 0
  return max + 1
}

async function countEntriesUpTo(
  accountId: string,
  campaignId: string,
  createdAt: string,
): Promise<number> {
  const { count } = await supabaseAdmin()
    .from('campaign_entries')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', accountId)
    .eq('campaign_id', campaignId)
    .lte('created_at', createdAt)
  return Math.max(1, count ?? 1)
}
