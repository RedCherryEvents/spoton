import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { asJsonError, loadOwnedCampaign } from '@/lib/campaigns/access'
import {
  appOrigin,
  clampExpiryDays,
  generateReportToken,
  parsePermissions,
  reportExpiresAt,
  reportUrl,
} from '@/lib/campaigns/share'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole('admin')
    const { id } = await params
    const campaign = await loadOwnedCampaign(ctx, id)
    const { data, error } = await ctx.supabase
      .from('campaign_report_shares')
      .select('id, campaign_id, account_id, created_by, label, expires_at, revoked_at, permissions, created_at')
      .eq('campaign_id', campaign.id)
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ shares: data ?? [] })
  } catch (err) {
    return asJsonError(err) ?? toErrorResponse(err)
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole('admin')
    const limited = checkRateLimit(`report-share:${ctx.userId}`, RATE_LIMITS.adminAction)
    if (!limited.success) return rateLimitResponse(limited)

    const { id } = await params
    const campaign = await loadOwnedCampaign(ctx, id)
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    const { token, hash } = generateReportToken()
    const expires = reportExpiresAt(
      typeof body?.expires_in_days === 'number' ? body.expires_in_days : undefined,
    )
    const permissions = parsePermissions(body?.permissions)

    const { data, error } = await ctx.supabase
      .from('campaign_report_shares')
      .insert({
        campaign_id: campaign.id,
        account_id: ctx.accountId,
        created_by: ctx.userId,
        token_hash: hash,
        label: typeof body?.label === 'string' ? body.label.trim() || null : null,
        expires_at: expires.toISOString(),
        permissions,
      })
      .select('id, campaign_id, label, expires_at, revoked_at, permissions, created_at')
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({
      share: data,
      url: reportUrl(token, appOrigin(request)),
      expires_in_days: clampExpiryDays(
        typeof body?.expires_in_days === 'number' ? body.expires_in_days : undefined,
      ),
    }, { status: 201 })
  } catch (err) {
    return asJsonError(err) ?? toErrorResponse(err)
  }
}
