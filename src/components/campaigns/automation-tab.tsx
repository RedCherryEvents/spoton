'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Loader2 } from 'lucide-react'
import type { Automation } from '@/types'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

export function CampaignAutomationTab({ campaignId }: { campaignId: string }) {
  const t = useTranslations('Campaigns.automation')
  const router = useRouter()
  const [rows, setRows] = useState<Automation[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    void fetch('/api/automations')
      .then((res) => res.json())
      .then((body) => {
        const all = (body.automations ?? []) as Automation[]
        const linked = all.filter((a) => JSON.stringify(a).includes(campaignId))
        if (!cancelled) {
          setRows(linked)
          setLoading(false)
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [campaignId])

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">{t('title')}</h2>
        <Button size="sm" onClick={() => router.push('/automations/new')}>
          {t('new')}
        </Button>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-card">
          {rows.map((a) => (
            <li key={a.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <div className="text-sm font-medium">{a.name}</div>
                <div className="text-xs text-muted-foreground">{a.trigger_type}</div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline">{a.is_active ? 'Active' : 'Paused'}</Badge>
                <Button size="sm" variant="outline" onClick={() => router.push(`/automations/${a.id}/edit`)}>
                  {t('open')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
