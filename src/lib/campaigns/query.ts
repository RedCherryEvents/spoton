import type { AccountContext } from '@/lib/auth/account'
import type {
  CampaignAnswerMap,
  CampaignEntry,
  CampaignFieldDefinition,
} from '@/types'
import { parseAnswers } from './answers'
import { statusFilterValues } from './status'

export const DEFAULT_PAGE_SIZE = 50
export const MAX_PAGE_SIZE = 200
export const MAX_EXPORT_ROWS = 20_000

export type EntrySort =
  | 'newest'
  | 'oldest'
  | 'entry_reference'
  | 'name_asc'
  | 'name_desc'
  | 'status'
  | 'date'
  | `field:${string}`

export interface EntryFilters {
  search?: string
  status?: string
  dateFrom?: string
  dateTo?: string
  entryReference?: string
  name?: string
  phone?: string
  email?: string
  tags?: string[]
  fieldFilters?: Record<string, string>
  sort?: EntrySort
  order?: 'asc' | 'desc'
  page?: number
  pageSize?: number
}

export interface HydratedCampaignEntry extends CampaignEntry {
  answers: CampaignAnswerMap
  contact?: CampaignEntry['contact'] & {
    email?: string | null
    tags?: Array<{ id: string; name: string; color: string }>
  }
}

export function parseEntryFilters(url: URL): EntryFilters {
  const q = url.searchParams
  const fieldFilters: Record<string, string> = {}
  q.forEach((value, key) => {
    if (key.startsWith('field.') && value.trim()) {
      fieldFilters[key.slice(6)] = value.trim()
    }
  })
  const tags = q.get('tags')
  return {
    search: q.get('q')?.trim() || undefined,
    status: q.get('status')?.trim() || undefined,
    dateFrom: q.get('from')?.trim() || undefined,
    dateTo: q.get('to')?.trim() || undefined,
    entryReference: q.get('reference')?.trim() || undefined,
    name: q.get('name')?.trim() || undefined,
    phone: q.get('phone')?.trim() || undefined,
    email: q.get('email')?.trim() || undefined,
    tags: tags
      ? tags.split(',').map((s) => s.trim()).filter(Boolean)
      : undefined,
    fieldFilters: Object.keys(fieldFilters).length ? fieldFilters : undefined,
    sort: parseSort(q.get('sort')),
    order: q.get('order') === 'asc' ? 'asc' : q.get('order') === 'desc' ? 'desc' : undefined,
    page: parsePositiveInt(q.get('page'), 1),
    pageSize: Math.min(
      MAX_PAGE_SIZE,
      parsePositiveInt(q.get('pageSize'), DEFAULT_PAGE_SIZE),
    ),
  }
}

export function parseSort(value: string | null): EntrySort | undefined {
  if (!value) return undefined
  if (
    value === 'newest' ||
    value === 'oldest' ||
    value === 'entry_reference' ||
    value === 'name_asc' ||
    value === 'name_desc' ||
    value === 'status' ||
    value === 'date'
  ) {
    return value
  }
  if (value.startsWith('field:')) return value as EntrySort
  return undefined
}

export async function queryCampaignEntries(args: {
  ctx: AccountContext
  campaignId: string
  fields: CampaignFieldDefinition[]
  filters: EntryFilters
  limit?: number
  offset?: number
}): Promise<{ entries: HydratedCampaignEntry[]; total: number }> {
  const { ctx, campaignId, fields, filters } = args
  const limit = args.limit ?? filters.pageSize ?? DEFAULT_PAGE_SIZE
  const offset =
    args.offset ??
    Math.max(0, ((filters.page ?? 1) - 1) * (filters.pageSize ?? DEFAULT_PAGE_SIZE))

  let allowedIds: string[] | null = null

  if (filters.fieldFilters) {
    for (const [key, value] of Object.entries(filters.fieldFilters)) {
      const field = fields.find((f) => f.key === key)
      if (!field) {
        allowedIds = []
        break
      }
      const { data } = await ctx.supabase
        .from('campaign_entry_values')
        .select('entry_id')
        .eq('field_id', field.id)
        .ilike('value', sanitizeIlike(value))
      const ids = (data ?? []).map((r) => r.entry_id as string)
      allowedIds = intersect(allowedIds, ids)
      if (allowedIds.length === 0) break
    }
  }

  if (filters.tags && filters.tags.length > 0) {
    const { data: tagged } = await ctx.supabase
      .from('contact_tags')
      .select('contact_id')
      .in('tag_id', filters.tags)
    const contactIds = [...new Set((tagged ?? []).map((r) => r.contact_id as string))]
    if (contactIds.length === 0) return { entries: [], total: 0 }

    const { data: taggedEntries } = await ctx.supabase
      .from('campaign_entries')
      .select('id')
      .eq('account_id', ctx.accountId)
      .eq('campaign_id', campaignId)
      .in('contact_id', contactIds)
    allowedIds = intersect(
      allowedIds,
      (taggedEntries ?? []).map((r) => r.id as string),
    )
  }

  if (filters.search) {
    const searchIds = await searchEntryIds(ctx, campaignId, filters.search, fields)
    allowedIds = intersect(allowedIds, searchIds)
  }

  if (allowedIds && allowedIds.length === 0) return { entries: [], total: 0 }

  const sort = resolveSort(filters)
  let query = ctx.supabase
    .from('campaign_entries')
    .select(
      '*, contact:contacts(id, name, phone, email, contact_tags(tags(id, name, color)))',
      { count: 'exact' },
    )
    .eq('account_id', ctx.accountId)
    .eq('campaign_id', campaignId)

  if (allowedIds) query = query.in('id', allowedIds)
  if (filters.status) query = query.in('status', statusFilterValues(filters.status))
  if (filters.dateFrom) query = query.gte('created_at', startOfDay(filters.dateFrom))
  if (filters.dateTo) query = query.lte('created_at', endOfDay(filters.dateTo))
  if (filters.entryReference) {
    query = query.ilike('entry_reference', sanitizeIlike(filters.entryReference))
  }

  if (filters.name || filters.phone || filters.email) {
    const contactIds = await searchContactIds(ctx, filters)
    if (contactIds.length === 0) return { entries: [], total: 0 }
    query = query.in('contact_id', contactIds)
  }

  if (sort.sort === 'entry_reference') {
    query = query.order('entry_reference', { ascending: sort.ascending })
  } else if (sort.sort === 'status') {
    query = query.order('status', { ascending: sort.ascending })
  } else {
    query = query.order('created_at', { ascending: sort.ascending })
  }

  const { data, error, count } = await query.range(offset, offset + limit - 1)
  if (error) throw new Error(error.message)

  let entries = ((data ?? []) as Record<string, unknown>[]).map((row) =>
    hydrateListedEntry(row, fields),
  )

  if (sort.sort === 'name_asc' || sort.sort === 'name_desc') {
    entries = [...entries].sort((a, b) => {
      const av = (a.contact?.name ?? '').toLowerCase()
      const bv = (b.contact?.name ?? '').toLowerCase()
      return sort.sort === 'name_asc' ? av.localeCompare(bv) : bv.localeCompare(av)
    })
  }

  if (sort.sort.startsWith('field:')) {
    const key = sort.sort.slice(6)
    entries = [...entries].sort((a, b) => {
      const av = (a.answers[key]?.value ?? '').toLowerCase()
      const bv = (b.answers[key]?.value ?? '').toLowerCase()
      return sort.ascending ? av.localeCompare(bv) : bv.localeCompare(av)
    })
  }

  entries = await attachAssignedAgents(ctx, entries)
  return { entries, total: count ?? entries.length }
}

function hydrateListedEntry(
  row: Record<string, unknown>,
  _fields: CampaignFieldDefinition[],
): HydratedCampaignEntry {
  const contactRaw = row.contact as
    | {
        id: string
        name?: string
        phone?: string
        email?: string | null
        contact_tags?: Array<{ tags: { id: string; name: string; color: string } | null }>
      }
    | null
  const tags = (contactRaw?.contact_tags ?? [])
    .map((ct) => ct.tags)
    .filter((t): t is { id: string; name: string; color: string } => Boolean(t))
  return {
    ...(row as unknown as CampaignEntry),
    answers: parseAnswers(row.answers),
    contact: contactRaw
      ? ({
          id: contactRaw.id,
          name: contactRaw.name,
          phone: contactRaw.phone ?? '',
          email: contactRaw.email ?? undefined,
          created_at: '',
          updated_at: '',
          user_id: '',
          account_id: '',
          tags: tags.map((tag) => ({
            ...tag,
            user_id: '',
            created_at: '',
          })),
        } as HydratedCampaignEntry['contact'])
      : undefined,
    campaign: undefined,
  }
}

async function searchEntryIds(
  ctx: AccountContext,
  campaignId: string,
  search: string,
  fields: CampaignFieldDefinition[],
): Promise<string[]> {
  const ids = new Set<string>()
  const q = sanitizeIlike(search)

  const { data: byRef } = await ctx.supabase
    .from('campaign_entries')
    .select('id')
    .eq('account_id', ctx.accountId)
    .eq('campaign_id', campaignId)
    .ilike('entry_reference', q)
    .limit(2000)
  for (const row of byRef ?? []) ids.add(row.id as string)

  const contactIds = await searchContactIds(ctx, { search })
  if (contactIds.length) {
    const { data: byContact } = await ctx.supabase
      .from('campaign_entries')
      .select('id')
      .eq('account_id', ctx.accountId)
      .eq('campaign_id', campaignId)
      .in('contact_id', contactIds)
      .limit(2000)
    for (const row of byContact ?? []) ids.add(row.id as string)
  }

  if (fields.length) {
    const { data: byValue } = await ctx.supabase
      .from('campaign_entry_values')
      .select('entry_id, field_id')
      .in(
        'field_id',
        fields.map((f) => f.id),
      )
      .ilike('value', q)
      .limit(2000)
    for (const row of byValue ?? []) ids.add(row.entry_id as string)
  }

  return [...ids]
}

async function searchContactIds(
  ctx: AccountContext,
  filters: Pick<EntryFilters, 'name' | 'phone' | 'email' | 'search'>,
): Promise<string[]> {
  let q = ctx.supabase
    .from('contacts')
    .select('id')
    .eq('account_id', ctx.accountId)

  const parts: string[] = []
  if (filters.name) parts.push(`name.ilike.${sanitizeIlike(filters.name)}`)
  if (filters.phone) parts.push(`phone.ilike.${sanitizeIlike(filters.phone)}`)
  if (filters.email) parts.push(`email.ilike.${sanitizeIlike(filters.email)}`)
  if (filters.search) {
    const s = sanitizeIlike(filters.search)
    parts.push(`name.ilike.${s}`, `phone.ilike.${s}`, `email.ilike.${s}`)
  }
  if (parts.length) q = q.or(parts.join(','))

  const { data } = await q.limit(500)
  return (data ?? []).map((r) => r.id as string)
}

async function attachAssignedAgents(
  ctx: AccountContext,
  entries: HydratedCampaignEntry[],
): Promise<HydratedCampaignEntry[]> {
  const agentIds = [
    ...new Set(entries.map((e) => e.assigned_agent_id).filter(Boolean)),
  ] as string[]
  const conversationIds = [
    ...new Set(
      entries
        .filter((e) => !e.assigned_agent_id && e.conversation_id)
        .map((e) => e.conversation_id as string),
    ),
  ]

  const convAgent = new Map<string, string>()
  if (conversationIds.length) {
    const { data } = await ctx.supabase
      .from('conversations')
      .select('id, assigned_agent_id')
      .eq('account_id', ctx.accountId)
      .in('id', conversationIds)
    for (const row of data ?? []) {
      if (row.assigned_agent_id) convAgent.set(row.id as string, row.assigned_agent_id as string)
    }
    for (const id of convAgent.values()) {
      if (!agentIds.includes(id)) agentIds.push(id)
    }
  }

  const names = new Map<string, string>()
  if (agentIds.length) {
    const { data } = await ctx.supabase
      .from('profiles')
      .select('user_id, full_name')
      .eq('account_id', ctx.accountId)
      .in('user_id', agentIds)
    for (const row of data ?? []) {
      names.set(row.user_id as string, (row.full_name as string) || '')
    }
  }

  return entries.map((entry) => {
    const agentId =
      entry.assigned_agent_id ||
      (entry.conversation_id ? convAgent.get(entry.conversation_id) : undefined)
    return {
      ...entry,
      assigned_agent_id: agentId ?? entry.assigned_agent_id,
      assigned_agent: agentId
        ? { id: agentId, full_name: names.get(agentId) || 'Agent' }
        : null,
    }
  })
}

function resolveSort(filters: EntryFilters): { sort: EntrySort; ascending: boolean } {
  const sort = filters.sort ?? 'newest'
  if (sort === 'newest') return { sort: 'date', ascending: false }
  if (sort === 'oldest') return { sort: 'date', ascending: true }
  if (sort === 'name_asc') return { sort: 'name_asc', ascending: true }
  if (sort === 'name_desc') return { sort: 'name_desc', ascending: false }
  const ascending = filters.order === 'asc' ? true : filters.order === 'desc' ? false : sort !== 'date'
  return { sort, ascending }
}

function intersect(current: string[] | null, next: string[]): string[] {
  if (!current) return next
  const set = new Set(next)
  return current.filter((id) => set.has(id))
}

export function sanitizeIlike(value: string): string {
  const cleaned = value.replace(/[,()%\\*]/g, ' ').trim().slice(0, 120)
  return `%${cleaned}%`
}

function parsePositiveInt(value: string | null, fallback: number): number {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 1) return fallback
  return Math.floor(n)
}

function startOfDay(isoDate: string): string {
  if (isoDate.includes('T')) return isoDate
  return `${isoDate}T00:00:00.000Z`
}

function endOfDay(isoDate: string): string {
  if (isoDate.includes('T')) return isoDate
  return `${isoDate}T23:59:59.999Z`
}
