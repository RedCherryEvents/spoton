'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import type { Campaign } from '@/types'
import type { EntryFilters } from '@/lib/campaigns/query'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Checkbox } from '@/components/ui/checkbox'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Label } from '@/components/ui/label'

export function ExportModal({
  open,
  onOpenChange,
  campaign,
  total,
  filterLines,
  filters,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  campaign: Campaign
  total: number
  filterLines: string[]
  filters: EntryFilters
}) {
  const t = useTranslations('Campaigns.export')
  const [scope, setScope] = useState<'all' | 'page'>('all')
  const [format, setFormat] = useState<'csv' | 'xlsx' | 'pdf'>('csv')
  const [sections, setSections] = useState({
    summary: true,
    statistics: true,
    answer_breakdown: true,
    entry_details: true,
  })
  const [saving, setSaving] = useState(false)

  async function exportNow() {
    setSaving(true)
    try {
      const res = await fetch(`/api/campaigns/${campaign.id}/entries/export`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          format,
          scope,
          sections,
          filters: {
            q: filters.search,
            status: filters.status,
            from: filters.dateFrom,
            to: filters.dateTo,
            reference: filters.entryReference,
            name: filters.name,
            phone: filters.phone,
            email: filters.email,
            sort: filters.sort,
            page: filters.page,
            pageSize: filters.pageSize,
            fieldFilters: filters.fieldFilters,
          },
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        toast.error(body.error || t('error'))
        return
      }
      const blob = await res.blob()
      if (format === 'pdf') {
        const url = URL.createObjectURL(blob)
        window.open(url, '_blank', 'noopener,noreferrer')
        onOpenChange(false)
        return
      }
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      const ext = format === 'xlsx' ? 'xls' : 'csv'
      a.href = url
      a.download = `${campaign.code}-entries.${ext}`
      a.click()
      URL.revokeObjectURL(url)
      onOpenChange(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <p className="text-xs text-muted-foreground">{t('campaign')}</p>
            <p className="text-sm font-medium">{campaign.name}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t('records')}</p>
            <p className="text-sm font-medium tabular-nums">{total.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t('filter')}</p>
            <p className="text-sm">{filterLines.length ? filterLines.join(' · ') : t('noFilter')}</p>
          </div>
          <div>
            <p className="mb-2 text-xs text-muted-foreground">{t('scope')}</p>
            <RadioGroup value={scope} onValueChange={(v) => setScope(v as 'all' | 'page')}>
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="all" />
                {t('all')}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="page" />
                {t('page')}
              </label>
            </RadioGroup>
          </div>
          <div className="flex gap-2">
            {(['csv', 'xlsx', 'pdf'] as const).map((f) => (
              <Button key={f} type="button" size="sm" variant={format === f ? 'default' : 'outline'} onClick={() => setFormat(f)}>
                {t(f === 'xlsx' ? 'excel' : f)}
              </Button>
            ))}
          </div>
          {format === 'pdf' && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">{t('sections')}</p>
              {(
                [
                  ['summary', 'summary'],
                  ['statistics', 'statistics'],
                  ['answer_breakdown', 'breakdown'],
                  ['entry_details', 'details'],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={sections[key]}
                    onCheckedChange={(v) =>
                      setSections((s) => ({ ...s, [key]: Boolean(v) }))
                    }
                  />
                  {t(label)}
                </label>
              ))}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button onClick={() => void exportNow()} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {t('submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
