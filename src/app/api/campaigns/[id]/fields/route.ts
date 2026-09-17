import { NextResponse } from 'next/server'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { asJsonError, loadOwnedCampaign } from '@/lib/campaigns/access'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getCurrentAccount()
    const { id } = await params
    await loadOwnedCampaign(ctx, id)
    const { data, error } = await ctx.supabase
      .from('campaign_field_definitions')
      .select('*')
      .eq('campaign_id', id)
      .eq('account_id', ctx.accountId)
      .order('position', { ascending: true })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ fields: data ?? [] })
  } catch (err) {
    return asJsonError(err) ?? toErrorResponse(err)
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole('agent')
    const { id } = await params
    await loadOwnedCampaign(ctx, id)
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    const key = typeof body?.key === 'string' ? body.key.trim() : ''
    const label = typeof body?.label === 'string' ? body.label.trim() : ''
    if (!key || !label) {
      return NextResponse.json({ error: 'key and label are required' }, { status: 400 })
    }

    const allowedTypes = ['text', 'number', 'email', 'phone', 'select']
    const fieldType = allowedTypes.includes(String(body?.field_type ?? ''))
      ? String(body!.field_type)
      : 'text'

    const { data, error } = await ctx.supabase
      .from('campaign_field_definitions')
      .insert({
        campaign_id: id,
        account_id: ctx.accountId,
        key,
        label,
        field_type: fieldType,
        required: Boolean(body?.required),
        options: Array.isArray(body?.options) ? body.options : null,
        position: typeof body?.position === 'number' ? body.position : 0,
      })
      .select('*')
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ field: data }, { status: 201 })
  } catch (err) {
    return asJsonError(err) ?? toErrorResponse(err)
  }
}
