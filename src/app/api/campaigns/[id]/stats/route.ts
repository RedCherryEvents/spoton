import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { asJsonError, loadCampaignFields, loadOwnedCampaign } from '@/lib/campaigns/access'
import { loadCampaignStats } from '@/lib/campaigns/stats'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getCurrentAccount()
    const { id } = await params
    const campaign = await loadOwnedCampaign(ctx, id)
    const fields = await loadCampaignFields(ctx, campaign.id)
    const url = new URL(request.url)
    const stats = await loadCampaignStats({
      ctx,
      campaignId: campaign.id,
      fields,
      dateFrom: url.searchParams.get('from') || undefined,
      dateTo: url.searchParams.get('to') || undefined,
      trendDays: Number(url.searchParams.get('days')) || 14,
    })
    return NextResponse.json({ campaign: { id: campaign.id, name: campaign.name }, stats })
  } catch (err) {
    return asJsonError(err) ?? toErrorResponse(err)
  }
}
