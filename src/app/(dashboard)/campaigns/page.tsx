'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Megaphone, Plus, Loader2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import type { Campaign } from '@/types'
import { Button } from '@/components/ui/button'
import { GatedButton } from '@/components/ui/gated-button'
import { useCan } from '@/hooks/use-can'
import { Badge } from '@/components/ui/badge'
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

export default function CampaignsPage() {
  const router = useRouter()
  const t = useTranslations('Campaigns.list')
  const canCreate = useCan('send-messages')
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [keyword, setKeyword] = useState('')
  const [description, setDescription] = useState('')

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
  }, [])

  async function create() {
    setSaving(true)
    const res = await fetch('/api/campaigns', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, code, keyword, description }),
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

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
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
        <div className="divide-y divide-border rounded-lg border border-border bg-card">
          {campaigns.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => router.push(`/campaigns/${c.id}`)}
              className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-muted/50"
            >
              <div>
                <div className="font-medium text-foreground">{c.name}</div>
                <div className="text-xs text-muted-foreground">
                  {c.code}
                  {c.keyword ? ` · ${c.keyword}` : ''}
                </div>
              </div>
              <Badge variant="outline">{t(`status.${c.status}`)}</Badge>
            </button>
          ))}
        </div>
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
            <div>
              <Label>{t('code')}</Label>
              <Input value={code} onChange={(e) => setCode(e.target.value)} />
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
