import type { AccountContext } from '@/lib/auth/account'
import type { CampaignFieldDefinition } from '@/types'
import { parseAnswers } from './answers'
import { normalizeEntryStatus, statusFilterValues } from './status'
import { startOfUtcDay } from './duplicate'

export interface CampaignEntryTotals {
  total: number
  completed: number
  in_progress: number
  invalid: number
  duplicate: number
  disqualified: number
  withdrawn: number
  today: number
  this_week: number
}

export interface CampaignTrendPoint {
  day: string
  count: number
}

export interface TopAnswerBucket {
  value: string
  count: number
}

export interface TopAnswerField {
  key: string
  label: string
  buckets: TopAnswerBucket[]
}

export interface CampaignStats {
  totals: CampaignEntryTotals
  trend: CampaignTrendPoint[]
  top_answers: TopAnswerField[]
}

export async function loadCampaignStats(args: {
  ctx: AccountContext
  campaignId: string
  fields: CampaignFieldDefinition[]
  dateFrom?: string
  dateTo?: string
  trendDays?: number
}): Promise<CampaignStats> {
  const { ctx, campaignId, fields } = args
  let query = ctx.supabase
    .from('campaign_entries')
    .select('id, status, created_at, answers')
    .eq('account_id', ctx.accountId)
    .eq('campaign_id', campaignId)
  if (args.dateFrom) query = query.gte('created_at', args.dateFrom)
  if (args.dateTo) query = query.lte('created_at', args.dateTo)

  const { data, error } = await query.limit(50_000)
  if (error) throw new Error(error.message)
  const rows = data ?? []

  const now = new Date()
  const todayStart = startOfUtcDay(now).toISOString()
  const weekStart = startOfIsoWeek(now).toISOString()

  const totals: CampaignEntryTotals = {
    total: rows.length,
    completed: 0,
    in_progress: 0,
    invalid: 0,
    duplicate: 0,
    disqualified: 0,
    withdrawn: 0,
    today: 0,
    this_week: 0,
  }

  const byDay = new Map<string, number>()
  const answerCounts = new Map<string, Map<string, number>>()

  for (const row of rows) {
    const status = normalizeEntryStatus(row.status) ?? 'in_progress'
    if (status === 'completed') totals.completed += 1
    else if (status === 'in_progress') totals.in_progress += 1
    else if (status === 'invalid') totals.invalid += 1
    else if (status === 'duplicate') totals.duplicate += 1
    else if (status === 'disqualified') totals.disqualified += 1
    else if (status === 'withdrawn') totals.withdrawn += 1

    const created = row.created_at as string
    if (created >= todayStart) totals.today += 1
    if (created >= weekStart) totals.this_week += 1

    const day = created.slice(0, 10)
    byDay.set(day, (byDay.get(day) ?? 0) + 1)

    const answers = parseAnswers(row.answers)
    for (const [key, cell] of Object.entries(answers)) {
      const value = (cell.value ?? '').trim()
      if (!value) continue
      if (!answerCounts.has(key)) answerCounts.set(key, new Map())
      const bucket = answerCounts.get(key)!
      bucket.set(value, (bucket.get(value) ?? 0) + 1)
    }
  }

  const trendDays = args.trendDays ?? 14
  const trend = buildTrend(byDay, trendDays)
  const top_answers = buildTopAnswers(fields, answerCounts, totals.completed || totals.total)

  return { totals, trend, top_answers }
}

export async function countEntriesByStatus(args: {
  ctx: AccountContext
  campaignId: string
  status?: string
}): Promise<number> {
  let query = args.ctx.supabase
    .from('campaign_entries')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', args.ctx.accountId)
    .eq('campaign_id', args.campaignId)
  if (args.status) query = query.in('status', statusFilterValues(args.status))
  const { count, error } = await query
  if (error) throw new Error(error.message)
  return count ?? 0
}

function buildTrend(byDay: Map<string, number>, days: number): CampaignTrendPoint[] {
  const out: CampaignTrendPoint[] = []
  const now = new Date()
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i))
    const key = d.toISOString().slice(0, 10)
    out.push({ day: key, count: byDay.get(key) ?? 0 })
  }
  return out
}

function buildTopAnswers(
  fields: CampaignFieldDefinition[],
  answerCounts: Map<string, Map<string, number>>,
  completed: number,
): TopAnswerField[] {
  const fieldByKey = new Map(fields.map((f) => [f.key, f]))
  const keys = new Set([...fieldByKey.keys(), ...answerCounts.keys()])
  const result: TopAnswerField[] = []

  for (const key of keys) {
    const field = fieldByKey.get(key)
    const counts = answerCounts.get(key)
    if (!counts || counts.size === 0) continue

    const skipTypes = new Set(['email', 'phone'])
    if (field && skipTypes.has(field.field_type)) continue
    const label = (field?.label ?? [...counts.keys()][0] ?? key).toString()
    if (/name|email|phone|whatsapp/i.test(field?.key ?? key) && field?.field_type !== 'select') {
      continue
    }

    const distinct = counts.size
    if (field?.field_type !== 'select' && completed > 0 && distinct > Math.max(12, completed * 0.5)) {
      continue
    }

    const buckets = [...counts.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8)
    if (buckets.length < 2 && field?.field_type !== 'select') continue
    result.push({ key, label: field?.label ?? label, buckets })
  }

  return result.sort((a, b) => (a.label > b.label ? 1 : -1))
}

function startOfIsoWeek(date: Date): Date {
  const day = date.getUTCDay() || 7
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  start.setUTCDate(start.getUTCDate() - (day - 1))
  return start
}
