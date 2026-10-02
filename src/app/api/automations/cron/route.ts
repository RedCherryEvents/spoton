import { NextResponse } from 'next/server'
import { authorizeCron } from '@/lib/cron-auth'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { resumePendingExecution, fireTimeBasedAutomations, expireReplyWait } from '@/lib/automations/engine'
import type { AutomationContext } from '@/lib/automations/engine'

/**
 * Drain due `automation_pending_executions` rows. Meant to be hit
 * on a schedule (Vercel Cron / external pinger) — see `authorizeCron`.
 *
 * The claim step (status = 'running') serves as a simple lock so
 * overlapping invocations don't double-process rows. Best-effort
 * only; expensive SELECT ... FOR UPDATE is avoided in favor of a
 * two-step UPDATE-by-id.
 */
export async function GET(request: Request) {
  const denied = authorizeCron(request)
  if (denied) return denied

  const admin = supabaseAdmin()
  const { data: due, error } = await admin
    .from('automation_pending_executions')
    .select('*')
    .eq('status', 'pending')
    .lte('run_at', new Date().toISOString())
    .order('run_at', { ascending: true })
    .limit(50)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // No early return when nothing is due: time-based automations below
  // must fire on every tick, not only when a wait happens to be due.
  let processed = 0
  let expired = 0
  for (const row of due ?? []) {
    const { data: claim } = await admin
      .from('automation_pending_executions')
      .update({ status: 'running' })
      .eq('id', row.id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle()
    if (!claim) continue

    // A due reply wait means the customer never answered — the inbound
    // webhook resumes answered ones. End the run instead of continuing
    // as if they had replied.
    if (row.wait_kind === 'inbound_reply') {
      await expireReplyWait({ id: row.id as string, log_id: (row.log_id as string | null) ?? null })
      expired++
      continue
    }

    await resumePendingExecution({
      id: row.id as string,
      automation_id: row.automation_id as string,
      // account_id is NOT NULL on automation_pending_executions
      // post-017; the engine uses it for tenant-scoped lookups.
      account_id: row.account_id as string,
      user_id: row.user_id as string,
      contact_id: (row.contact_id as string | null) ?? null,
      log_id: (row.log_id as string | null) ?? null,
      parent_step_id: (row.parent_step_id as string | null) ?? null,
      branch: (row.branch as 'yes' | 'no' | null) ?? null,
      next_step_position: row.next_step_position as number,
      context: (row.context as AutomationContext) ?? {},
    })
    processed++
  }

  const scheduled = await fireTimeBasedAutomations()

  return NextResponse.json({ processed, expired, scheduled })
}
