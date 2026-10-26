'use client'

import { useEffect, useState } from 'react'
import { Copy, Download, ExternalLink } from 'lucide-react'
import { useTranslations } from 'next-intl'
import QRCode from 'qrcode'
import { toast } from 'sonner'
import type { Campaign } from '@/types'
import { buildWhatsAppEntryUrl, campaignEntryKeyword } from '@/lib/campaigns/whatsapp-link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const QR_OPTIONS = { errorCorrectionLevel: 'M', margin: 2 } as const

/** wa.me entry link for the campaign plus a QR code that encodes it. */
export function WhatsAppEntryCard({
  campaign,
  saving,
  onSave,
}: {
  campaign: Campaign
  saving: boolean
  onSave: (patch: Record<string, unknown>) => Promise<void>
}) {
  const t = useTranslations('Campaigns.whatsappEntry')
  const number = campaign.settings?.whatsapp_number ?? ''
  const keyword = campaignEntryKeyword(campaign.keyword)
  const url = buildWhatsAppEntryUrl(number, keyword)
  // Keyed by the url it encodes, so a stale image never shows for a new link.
  const [qr, setQr] = useState<{ url: string; png: string } | null>(null)
  const png = url && qr?.url === url ? qr.png : null

  useEffect(() => {
    if (!url) return
    let cancelled = false
    QRCode.toDataURL(url, { ...QR_OPTIONS, width: 512 })
      .then((data) => {
        if (!cancelled) setQr({ url, png: data })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [url])

  const fileBase = `${campaign.code || 'campaign'}-whatsapp-qr`.replace(/[^\w-]+/g, '-')

  function download(href: string, filename: string) {
    const a = document.createElement('a')
    a.href = href
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  async function downloadSvg() {
    if (!url) return
    const svg = await QRCode.toString(url, { ...QR_OPTIONS, type: 'svg' })
    const href = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
    download(href, `${fileBase}.svg`)
    URL.revokeObjectURL(href)
  }

  async function copyLink() {
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      toast.success(t('copied'))
    } catch {
      toast.error(t('copyError'))
    }
  }

  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-4">
      <div>
        <h2 className="text-sm font-medium">{t('title')}</h2>
        <p className="text-xs text-muted-foreground">{t('hint')}</p>
      </div>

      <div className="max-w-sm">
        <Label htmlFor="campaign-whatsapp-number">{t('number')}</Label>
        <Input
          id="campaign-whatsapp-number"
          inputMode="tel"
          placeholder="+27 79 863 7339"
          defaultValue={number ? `+${number}` : ''}
          disabled={saving}
          onBlur={(e) => {
            const next = e.target.value.trim()
            const current = number ? `+${number}` : ''
            if (next === current) return
            void onSave({ settings: { whatsapp_number: next || null } })
          }}
        />
      </div>

      {!keyword && number && <p className="text-xs text-amber-500">{t('noKeyword')}</p>}

      {url ? (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <div className="shrink-0 rounded-lg bg-white p-2">
            {png ? (
              // eslint-disable-next-line @next/next/no-img-element -- data: URL generated on the client
              <img src={png} alt={t('qrAlt', { url })} width={176} height={176} className="h-44 w-44" />
            ) : (
              <div className="h-44 w-44" />
            )}
          </div>
          <div className="min-w-0 space-y-3">
            <div>
              <Label>{t('link')}</Label>
              <p className="break-all font-mono text-sm">{url}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t('qrEncodes')}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => void copyLink()}>
                <Copy className="h-4 w-4" />
                {t('copy')}
              </Button>
              <Button size="sm" variant="outline" onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}>
                <ExternalLink className="h-4 w-4" />
                {t('open')}
              </Button>
              <Button size="sm" variant="outline" disabled={!png} onClick={() => png && download(png, `${fileBase}.png`)}>
                <Download className="h-4 w-4" />
                {t('downloadPng')}
              </Button>
              <Button size="sm" variant="outline" onClick={() => void downloadSvg()}>
                <Download className="h-4 w-4" />
                {t('downloadSvg')}
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{t('empty')}</p>
      )}
    </section>
  )
}
