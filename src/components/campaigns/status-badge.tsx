'use client'

import { Badge } from '@/components/ui/badge'
import { normalizeEntryStatus } from '@/lib/campaigns/status'
import { cn } from '@/lib/utils'
import { useTranslations } from 'next-intl'

export function EntryStatusBadge({ status }: { status: string }) {
  const t = useTranslations('Campaigns.entryStatus')
  const canonical = normalizeEntryStatus(status) ?? 'in_progress'
  const tone =
    canonical === 'completed'
      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
      : canonical === 'invalid' || canonical === 'disqualified'
        ? 'border-red-500/40 bg-red-500/10 text-red-400'
        : canonical === 'duplicate'
          ? 'border-amber-500/40 bg-amber-500/10 text-amber-400'
          : 'border-border text-muted-foreground'
  return (
    <Badge variant="outline" className={cn(tone)}>
      {t(canonical)}
    </Badge>
  )
}
