'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import type { Campaign, CampaignEntry, CampaignEntryEvent, CampaignFieldDefinition } from '@/types'
import { orderedAnswers, parseAnswers } from '@/lib/campaigns/answers'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Badge } from '@/components/ui/badge'
import { EntryStatusBadge } from './status-badge'

export function EntryDrawer({
  campaign,
  campaignId,
  entry,
  fields,
  onClose,
}: {
  campaign: Campaign
  campaignId: string
  entry: CampaignEntry | null
  fields: CampaignFieldDefinition[]
  onClose: () => void
}) {
  const t = useTranslations('Campaigns.drawer')
  const [detail, setDetail] = useState<{
    entry: CampaignEntry
    activity: CampaignEntryEvent[]
  } | null>(null)

  useEffect(() => {
    if (!entry) {
      setDetail(null)
      return
    }
    let cancelled = false
    void fetch(`/api/campaigns/${campaignId}/entries/${entry.id}`)
      .then((res) => res.json())
      .then((body) => {
        if (!cancelled) setDetail({ entry: body.entry, activity: body.activity ?? [] })
      })
    return () => {
      cancelled = true
    }
  }, [campaignId, entry])

  const shown = detail?.entry ?? entry
  const answers = orderedAnswers(fields, parseAnswers(shown?.answers))
  const tags = shown?.contact?.tags ?? []

  return (
    <Sheet open={Boolean(entry)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{shown?.entry_reference || t('title')}</SheetTitle>
        </SheetHeader>
        {shown && (
          <div className="space-y-6 px-4 pb-8">
            <section>
              <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{t('campaign')}</h3>
              <p className="mt-1 text-sm font-medium">{campaign.name}</p>
            </section>
            <section className="space-y-2">
              <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{t('entry')}</h3>
              <Row label={t('reference')} value={shown.entry_reference || '—'} />
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{t('status')}</span>
                <EntryStatusBadge status={shown.status} />
              </div>
              <Row label={t('created')} value={formatDate(shown.created_at)} />
              <Row label={t('completed')} value={shown.completed_at ? formatDate(shown.completed_at) : '—'} />
            </section>
            <section className="space-y-2">
              <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{t('contact')}</h3>
              <Row label={t('fullName')} value={shown.contact?.name || '—'} />
              <Row label={t('phone')} value={shown.contact?.phone || '—'} />
              <Row label={t('email')} value={shown.contact?.email || '—'} />
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-1">
                  {tags.map((tag) => (
                    <Badge key={tag.id} variant="outline" style={{ borderColor: tag.color }}>
                      {tag.name}
                    </Badge>
                  ))}
                </div>
              )}
            </section>
            <section className="space-y-3">
              <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{t('answers')}</h3>
              {answers.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('unanswered')}</p>
              ) : (
                answers.map((row) => (
                  <div key={row.key}>
                    <p className="text-xs text-muted-foreground">{row.label}</p>
                    <p className="text-sm">{row.value || t('unanswered')}</p>
                  </div>
                ))
              )}
            </section>
            <section className="space-y-3">
              <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{t('activity')}</h3>
              {(detail?.activity ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('noActivity')}</p>
              ) : (
                <ol className="space-y-3 border-l border-border pl-4">
                  {(detail?.activity ?? []).map((event, i) => (
                    <li key={`${event.at}-${i}`}>
                      <p className="text-xs tabular-nums text-muted-foreground">{formatTime(event.at)}</p>
                      <p className="text-sm">{event.label}</p>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  )
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString()
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}
