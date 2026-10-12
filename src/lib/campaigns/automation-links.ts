import type { Automation, AutomationStep, Campaign } from '@/types'

export type CampaignAutomationLinkKind =
  /** `campaign_entry` trigger pinned to this campaign. */
  | 'entry_trigger'
  /** `campaign_entry` trigger with no campaign — fires for every campaign. */
  | 'entry_trigger_any'
  /** `time_based` trigger whose audience is this campaign's entrants. */
  | 'scheduled_audience'
  /** `keyword_match` trigger listening for the campaign code / keyword. */
  | 'keyword'
  /** A step whose config targets this campaign. */
  | 'step'

export interface CampaignAutomationLink {
  kind: CampaignAutomationLinkKind
  /** Matched keyword, or the step_type for `step` links. */
  detail?: string
}

export interface CampaignAutomationSummary extends Automation {
  step_count: number
  links: CampaignAutomationLink[]
}

type LinkCampaign = Pick<Campaign, 'id' | 'code' | 'keyword'>
type LinkAutomation = Pick<Automation, 'trigger_type' | 'trigger_config'>
type LinkStep = Pick<AutomationStep, 'step_type' | 'step_config'>

function norm(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

export function campaignAutomationLinks(
  campaign: LinkCampaign,
  automation: LinkAutomation,
  steps: LinkStep[],
): CampaignAutomationLink[] {
  const links: CampaignAutomationLink[] = []
  const cfg = (automation.trigger_config ?? {}) as Record<string, unknown>

  if (automation.trigger_type === 'campaign_entry') {
    if (!cfg.campaign_id) links.push({ kind: 'entry_trigger_any' })
    else if (cfg.campaign_id === campaign.id) links.push({ kind: 'entry_trigger' })
  }

  if (
    automation.trigger_type === 'time_based' &&
    cfg.audience === 'campaign' &&
    cfg.campaign_id === campaign.id
  ) {
    links.push({ kind: 'scheduled_audience' })
  }

  if (automation.trigger_type === 'keyword_match' && Array.isArray(cfg.keywords)) {
    const targets = new Set([norm(campaign.code), norm(campaign.keyword)].filter(Boolean))
    const hit = (cfg.keywords as unknown[]).find((k) => targets.has(norm(k)))
    if (typeof hit === 'string') links.push({ kind: 'keyword', detail: hit })
  }

  const seenSteps = new Set<string>()
  for (const step of steps) {
    const stepCfg = (step.step_config ?? {}) as Record<string, unknown>
    if (stepCfg.campaign_id !== campaign.id || seenSteps.has(step.step_type)) continue
    seenSteps.add(step.step_type)
    links.push({ kind: 'step', detail: step.step_type })
  }

  return links
}

/** Pinned links first, catch-all `entry_trigger_any` last; active before paused. */
export function sortCampaignAutomations(
  rows: CampaignAutomationSummary[],
): CampaignAutomationSummary[] {
  const specific = (r: CampaignAutomationSummary) =>
    r.links.some((l) => l.kind !== 'entry_trigger_any') ? 0 : 1
  return [...rows].sort(
    (a, b) =>
      specific(a) - specific(b) ||
      Number(b.is_active) - Number(a.is_active) ||
      a.name.localeCompare(b.name),
  )
}
