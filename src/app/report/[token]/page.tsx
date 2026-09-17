'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { BrandLogo } from '@/components/brand-logo'
import type { ReportModel } from '@/lib/campaigns/export'
import type { CampaignReportSharePermissions } from '@/types'
import { EntryTrendChart } from '@/components/campaigns/entry-trend-chart'

export default function PublicCampaignReportPage() {
  const params = useParams<{ token: string }>()
  const [model, setModel] = useState<ReportModel | null>(null)
  const [permissions, setPermissions] = useState<CampaignReportSharePermissions | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void fetch(`/api/public/campaign-reports/${params.token}`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}))
        if (!res.ok) {
          setError(res.status === 410 ? 'expired' : 'missing')
          return
        }
        setModel(body.report)
        setPermissions(body.permissions)
      })
      .catch(() => setError('missing'))
  }, [params.token])

  if (error) {
    return (
      <div className="mx-auto max-w-lg px-6 py-24 text-center">
        <BrandLogo className="mx-auto h-8" />
        <h1 className="mt-8 text-xl font-semibold">SPOT ON Campaign Report</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {error === 'expired'
            ? 'This report link has expired or been revoked.'
            : 'This report could not be found.'}
        </p>
      </div>
    )
  }

  if (!model || !permissions) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const totals = model.stats.totals
  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <header className="flex items-start justify-between gap-4 border-b border-border pb-6">
        <div>
          <p className="text-xs font-semibold tracking-[0.16em] text-primary">SPOT ON</p>
          <h1 className="mt-2 text-2xl font-semibold">Campaign Report</h1>
          <p className="mt-1 text-lg">{model.campaignName}</p>
          <p className="mt-2 text-sm text-muted-foreground">Campaign period: {model.period}</p>
        </div>
        <div className="text-right">
          <BrandLogo />
          <p className="mt-2 text-sm text-muted-foreground">{model.clientName}</p>
        </div>
      </header>

      {permissions.summary && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold">Summary</h2>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Stat label="Total Entries" value={totals.total} />
            <Stat label="Completed" value={totals.completed} />
            <Stat label="Incomplete" value={totals.in_progress} />
            <Stat label="Invalid" value={totals.invalid} />
            <Stat label="Duplicate" value={totals.duplicate} />
          </div>
        </section>
      )}

      {permissions.statistics && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold">Entry trend</h2>
          <div className="mt-3 rounded-xl border border-border p-4">
            <EntryTrendChart points={model.stats.trend} />
          </div>
        </section>
      )}

      {permissions.answer_breakdown && model.stats.top_answers.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold">Top responses</h2>
          <div className="mt-4 grid gap-6 md:grid-cols-2">
            {model.stats.top_answers.map((field) => {
              const max = Math.max(...field.buckets.map((b) => b.count), 1)
              return (
                <div key={field.key}>
                  <h3 className="text-sm font-medium">{field.label}</h3>
                  <ul className="mt-3 space-y-2 text-sm">
                    {field.buckets.map((b) => (
                      <li key={b.value}>
                        <div className="flex justify-between gap-3">
                          <span>{b.value}</span>
                          <span className="tabular-nums text-muted-foreground">
                            {b.count.toLocaleString()}
                          </span>
                        </div>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full bg-primary"
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
        </section>
      )}

      {permissions.entry_details && (
        <section className="mt-8 overflow-x-auto">
          <h2 className="text-sm font-semibold">Entry data</h2>
          <table className="mt-3 w-full text-left text-xs">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                {model.columns.map((c) => (
                  <th key={c.key} className="px-2 py-2 font-medium whitespace-nowrap">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {model.rows.map((row, i) => (
                <tr key={i} className="border-b border-border">
                  {model.columns.map((c) => (
                    <td key={c.key} className="px-2 py-2 whitespace-nowrap">
                      {row.values[c.key] ?? ''}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border p-3">
      <p className="text-[11px] tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value.toLocaleString()}</p>
    </div>
  )
}
