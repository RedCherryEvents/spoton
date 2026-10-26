import { supabaseAdmin } from './admin-client'
import {
  referencedCampaignIds,
  referencedFlowIds,
  validateStepReferences,
  type StepReferences,
  type ValidationIssue,
} from './validate'

type StepLike = Parameters<typeof validateStepReferences>[0][number]

/**
 * Loads the flows that `start_flow` steps point at and the campaigns
 * that `campaign_add_entry` steps point at (scoped to the account), and
 * reports any that are missing or not active.
 */
export async function loadStepReferenceIssues(
  accountId: string,
  steps: StepLike[],
): Promise<ValidationIssue[]> {
  const flowIds = referencedFlowIds(steps)
  const campaignIds = referencedCampaignIds(steps)
  if (flowIds.length === 0 && campaignIds.length === 0) return []

  const refs: StepReferences = { flows: [] }
  if (flowIds.length > 0) {
    const { data, error } = await supabaseAdmin()
      .from('flows')
      .select('id, name, status')
      .eq('account_id', accountId)
      .in('id', flowIds)
    if (error) {
      return [{ path: 'steps', message: `could not check the selected flows: ${error.message}` }]
    }
    refs.flows = (data ?? []) as StepReferences['flows']
  }
  if (campaignIds.length > 0) {
    const { data, error } = await supabaseAdmin()
      .from('campaigns')
      .select('id, name, status')
      .eq('account_id', accountId)
      .in('id', campaignIds)
    if (error) {
      return [{ path: 'steps', message: `could not check the selected campaigns: ${error.message}` }]
    }
    refs.campaigns = (data ?? []) as NonNullable<StepReferences['campaigns']>
  }
  return validateStepReferences(steps, refs)
}
