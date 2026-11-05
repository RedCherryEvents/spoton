'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { BarChart3, ChevronDown, Download, SlidersHorizontal } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { Campaign, CampaignFieldDefinition } from '@/types'
import type { CampaignStats } from '@/lib/campaigns/stats'
import type { HydratedCampaignEntry } from '@/lib/campaigns/query'
import {
  contactLanguageName,
  entryAnswer,
  entrySourceLabel,
  maskMobile,
  shortName,
} from '@/lib/campaigns/display'
import { normalizeEntryStatus } from '@/lib/campaigns/status'
import { EmptyState } from '@/components/dashboard/empty-state'
import { GatedButton } from '@/components/ui/gated-button'
import { Button } from '@/components/ui/button'
import { useCan } from '@/hooks/use-can'
import { cn } from '@/lib/utils'
import { EntryTrendChart } from './entry-trend-chart'
import { ExportModal } from './export-modal'

const RECENT = 10

export function CampaignOverviewTab({
  campaign,
  fields,
  stats,
  onOpenEntries,
}: {
  campaign: Campaign
  fields: CampaignFieldDefinition[]
  stats: CampaignStats | null
  onOpenEntries: () => void
}) {
  const t = useTranslations('Campaigns.stats')
  const to = useTranslations('Campaigns.overview')
  const ts = useTranslations('Campaigns.entryStatus')
  const router = useRouter()
  const canExport = useCan('export-campaigns')
  const [recent, setRecent] = useState<HydratedCampaignEntry[] | null>(null)
  const [others, setOthers] = useState<Pick<Campaign, 'id' | 'name'>[]>([])
  const [exportOpen, setExportOpen] = useState(false)
  const totals = stats?.totals
  const correct = campaign.settings?.correct_answer
  const isCompetition = campaign.settings?.type === 'competition'

  useEffect(() => {
    let cancelled = false
    void fetch(`/api/campaigns/${campaign.id}/entries?sort=newest&page=1&pageSize=${RECENT}`)
      .then((r) => r.json())
      .then((body) => {
        if (!cancelled) setRecent(body.entries ?? [])
      })
      .catch(() => !cancelled && setRecent([]))
    return () => {
      cancelled = true
    }
  }, [campaign.id])

  useEffect(() => {
    void fetch('/api/campaigns')
      .then((r) => r.json())
      .then((body) => setOthers(body.campaigns ?? []))
      .catch(() => setOthers([]))
  }, [])

  const topSource = stats?.sources?.[0]

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-border bg-card p-5 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-[0.3em] text-muted-foreground">
              {to('campaign')}
            </p>
            <label className="relative mt-1 inline-flex max-w-full items-center">
              <select
                aria-label={to('switchCampaign')}
                value={campaign.id}
                onChange={(e) => router.push(`/campaigns/${e.target.value}`)}
                className="max-w-full cursor-pointer appearance-none truncate bg-transparent pr-7 text-xl font-bold text-foreground outline-none sm:text-2xl"
              >
                {(others.length ? others : [campaign]).map((c) => (
                  <option key={c.id} value={c.id} className="bg-card text-base font-normal">
                    {c.name}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-0 h-5 w-5 text-foreground" />
            </label>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onOpenEntries} className="tracking-[0.2em] uppercase">
              <SlidersHorizontal className="h-4 w-4" />
              {to('filter')}
            </Button>
            <GatedButton
              canAct={canExport}
              gateReason="export campaign entries"
              onClick={() => setExportOpen(true)}
              className="tracking-[0.2em] uppercase"
            >
              <Download className="h-4 w-4" />
              {to('exportCsv')}
            </GatedButton>
          </div>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile label={t('total')} value={fmt(totals?.total)} accent hint={totals?.test ? to('testHint', { count: totals.test }) : undefined} />
          {totals?.correct !== null && totals?.correct !== undefined ? (
            <StatTile label={to('correct')} value={fmt(totals.correct)} />
          ) : (
            <StatTile label={t('completed')} value={fmt(totals?.completed)} />
          )}
          <StatTile label={t('today')} value={fmt(totals?.today)} hint={to('weekHint', { count: totals?.this_week ?? 0 })} />
          <StatTile
            label={to('topSource')}
            value={topSource?.value ?? '—'}
            small
            hint={topSource ? to('topSourceHint', { count: topSource.count }) : undefined}
          />
        </div>

        <div className="mt-6 overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left">
                {(['entry', 'name', 'mobile', 'source', 'answer', 'language', 'status', 'time'] as const).map((k) => (
                  <th key={k} className="px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.25em] text-amber-500">
                    {to(`col.${k}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {recent === null ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">…</td>
                </tr>
              ) : recent.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">{to('noEntries')}</td>
                </tr>
              ) : (
                recent.map((entry) => {
                  const answer = entryAnswer(entry.answers, fields, correct)
                  const status = normalizeEntryStatus(entry.status) ?? 'in_progress'
                  const inDraw = isCompetition && status === 'completed' && entry.metadata?.test !== true
                  return (
                    <tr
                      key={entry.id}
                      onClick={onOpenEntries}
                      className="cursor-pointer transition-colors hover:bg-muted/40"
                    >
                      <td className="px-4 py-3 font-semibold tabular-nums">#{entry.entry_number ?? '—'}</td>
                      <td className="px-4 py-3">{shortName(entry.contact?.name)}</td>
                      <td className="px-4 py-3 whitespace-nowrap tabular-nums">{maskMobile(entry.contact?.phone)}</td>
                      <td className="px-4 py-3 whitespace-nowrap">{entrySourceLabel(entry)}</td>
                      <td className="max-w-[220px] px-4 py-3">
                        <span className="block truncate">
                          {answer.value ?? '—'}
                          {answer.correct !== null && (
                            <span className={answer.correct ? 'text-emerald-500' : 'text-amber-500'}>
                              {' · '}
                              {answer.correct ? to('correctShort') : to('wrongShort')}
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {contactLanguageName(entry.contact?.tags) ?? '—'}
                      </td>
                      <td
                        className={cn(
                          'px-4 py-3 whitespace-nowrap font-medium',
                          inDraw || status === 'completed'
                            ? 'text-primary'
                            : status === 'in_progress'
                              ? 'text-muted-foreground'
                              : 'text-amber-500',
                        )}
                      >
                        {inDraw ? to('inDraw') : ts(status)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap tabular-nums text-muted-foreground">
                        {formatTime(entry.created_at)}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-[11px] uppercase tracking-[0.25em] text-muted-foreground">
          {to('footer', { count: Math.min(RECENT, totals?.total ?? 0) })}
        </p>
      </section>

      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold">{t('trend')}</h2>
        <div className="mt-4">
          {stats?.trend.some((p) => p.count > 0) ? (
            <EntryTrendChart points={stats.trend} />
          ) : (
            <EmptyState title={t('trendEmpty')} icon={BarChart3} />
          )}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Breakdown title={t('topAnswers')} empty={t('topAnswersEmpty')} groups={stats?.top_answers ?? []} />
        <Breakdown
          title={to('sources')}
          empty={to('sourcesEmpty')}
          groups={stats?.sources?.length ? [{ key: 'source', label: '', buckets: stats.sources }] : []}
        />
      </div>

      <ExportModal
        open={exportOpen}
        onOpenChange={setExportOpen}
        campaign={campaign}
        total={totals?.total ?? 0}
        filterLines={[]}
        filters={{ sort: 'newest', page: 1, pageSize: 50 }}
      />
    </div>
  )
}

function StatTile({
  label,
  value,
  accent,
  small,
  hint,
}: {
  label: string
  value: string
  accent?: boolean
  small?: boolean
  hint?: string
}) {
  return (
    <div className="rounded-xl border border-border bg-background/40 px-5 py-4">
      <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-muted-foreground">{label}</p>
      <p
        className={cn(
          'mt-2 truncate font-semibold tabular-nums',
          small ? 'text-xl sm:text-2xl' : 'text-3xl sm:text-4xl',
          accent ? 'text-primary' : 'text-foreground',
        )}
        title={value}
      >
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

function Breakdown({
  title,
  empty,
  groups,
}: {
  title: string
  empty: string
  groups: { key: string; label: string; buckets: { value: string; count: number }[] }[]
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <h2 className="text-sm font-semibold">{title}</h2>
      {groups.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <div className="mt-4 space-y-6">
          {groups.map((field) => {
            const max = Math.max(...field.buckets.map((b) => b.count), 1)
            return (
              <div key={field.key}>
                {field.label && <h3 className="text-sm font-medium">{field.label}</h3>}
                <ul className="mt-3 space-y-2">
                  {field.buckets.map((b) => (
                    <li key={b.value} className="text-sm">
                      <div className="flex items-center justify-between gap-3">
                        <span className="truncate">{b.value}</span>
                        <span className="tabular-nums text-muted-foreground">{b.count.toLocaleString('en-ZA')}</span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${Math.round((b.count / max) * 100)}%` }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

function fmt(n?: number | null): string {
  return (n ?? 0).toLocaleString('en-ZA')
}

/** "19:42" today, "4 Nov 19:42" otherwise (South African time). */
function formatTime(iso: string): string {
  const d = new Date(iso)
  const tz = 'Africa/Johannesburg'
  const time = d.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz })
  const day = (x: Date) => x.toLocaleDateString('en-ZA', { timeZone: tz })
  if (day(d) === day(new Date())) return time
  return `${d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', timeZone: tz })} ${time}`
}
