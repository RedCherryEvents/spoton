import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { asJsonError, loadCampaignFields, loadOwnedCampaign } from '@/lib/campaigns/access'
import { parseAnswers } from '@/lib/campaigns/answers'
import { loadEntryActivity } from '@/lib/campaigns/activity'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; entryId: string }> },
) {
  try {
    const ctx = await getCurrentAccount()
    const { id, entryId } = await params
    const campaign = await loadOwnedCampaign(ctx, id)

    const { data, error } = await ctx.supabase
      .from('campaign_entries')
      .select(
        '*, contact:contacts(id, name, phone, email, contact_tags(tags(id, name, color)))',
      )
      .eq('id', entryId)
      .eq('campaign_id', campaign.id)
      .eq('account_id', ctx.accountId)
      .maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const fields = await loadCampaignFields(ctx, campaign.id)
    const { data: values } = await ctx.supabase
      .from('campaign_entry_values')
      .select('field_id, value, updated_at')
      .eq('entry_id', entryId)

    const answers = parseAnswers(data.answers)
    for (const field of fields) {
      if (answers[field.key]?.value) continue
      const match = (values ?? []).find((v) => v.field_id === field.id)
      if (match?.value) answers[field.key] = { label: field.label, value: match.value }
    }

    const contactRaw = data.contact as {
      id: string
      name?: string
      phone?: string
      email?: string | null
      contact_tags?: Array<{ tags: { id: string; name: string; color: string } | null }>
    } | null
    const tags = (contactRaw?.contact_tags ?? [])
      .map((ct) => ct.tags)
      .filter((t): t is { id: string; name: string; color: string } => Boolean(t))

    let assignedAgent: { id: string; full_name: string } | null = null
    const agentId = data.assigned_agent_id as string | null
    if (agentId) {
      const { data: profile } = await ctx.supabase
        .from('profiles')
        .select('user_id, full_name')
        .eq('account_id', ctx.accountId)
        .eq('user_id', agentId)
        .maybeSingle()
      if (profile) assignedAgent = { id: profile.user_id, full_name: profile.full_name }
    }

    const activity = await loadEntryActivity({
      ctx,
      campaignId: campaign.id,
      entryId,
      contactId: data.contact_id as string,
      createdAt: data.created_at as string,
      metadata: data.metadata as Record<string, unknown> | null,
    })

    return NextResponse.json({
      entry: {
        ...data,
        answers,
        contact: contactRaw
          ? { ...contactRaw, tags }
          : null,
        assigned_agent: assignedAgent,
        campaign: { id: campaign.id, name: campaign.name, code: campaign.code },
      },
      fields,
      activity,
    })
  } catch (err) {
    return asJsonError(err) ?? toErrorResponse(err)
  }
}
