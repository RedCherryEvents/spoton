import { NextResponse } from 'next/server'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { asJsonError, loadCampaignFields, loadOwnedCampaign } from '@/lib/campaigns/access'
import { parseEntryFilters, queryCampaignEntries } from '@/lib/campaigns/query'
import { addCampaignEntry } from '@/lib/automations/campaign-ops'
import { runAutomationsForTrigger } from '@/lib/automations/engine'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getCurrentAccount()
    const { id } = await params
    const campaign = await loadOwnedCampaign(ctx, id)
    const fields = await loadCampaignFields(ctx, campaign.id)
    const filters = parseEntryFilters(new URL(request.url))
    const { entries, total } = await queryCampaignEntries({
      ctx,
      campaignId: campaign.id,
      fields,
      filters,
    })
    return NextResponse.json({
      entries,
      total,
      page: filters.page ?? 1,
      pageSize: filters.pageSize,
      fields,
    })
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
    const contactId = typeof body?.contact_id === 'string' ? body.contact_id : ''
    if (!contactId) {
      return NextResponse.json({ error: 'contact_id is required' }, { status: 400 })
    }

    const result = await addCampaignEntry({
      accountId: ctx.accountId,
      campaignId: id,
      contactId,
      source: 'manual',
    })
    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }
    if (result.created && !result.duplicate) {
      await runAutomationsForTrigger({
        accountId: ctx.accountId,
        triggerType: 'campaign_entry',
        contactId,
        context: { campaign_id: id },
      })
    }
    return NextResponse.json(
      { entry: result.entry, created: result.created, duplicate: result.duplicate },
      { status: result.created ? 201 : 200 },
    )
  } catch (err) {
    return asJsonError(err) ?? toErrorResponse(err)
  }
}
