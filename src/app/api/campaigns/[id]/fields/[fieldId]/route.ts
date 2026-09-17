import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { asJsonError, loadOwnedCampaign } from '@/lib/campaigns/access'

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; fieldId: string }> },
) {
  try {
    const ctx = await requireRole('agent')
    const { id, fieldId } = await params
    await loadOwnedCampaign(ctx, id)
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

    const patch: Record<string, unknown> = {}
    for (const key of ['key', 'label', 'required', 'options', 'position']) {
      if (key in body) patch[key] = body[key]
    }
    if (typeof body.field_type === 'string') {
      if (!['text', 'number', 'email', 'phone', 'select'].includes(body.field_type)) {
        return NextResponse.json({ error: 'invalid field_type' }, { status: 400 })
      }
      patch.field_type = body.field_type
    }

    const { data, error } = await ctx.supabase
      .from('campaign_field_definitions')
      .update(patch)
      .eq('id', fieldId)
      .eq('campaign_id', id)
      .eq('account_id', ctx.accountId)
      .select('*')
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ field: data })
  } catch (err) {
    return asJsonError(err) ?? toErrorResponse(err)
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; fieldId: string }> },
) {
  try {
    const ctx = await requireRole('agent')
    const { id, fieldId } = await params
    await loadOwnedCampaign(ctx, id)
    const { error } = await ctx.supabase
      .from('campaign_field_definitions')
      .delete()
      .eq('id', fieldId)
      .eq('campaign_id', id)
      .eq('account_id', ctx.accountId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return asJsonError(err) ?? toErrorResponse(err)
  }
}
