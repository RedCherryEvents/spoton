import type { AccountContext } from '@/lib/auth/account'
import { ForbiddenError } from '@/lib/auth/account'
import type { Campaign, CampaignFieldDefinition } from '@/types'
import {
  campaignsNotReadyResponse,
  isMissingRelationError,
} from '@/lib/campaigns/schema-error'
import { NextResponse } from 'next/server'

export async function loadOwnedCampaign(
  ctx: AccountContext,
  campaignId: string,
): Promise<Campaign> {
  const { data, error } = await ctx.supabase
    .from('campaigns')
    .select('*')
    .eq('id', campaignId)
    .eq('account_id', ctx.accountId)
    .maybeSingle()
  if (error) {
    if (isMissingRelationError(error)) {
      throw Object.assign(new Error('campaigns_not_ready'), { response: campaignsNotReadyResponse() })
    }
    throw new Error(error.message)
  }
  if (!data) throw new ForbiddenError('Campaign not found')
  return data as Campaign
}

export async function loadCampaignFields(
  ctx: AccountContext,
  campaignId: string,
): Promise<CampaignFieldDefinition[]> {
  const { data, error } = await ctx.supabase
    .from('campaign_field_definitions')
    .select('*')
    .eq('campaign_id', campaignId)
    .eq('account_id', ctx.accountId)
    .order('position', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []) as CampaignFieldDefinition[]
}

export function missingRelationOrThrow(error: { message?: string; code?: string } | null) {
  if (error && isMissingRelationError(error)) return campaignsNotReadyResponse()
  return null
}

export function asJsonError(err: unknown): NextResponse | null {
  if (err && typeof err === 'object' && 'response' in err) {
    return (err as { response: NextResponse }).response
  }
  return null
}
