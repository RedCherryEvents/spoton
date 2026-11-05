import { NextResponse } from 'next/server'
import { CAMPAIGN_TYPES } from '@/lib/campaigns/display'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import {
  campaignsNotReadyResponse,
  isMissingRelationError,
} from '@/lib/campaigns/schema-error'

export async function GET() {
  try {
    const ctx = await getCurrentAccount()
    const { data, error } = await ctx.supabase
      .from('campaigns')
      .select('*')
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false })
    if (error) {
      if (isMissingRelationError(error)) return campaignsNotReadyResponse()
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    // Entry count per campaign, for the list. One head-count each, run
    // together (an account has a handful of campaigns, not thousands).
    const campaigns = data ?? []
    const counts = await Promise.all(
      campaigns.map((c) =>
        ctx.supabase
          .from('campaign_entries')
          .select('id', { count: 'exact', head: true })
          .eq('account_id', ctx.accountId)
          .eq('campaign_id', c.id)
          .then(({ count }) => count ?? 0),
      ),
    )
    return NextResponse.json({
      campaigns: campaigns.map((c, i) => ({ ...c, entry_count: counts[i] })),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent')
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    const name = typeof body?.name === 'string' ? body.name.trim() : ''
    const code = typeof body?.code === 'string' ? body.code.trim() : ''
    if (!name || !code) {
      return NextResponse.json({ error: 'name and code are required' }, { status: 400 })
    }

    const { data, error } = await ctx.supabase
      .from('campaigns')
      .insert({
        account_id: ctx.accountId,
        user_id: ctx.userId,
        name,
        code,
        keyword: typeof body?.keyword === 'string' ? body.keyword.trim() || null : null,
        description: typeof body?.description === 'string' ? body.description.trim() || null : null,
        status: 'draft',
        settings:
          typeof body?.type === 'string' && (CAMPAIGN_TYPES as string[]).includes(body.type)
            ? { type: body.type }
            : {},
      })
      .select('*')
      .single()
    if (error) {
      if (isMissingRelationError(error)) return campaignsNotReadyResponse()
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ campaign: data }, { status: 201 })
  } catch (err) {
    return toErrorResponse(err)
  }
}
