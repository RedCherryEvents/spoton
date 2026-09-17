import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { parseAnswers } from '@/lib/campaigns/answers'
import {
  exportColumns,
  filterSummary,
  toExportRow,
  buildReportModel,
} from '@/lib/campaigns/export'
import { hashReportToken, isShareActive, parsePermissions } from '@/lib/campaigns/share'
import { loadCampaignStats } from '@/lib/campaigns/stats'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import type { Campaign, CampaignFieldDefinition } from '@/types'
import type { HydratedCampaignEntry } from '@/lib/campaigns/query'
import type { AccountContext } from '@/lib/auth/account'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  const limited = checkRateLimit(`report-public:${ip}`, RATE_LIMITS.invitationPeek)
  if (!limited.success) return rateLimitResponse(limited)

  if (!token || token.length < 20) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const db = supabaseAdmin()
  const { data: share, error } = await db
    .from('campaign_report_shares')
    .select('*')
    .eq('token_hash', hashReportToken(token))
    .maybeSingle()
  if (error || !share) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!isShareActive(share)) {
    return NextResponse.json({ error: 'This report link has expired or been revoked' }, { status: 410 })
  }

  const { data: campaign } = await db
    .from('campaigns')
    .select('*')
    .eq('id', share.campaign_id)
    .eq('account_id', share.account_id)
    .maybeSingle()
  if (!campaign) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: fields } = await db
    .from('campaign_field_definitions')
    .select('*')
    .eq('campaign_id', campaign.id)
    .eq('account_id', share.account_id)
    .order('position', { ascending: true })

  const { data: account } = await db
    .from('accounts')
    .select('name')
    .eq('id', share.account_id)
    .maybeSingle()

  const ctx = {
    supabase: db,
    accountId: share.account_id as string,
  } as AccountContext

  const typedFields = (fields ?? []) as CampaignFieldDefinition[]
  const stats = await loadCampaignStats({
    ctx,
    campaignId: campaign.id,
    fields: typedFields,
  })

  const permissions = parsePermissions(share.permissions)
  let entries: HydratedCampaignEntry[] = []
  if (permissions.entry_details) {
    const { data } = await db
      .from('campaign_entries')
      .select('*, contact:contacts(id, name, phone, email)')
      .eq('campaign_id', campaign.id)
      .eq('account_id', share.account_id)
      .order('created_at', { ascending: false })
      .limit(5000)
    entries = (data ?? []).map((row) => {
      const contact = row.contact as { id: string; name?: string; phone?: string; email?: string | null } | null
      return {
        ...(row as unknown as HydratedCampaignEntry),
        answers: parseAnswers(row.answers),
        contact: contact
          ? {
              id: contact.id,
              name: contact.name,
              phone: contact.phone ?? '',
              email: contact.email ?? undefined,
              created_at: '',
              updated_at: '',
              user_id: '',
              account_id: '',
            }
          : undefined,
        assigned_agent: null,
        assigned_agent_id: null,
        automation_id: null,
        metadata: {},
      }
    })
  }

  const typedCampaign = campaign as Campaign
  const columns = exportColumns(typedFields, { includeAgent: false })
  const rows = entries.map((entry) => toExportRow(entry, typedCampaign, typedFields))
  const model = buildReportModel({
    campaign: typedCampaign,
    stats,
    columns,
    rows,
    filters: filterSummary({}),
    accountName: (account?.name as string) || 'Client',
    includeAgent: false,
  })

  return NextResponse.json({
    campaign: {
      name: typedCampaign.name,
      code: typedCampaign.code,
      starts_at: typedCampaign.starts_at,
      ends_at: typedCampaign.ends_at,
      settings: {
        client_name: typedCampaign.settings?.client_name,
        brand_color: typedCampaign.settings?.brand_color,
        logo_url: typedCampaign.settings?.logo_url,
      },
    },
    permissions,
    report: model,
  })
}
