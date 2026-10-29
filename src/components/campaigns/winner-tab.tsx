'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import type { CampaignAnswerMap, CampaignDraw } from '@/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface DrawRow extends CampaignDraw {
  winner: {
    id: string
    answers?: CampaignAnswerMap
    created_at: string
    contact?: { name?: string | null; phone?: string | null } | null
  } | null
}

/** Audited random draw (admin, after Closed) and a separate winner notification. */
export function CampaignWinnerTab({ campaignId }: { campaignId: string }) {
  const t = useTranslations('Campaigns.winner')
  const [data, setData] = useState<{ status: string; eligible: number; draws: DrawRow[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Bumped after a draw or notification to refetch.
  const [version, setVersion] = useState(0)
  const reload = () => setVersion((v) => v + 1)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/campaigns/${campaignId}/draws`)
      .then(async (res) => ({ ok: res.ok, body: await res.json().catch(() => ({})) }))
      .then(({ ok, body }) => {
        if (cancelled) return
        if (!ok) {
          setError(body.error || t('loadError'))
          return
        }
        setError(null)
        setData(body)
      })
      .catch(() => {
        if (!cancelled) setError(t('loadError'))
      })
    return () => {
      cancelled = true
    }
  }, [campaignId, t, version])

  async function runDraw() {
    if (!data || !window.confirm(t('confirmDraw', { count: data.eligible }))) return
    setBusy(true)
    const res = await fetch(`/api/campaigns/${campaignId}/draws`, { method: 'POST', body: '{}' })
    const body = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) {
      toast.error(body.error || t('drawError'))
      return
    }
    toast.success(t('drawn'))
    reload()
  }

  async function notify(drawId: string, templateName: string, language: string) {
    if (!templateName.trim()) {
      toast.error(t('templateRequired'))
      return
    }
    if (!window.confirm(t('confirmNotify', { template: templateName }))) return
    setBusy(true)
    const res = await fetch(`/api/campaigns/${campaignId}/draws/${drawId}/notify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ template_name: templateName, language: language || undefined }),
    })
    const body = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) {
      toast.error(body.error || t('notifyError'))
      return
    }
    toast.success(t('notified'))
    reload()
  }

  if (error) return <p className="text-sm text-muted-foreground">{error}</p>
  if (!data) return null
  const closed = data.status === 'closed'

  return (
    <div className="space-y-4">
      <section className="space-y-2 rounded-xl border border-border bg-card p-4">
        <h2 className="text-sm font-medium">{t('title')}</h2>
        <p className="text-xs text-muted-foreground">{t('hint')}</p>
        <p className="text-sm">{t('eligible', { count: data.eligible })}</p>
        {closed ? (
          <Button size="sm" onClick={() => void runDraw()} disabled={busy || data.eligible === 0}>
            {data.draws.length ? t('redraw') : t('draw')}
          </Button>
        ) : (
          <p className="text-xs text-amber-500">{t('closeFirst')}</p>
        )}
      </section>

      {data.draws.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('none')}</p>
      ) : (
        data.draws.map((d) => <DrawCard key={d.id} draw={d} canNotify={closed} busy={busy} onNotify={notify} />)
      )}
    </div>
  )
}

function DrawCard({
  draw,
  canNotify,
  busy,
  onNotify,
}: {
  draw: DrawRow
  canNotify: boolean
  busy: boolean
  onNotify: (drawId: string, template: string, language: string) => Promise<void>
}) {
  const t = useTranslations('Campaigns.winner')
  const [template, setTemplate] = useState('')
  const [language, setLanguage] = useState('en')
  const answers = Object.values(draw.winner?.answers ?? {})

  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-4 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-medium">
          {draw.winner?.contact?.name || t('unknownContact')} · {draw.winner?.contact?.phone ?? ''}
        </h3>
        <span className="text-xs text-muted-foreground">{new Date(draw.drawn_at).toLocaleString()}</span>
      </div>
      {answers.length > 0 && (
        <ul className="space-y-1 text-muted-foreground">
          {answers.map((a) => (
            <li key={a.label}>
              <span className="text-foreground">{a.label}:</span> {a.value}
            </li>
          ))}
        </ul>
      )}
      <dl className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
        <div>{t('poolSize', { count: draw.pool_size })}</div>
        <div>{t('index', { index: draw.random_index + 1, count: draw.pool_size })}</div>
        <div className="break-all sm:col-span-2">{t('hash')}: {draw.pool_hash}</div>
        {draw.note ? <div className="sm:col-span-2">{draw.note}</div> : null}
      </dl>

      {draw.notified_at ? (
        <p className="text-xs text-emerald-400">
          {t('notifiedAt', { date: new Date(draw.notified_at).toLocaleString(), template: draw.notification_template ?? '' })}
        </p>
      ) : canNotify ? (
        <div className="space-y-2 border-t border-border pt-3">
          <p className="text-xs text-muted-foreground">{t('notifyHint')}</p>
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <Label htmlFor={`tpl-${draw.id}`}>{t('template')}</Label>
              <Input id={`tpl-${draw.id}`} value={template} onChange={(e) => setTemplate(e.target.value)} />
            </div>
            <div className="w-24">
              <Label htmlFor={`lang-${draw.id}`}>{t('language')}</Label>
              <Input id={`lang-${draw.id}`} value={language} onChange={(e) => setLanguage(e.target.value)} />
            </div>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void onNotify(draw.id, template, language)}>
              {t('notify')}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  )
}
