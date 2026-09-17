import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { asJsonError, loadOwnedCampaign } from '@/lib/campaigns/access'

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; shareId: string }> },
) {
  try {
    const ctx = await requireRole('admin')
    const { id, shareId } = await params
    const campaign = await loadOwnedCampaign(ctx, id)
    const { data, error } = await ctx.supabase
      .from('campaign_report_shares')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', shareId)
      .eq('campaign_id', campaign.id)
      .eq('account_id', ctx.accountId)
      .is('revoked_at', null)
      .select('id, revoked_at')
      .maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ share: data })
  } catch (err) {
    return asJsonError(err) ?? toErrorResponse(err)
  }
}
