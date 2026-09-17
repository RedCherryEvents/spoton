'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import type { CampaignReportShare } from '@/types'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function ShareReportModal({
  open,
  onOpenChange,
  campaignId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  campaignId: string
}) {
  const t = useTranslations('Campaigns.share')
  const [shares, setShares] = useState<CampaignReportShare[]>([])
  const [days, setDays] = useState(14)
  const [freshUrl, setFreshUrl] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function load() {
    const res = await fetch(`/api/campaigns/${campaignId}/report-shares`)
    const body = await res.json().catch(() => ({}))
    if (res.ok) setShares(body.shares ?? [])
  }

  useEffect(() => {
    if (open) void load()
  }, [open, campaignId])

  async function create() {
    setSaving(true)
    const res = await fetch(`/api/campaigns/${campaignId}/report-shares`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expires_in_days: days }),
    })
    const body = await res.json().catch(() => ({}))
    setSaving(false)
    if (!res.ok) {
      toast.error(body.error || t('error'))
      return
    }
    setFreshUrl(body.url)
    toast.success(t('created'))
    void load()
  }

  async function revoke(id: string) {
    await fetch(`/api/campaigns/${campaignId}/report-shares/${id}`, { method: 'DELETE' })
    void load()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{t('hint')}</p>
        <div>
          <Label>{t('days')}</Label>
          <Input
            type="number"
            min={1}
            max={90}
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          />
        </div>
        {freshUrl && (
          <div className="rounded-md border border-border bg-muted/40 p-3">
            <p className="break-all font-mono text-xs">{freshUrl}</p>
            <Button
              size="sm"
              className="mt-2"
              variant="outline"
              onClick={() => {
                void navigator.clipboard.writeText(freshUrl)
                toast.success(t('copied'))
              }}
            >
              {t('copy')}
            </Button>
          </div>
        )}
        <ul className="max-h-48 space-y-2 overflow-y-auto text-sm">
          {shares.length === 0 ? (
            <li className="text-muted-foreground">{t('empty')}</li>
          ) : (
            shares.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">
                  {s.revoked_at
                    ? t('revoked')
                    : t('expires', { date: new Date(s.expires_at).toLocaleDateString() })}
                </span>
                {!s.revoked_at && (
                  <Button size="sm" variant="ghost" onClick={() => void revoke(s.id)}>
                    {t('revoke')}
                  </Button>
                )}
              </li>
            ))
          )}
        </ul>
        <DialogFooter>
          <Button onClick={() => void create()} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {t('create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
