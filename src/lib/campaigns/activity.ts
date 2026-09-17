import type { AccountContext } from '@/lib/auth/account'
import type { CampaignEntryEvent } from '@/types'
import { eventsFromMetadata } from './events'

export async function loadEntryActivity(args: {
  ctx: AccountContext
  campaignId: string
  entryId: string
  contactId: string
  createdAt: string
  metadata?: Record<string, unknown> | null
}): Promise<CampaignEntryEvent[]> {
  const fromMeta = eventsFromMetadata(args.metadata)
  const { data: logs } = await args.ctx.supabase
    .from('automation_logs')
    .select('created_at, trigger_event, steps_executed, status')
    .eq('account_id', args.ctx.accountId)
    .eq('contact_id', args.contactId)
    .gte('created_at', args.createdAt)
    .order('created_at', { ascending: true })
    .limit(20)

  const fromLogs: CampaignEntryEvent[] = []
  for (const log of logs ?? []) {
    const steps = Array.isArray(log.steps_executed) ? log.steps_executed : []
    for (const step of steps) {
      const row = step as { step_type?: string; status?: string; detail?: string }
      if (!row.step_type) continue
      if (!isCampaignRelatedStep(row.step_type)) continue
      fromLogs.push({
        at: log.created_at as string,
        type: row.step_type,
        label: labelForStep(row.step_type, row.detail),
        detail: row.detail,
      })
    }
  }

  const merged = [...fromMeta, ...fromLogs].sort((a, b) => a.at.localeCompare(b.at))
  const seen = new Set<string>()
  return merged.filter((event) => {
    const key = `${event.at}|${event.type}|${event.label}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function isCampaignRelatedStep(type: string): boolean {
  return (
    type.startsWith('campaign_') ||
    type === 'capture' ||
    type === 'validate' ||
    type === 'ask_question'
  )
}

function labelForStep(type: string, detail?: string): string {
  switch (type) {
    case 'campaign_add_entry':
      return 'Campaign started'
    case 'campaign_set_status':
      return detail || 'Entry status updated'
    case 'campaign_generate_reference':
      return detail || 'Entry reference generated'
    case 'campaign_set_field':
      return detail || 'Field captured'
    case 'capture':
      return detail || 'Question answered'
    case 'validate':
      return 'Validation completed'
    case 'send_message':
      return 'Confirmation sent'
    default:
      return detail || type.replace(/_/g, ' ')
  }
}
