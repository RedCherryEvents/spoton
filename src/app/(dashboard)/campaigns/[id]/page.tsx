'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import type { Campaign, CampaignFieldDefinition } from '@/types'
import type { CampaignStats } from '@/lib/campaigns/stats'
import type { EntryFilters, HydratedCampaignEntry } from '@/lib/campaigns/query'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { CampaignOverviewTab } from '@/components/campaigns/overview-tab'
import { CampaignEntriesTab } from '@/components/campaigns/entries-tab'
import { CampaignSettingsTab } from '@/components/campaigns/settings-tab'
import { CampaignAutomationTab } from '@/components/campaigns/automation-tab'

export default function CampaignDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const t = useTranslations('Campaigns.detail')
  const [campaign, setCampaign] = useState<Campaign | null>(null)
  const [fields, setFields] = useState<CampaignFieldDefinition[]>([])
  const [stats, setStats] = useState<CampaignStats | null>(null)
  const [entries, setEntries] = useState<HydratedCampaignEntry[]>([])
  const [total, setTotal] = useState(0)
  const [filters, setFilters] = useState<EntryFilters>({ sort: 'newest', page: 1, pageSize: 50 })
  const [loading, setLoading] = useState(true)
  const [entriesLoading, setEntriesLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  const loadCore = useCallback(async () => {
    setLoading(true)
    const [cRes, fRes, sRes] = await Promise.all([
      fetch(`/api/campaigns/${params.id}`),
      fetch(`/api/campaigns/${params.id}/fields`),
      fetch(`/api/campaigns/${params.id}/stats`),
    ])
    const cBody = await cRes.json().catch(() => ({}))
    if (!cRes.ok) {
      toast.error(cBody.error || t('loadError'))
      setLoading(false)
      return
    }
    setCampaign(cBody.campaign)
    setFields((await fRes.json()).fields ?? [])
    const sBody = await sRes.json().catch(() => ({}))
    setStats(sBody.stats ?? null)
    setLoading(false)
  }, [params.id, t])

  const loadEntries = useCallback(async () => {
    setEntriesLoading(true)
    const qs = new URLSearchParams()
    if (filters.search) qs.set('q', filters.search)
    if (filters.status) qs.set('status', filters.status)
    if (filters.dateFrom) qs.set('from', filters.dateFrom)
    if (filters.dateTo) qs.set('to', filters.dateTo)
    if (filters.entryReference) qs.set('reference', filters.entryReference)
    if (filters.name) qs.set('name', filters.name)
    if (filters.phone) qs.set('phone', filters.phone)
    if (filters.email) qs.set('email', filters.email)
    if (filters.sort) qs.set('sort', filters.sort)
    if (filters.page) qs.set('page', String(filters.page))
    if (filters.pageSize) qs.set('pageSize', String(filters.pageSize))
    for (const [key, value] of Object.entries(filters.fieldFilters ?? {})) {
      qs.set(`field.${key}`, value)
    }
    const res = await fetch(`/api/campaigns/${params.id}/entries?${qs.toString()}`)
    const body = await res.json().catch(() => ({}))
    setEntries(body.entries ?? [])
    setTotal(body.total ?? 0)
    if (body.fields) setFields(body.fields)
    setEntriesLoading(false)
  }, [filters, params.id])

  useEffect(() => {
    void loadCore()
  }, [loadCore])

  useEffect(() => {
    const handle = window.setTimeout(() => void loadEntries(), 250)
    return () => window.clearTimeout(handle)
  }, [loadEntries])

  async function savePatch(patch: Record<string, unknown>) {
    if (!campaign) return
    setSaving(true)
    const res = await fetch(`/api/campaigns/${campaign.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    })
    const body = await res.json().catch(() => ({}))
    setSaving(false)
    if (!res.ok) {
      toast.error(body.error || t('saveError'))
      return
    }
    setCampaign(body.campaign)
    toast.success(t('saved'))
  }

  if (loading || !campaign) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <button
        type="button"
        onClick={() => router.push('/campaigns')}
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        {t('back')}
      </button>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{campaign.name}</h1>
          <p className="text-sm text-muted-foreground">{campaign.code}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline">{t(`status.${campaign.status}`)}</Badge>
          {campaign.status !== 'active' && (
            <Button size="sm" onClick={() => void savePatch({ status: 'active' })} disabled={saving}>
              {t('activate')}
            </Button>
          )}
          {campaign.status === 'active' && (
            <Button size="sm" variant="outline" onClick={() => void savePatch({ status: 'paused' })} disabled={saving}>
              {t('pause')}
            </Button>
          )}
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="w-full justify-start">
          <TabsTrigger value="overview">{t('tabs.overview')}</TabsTrigger>
          <TabsTrigger value="entries">{t('tabs.entries')}</TabsTrigger>
          <TabsTrigger value="automation">{t('tabs.automation')}</TabsTrigger>
          <TabsTrigger value="settings">{t('tabs.settings')}</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="pt-4">
          <CampaignOverviewTab stats={stats} />
        </TabsContent>
        <TabsContent value="entries" className="pt-4">
          <CampaignEntriesTab
            campaign={campaign}
            fields={fields}
            entries={entries}
            total={total}
            page={filters.page ?? 1}
            pageSize={filters.pageSize ?? 50}
            filters={filters}
            onFiltersChange={setFilters}
            loading={entriesLoading}
          />
        </TabsContent>
        <TabsContent value="automation" className="pt-4">
          <CampaignAutomationTab campaignId={campaign.id} />
        </TabsContent>
        <TabsContent value="settings" className="pt-4">
          <CampaignSettingsTab
            campaign={campaign}
            fields={fields}
            onCampaignChange={setCampaign}
            onFieldsChange={setFields}
            saving={saving}
            onSave={savePatch}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
