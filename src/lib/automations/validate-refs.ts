import { supabaseAdmin } from './admin-client'
import {
  referencedFlowIds,
  validateStepReferences,
  type ValidationIssue,
} from './validate'

type StepLike = Parameters<typeof validateStepReferences>[0][number]

/**
 * Loads the flows that `start_flow` steps point at (scoped to the
 * account) and reports any that are missing or not active.
 */
export async function loadStepReferenceIssues(
  accountId: string,
  steps: StepLike[],
): Promise<ValidationIssue[]> {
  const ids = referencedFlowIds(steps)
  if (ids.length === 0) return []
  const { data, error } = await supabaseAdmin()
    .from('flows')
    .select('id, name, status')
    .eq('account_id', accountId)
    .in('id', ids)
  if (error) {
    return [{ path: 'steps', message: `could not check the selected flows: ${error.message}` }]
  }
  return validateStepReferences(steps, {
    flows: (data ?? []) as { id: string; name: string; status: string }[],
  })
}
