'use client'

import { BarChart3, CheckCircle2, Copy, CircleDashed, ShieldAlert, CalendarDays } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { CampaignStats } from '@/lib/campaigns/stats'
import { MetricCard } from '@/components/dashboard/metric-card'
import { EmptyState } from '@/components/dashboard/empty-state'
import { EntryTrendChart } from './entry-trend-chart'

export function CampaignOverviewTab({ stats }: { stats: CampaignStats | null }) {
  const t = useTranslations('Campaigns.stats')
  const totals = stats?.totals

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard title={t('total')} value={fmt(totals?.total)} icon={BarChart3} />
        <MetricCard title={t('completed')} value={fmt(totals?.completed)} icon={CheckCircle2} />
        <MetricCard title={t('inProgress')} value={fmt(totals?.in_progress)} icon={CircleDashed} />
        <MetricCard title={t('invalid')} value={fmt(totals?.invalid)} icon={ShieldAlert} />
        <MetricCard title={t('duplicate')} value={fmt(totals?.duplicate)} icon={Copy} />
        <MetricCard title={t('today')} value={fmt(totals?.today)} icon={CalendarDays} />
        <MetricCard title={t('thisWeek')} value={fmt(totals?.this_week)} icon={CalendarDays} />
      </div>

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

      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold">{t('topAnswers')}</h2>
        {!stats || stats.top_answers.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">{t('topAnswersEmpty')}</p>
        ) : (
          <div className="mt-4 grid gap-6 md:grid-cols-2">
            {stats.top_answers.map((field) => {
              const max = Math.max(...field.buckets.map((b) => b.count), 1)
              return (
                <div key={field.key}>
                  <h3 className="text-sm font-medium">{field.label}</h3>
                  <ul className="mt-3 space-y-2">
                    {field.buckets.map((b) => (
                      <li key={b.value} className="text-sm">
                        <div className="flex items-center justify-between gap-3">
                          <span className="truncate">{b.value}</span>
                          <span className="tabular-nums text-muted-foreground">
                            {b.count.toLocaleString()}
                          </span>
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
    </div>
  )
}

function fmt(n?: number): string {
  return (n ?? 0).toLocaleString()
}
