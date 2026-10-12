import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { asJsonError, loadOwnedCampaign } from '@/lib/campaigns/access'
import {
  campaignAutomationLinks,
  sortCampaignAutomations,
  type CampaignAutomationSummary,
} from '@/lib/campaigns/automation-links'
import type { Automation, AutomationStep } from '@/types'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getCurrentAccount()
    const { id } = await params
    const campaign = await loadOwnedCampaign(ctx, id)

    const { data: automations, error } = await ctx.supabase
      .from('automations')
      .select('*')
      .eq('account_id', ctx.accountId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const rows = (automations ?? []) as Automation[]
    const stepsByAutomation = new Map<string, Pick<AutomationStep, 'step_type' | 'step_config'>[]>()
    if (rows.length > 0) {
      const { data: steps, error: stepsErr } = await ctx.supabase
        .from('automation_steps')
        .select('automation_id, step_type, step_config')
        .in(
          'automation_id',
          rows.map((a) => a.id),
        )
      if (stepsErr) return NextResponse.json({ error: stepsErr.message }, { status: 500 })
      for (const s of (steps ?? []) as Pick<AutomationStep, 'automation_id' | 'step_type' | 'step_config'>[]) {
        const list = stepsByAutomation.get(s.automation_id) ?? []
        list.push(s)
        stepsByAutomation.set(s.automation_id, list)
      }
    }

    const linked: CampaignAutomationSummary[] = []
    for (const automation of rows) {
      const steps = stepsByAutomation.get(automation.id) ?? []
      const links = campaignAutomationLinks(campaign, automation, steps)
      if (links.length > 0) linked.push({ ...automation, step_count: steps.length, links })
    }

    return NextResponse.json({ automations: sortCampaignAutomations(linked) })
  } catch (err) {
    return asJsonError(err) ?? toErrorResponse(err)
  }
}
