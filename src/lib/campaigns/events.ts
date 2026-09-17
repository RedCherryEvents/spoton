import type { CampaignEntryEvent } from '@/types'

export function appendEntryEvent(
  metadata: Record<string, unknown> | null | undefined,
  event: Omit<CampaignEntryEvent, 'at'> & { at?: string },
): Record<string, unknown> {
  const current = Array.isArray(metadata?.events)
    ? (metadata!.events as CampaignEntryEvent[])
    : []
  const next: CampaignEntryEvent = {
    at: event.at ?? new Date().toISOString(),
    type: event.type,
    label: event.label,
    ...(event.detail ? { detail: event.detail } : {}),
  }
  return { ...(metadata ?? {}), events: [...current, next] }
}

export function eventsFromMetadata(
  metadata: Record<string, unknown> | null | undefined,
): CampaignEntryEvent[] {
  if (!metadata || !Array.isArray(metadata.events)) return []
  return metadata.events.filter(isEvent)
}

function isEvent(value: unknown): value is CampaignEntryEvent {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return (
    typeof row.at === 'string' &&
    typeof row.type === 'string' &&
    typeof row.label === 'string'
  )
}
