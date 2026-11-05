'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Megaphone, Plus, Loader2, Search } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import type { Campaign, CampaignType } from '@/types'
import {
  CAMPAIGN_TYPES,
  DISPLAY_STATUS_ORDER,
  campaignDisplayStatus,
  formatCampaignDates,
  type CampaignDisplayStatus,
} from '@/lib/campaigns/display'
import { Button } from '@/components/ui/button'
import { GatedButton } from '@/components/ui/gated-button'
import { useCan } from '@/hooks/use-can'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { CampaignStatusPill } from '@/components/campaigns/campaign-status-pill'
import { cn } from '@/lib/utils'

type CampaignRow = Campaign & { entry_count?: number }
type StatusFilter = 'all' | CampaignDisplayStatus

const FILTERS: StatusFilter[] = ['all', 'live', 'scheduled', 'draft', 'paused', 'ended', 'closed']

export default function CampaignsPage() {
  const router = useRouter()
  const t = useTranslations('Campaigns.list')
  const canCreate = useCan('send-messages')
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [keyword, setKeyword] = useState('')
  const [type, setType] = useState<CampaignType>('competition')
  const [description, setDescription] = useState('')
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  async function load() {
    setLoading(true)
    const res = await fetch('/api/campaigns')
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      setError(body.error || t('loadError'))
      setLoading(false)
      return
    }
    setCampaigns(body.campaigns ?? [])
    setError(null)
    setLoading(false)
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function create() {
    setSaving(true)
    const res = await fetch('/api/campaigns', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, code, keyword, description, type }),
    })
    const body = await res.json().catch(() => ({}))
    setSaving(false)
    if (!res.ok) {
      toast.error(body.error || t('createError'))
      return
    }
    setCreateOpen(false)
    router.push(`/campaigns/${body.campaign.id}`)
  }

  const rows = useMemo(() => {
    const now = Date.now()
    return campaigns
      .map((c) => ({ ...c, display: campaignDisplayStatus(c, now) }))
      .sort(
        (a, b) =>
          DISPLAY_STATUS_ORDER.indexOf(a.display) - DISPLAY_STATUS_ORDER.indexOf(b.display) ||
          (b.entry_count ?? 0) - (a.entry_count ?? 0),
      )
  }, [campaigns])

  const summary = useMemo(
    () => ({
      live: rows.filter((r) => r.display === 'live').length,
      scheduled: rows.filter((r) => r.display === 'scheduled').length,
      draft: rows.filter((r) => r.display === 'draft').length,
      entries: rows.reduce((sum, r) => sum + (r.entry_count ?? 0), 0),
    }),
    [rows],
  )

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows.filter(
      (r) =>
        (statusFilter === 'all' || r.display === statusFilter) &&
        (!q ||
          r.name.toLowerCase().includes(q) ||
          r.code.toLowerCase().includes(q) ||
          (r.keyword ?? '').toLowerCase().includes(q)),
    )
  }, [rows, query, statusFilter])

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="flex items-center gap-3 text-[11px] font-medium uppercase tracking-[0.3em] text-muted-foreground">
            <span className="h-0.5 w-6 rounded bg-primary" />
            {t('eyebrow')}
          </p>
          <h1 className="mt-2 text-2xl font-bold uppercase tracking-tight text-foreground sm:text-3xl">
            {t('headline')} <span className="text-primary">{t('headlineAccent')}</span>
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <GatedButton canAct={canCreate} gateReason="create campaigns" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          {t('create')}
        </GatedButton>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4">
          <p className="text-sm text-destructive">{error}</p>
          <Button variant="outline" className="mt-3" onClick={() => void load()}>
            {t('retry')}
          </Button>
        </div>
      ) : campaigns.length === 0 ? (
        <div className="flex flex-col items-center rounded-lg border border-dashed border-border py-16">
          <Megaphone className="h-8 w-8 text-muted-foreground" />
          <h2 className="mt-3 text-sm font-medium">{t('emptyTitle')}</h2>
          <p className="mt-1 max-w-sm text-center text-xs text-muted-foreground">{t('emptyDesc')}</p>
          <Button className="mt-4" onClick={() => setCreateOpen(true)} disabled={!canCreate}>
            {t('create')}
          </Button>
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryTile label={t('summaryLive')} value={summary.live} accent />
            <SummaryTile label={t('summaryScheduled')} value={summary.scheduled} />
            <SummaryTile label={t('summaryDrafts')} value={summary.draft} />
            <SummaryTile label={t('summaryEntries')} value={summary.entries} />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('search')}
                className="pl-8"
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {FILTERS.map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setStatusFilter(f)}
                  className={cn(
                    'rounded-full border px-3 py-1 text-xs font-medium tracking-wide transition-colors',
                    statusFilter === f
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:text-foreground',
                  )}
                >
                  {f === 'all' ? t('filterAll') : t(`displayStatus.${f}`)}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left">
                  {(['colCampaign', 'colType', 'colStatus', 'colEntries', 'colDates'] as const).map((k) => (
                    <th
                      key={k}
                      className={cn(
                        'px-5 py-3.5 text-[11px] font-semibold uppercase tracking-[0.25em] text-amber-500',
                        k === 'colEntries' && 'text-right',
                      )}
                    >
                      {t(k)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visible.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-5 py-10 text-center text-muted-foreground">
                      {t('noMatch')}
                    </td>
                  </tr>
                ) : (
                  visible.map((c) => (
                    <tr
                      key={c.id}
                      onClick={() => router.push(`/campaigns/${c.id}`)}
                      className="cursor-pointer transition-colors hover:bg-muted/40"
                    >
                      <td className="px-5 py-4">
                        <div className="font-semibold text-foreground">{c.name}</div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {c.code}
                          {c.keyword ? ` · ${c.keyword}` : ''}
                        </div>
                      </td>
                      <td className="px-5 py-4 text-muted-foreground">
                        {c.settings?.type ? t(`types.${c.settings.type}`) : '—'}
                      </td>
                      <td className="px-5 py-4">
                        <CampaignStatusPill status={c.display} />
                      </td>
                      <td className="px-5 py-4 text-right tabular-nums">
                        {c.entry_count ? c.entry_count.toLocaleString('en-ZA') : '—'}
                      </td>
                      <td className="px-5 py-4 whitespace-nowrap text-muted-foreground">
                        {formatCampaignDates(c.starts_at, c.ends_at) ?? '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('createTitle')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>{t('name')}</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>{t('code')}</Label>
                <Input value={code} onChange={(e) => setCode(e.target.value)} />
              </div>
              <div>
                <Label>{t('typeLabel')}</Label>
                <select
                  className="mt-1 h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
                  value={type}
                  onChange={(e) => setType(e.target.value as CampaignType)}
                >
                  {CAMPAIGN_TYPES.map((ct) => (
                    <option key={ct} value={ct}>
                      {t(`types.${ct}`)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <Label>{t('keyword')}</Label>
              <Input value={keyword} onChange={(e) => setKeyword(e.target.value)} />
            </div>
            <div>
              <Label>{t('description')}</Label>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              {t('cancel')}
            </Button>
            <Button onClick={() => void create()} disabled={saving || !name.trim() || !code.trim()}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function SummaryTile({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-card px-5 py-4">
      <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-muted-foreground">{label}</p>
      <p className={cn('mt-2 text-3xl font-semibold tabular-nums', accent ? 'text-primary' : 'text-foreground')}>
        {value.toLocaleString('en-ZA')}
      </p>
    </div>
  )
}
