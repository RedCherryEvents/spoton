'use client'

import { useTranslations } from 'next-intl'
import type { CampaignDisplayStatus } from '@/lib/campaigns/display'
import { cn } from '@/lib/utils'

/** "● Live" (red), "● Scheduled" (amber), "○ Draft" (grey), … */
export function CampaignStatusPill({ status, className }: { status: CampaignDisplayStatus; className?: string }) {
  const t = useTranslations('Campaigns.list.displayStatus')
  const filled = status === 'live' || status === 'scheduled' || status === 'paused'
  const tone =
    status === 'live'
      ? 'text-primary'
      : status === 'scheduled' || status === 'paused'
        ? 'text-amber-500'
        : 'text-muted-foreground'
  return (
    <span className={cn('inline-flex items-center gap-2 font-medium', tone, className)}>
      <span
        aria-hidden
        className={cn(
          'h-2 w-2 rounded-full',
          filled ? 'bg-current' : 'border border-current',
          status === 'live' && 'animate-pulse',
        )}
      />
      {t(status)}
    </span>
  )
}
