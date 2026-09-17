import type { AutomationTriggerType } from '@/types'

/**
 * Browser-side automation fire. Posts to `/api/automations/engine`
 * (cookie-authed, agent+). Failures are swallowed — dispatch is
 * best-effort and must not block the UI write that already succeeded.
 */
export async function dispatchClientTrigger(args: {
  triggerType: AutomationTriggerType
  contactId?: string | null
  context?: Record<string, unknown>
}): Promise<void> {
  try {
    await fetch('/api/automations/engine', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        trigger_type: args.triggerType,
        contact_id: args.contactId ?? null,
        context: args.context ?? {},
      }),
    })
  } catch (err) {
    console.error('[automations] client dispatch failed:', err)
  }
}
