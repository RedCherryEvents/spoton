'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { FileText, Loader2, Pencil, Plus, Zap } from 'lucide-react'
import type { CampaignAutomationLink, CampaignAutomationSummary } from '@/lib/campaigns/automation-links'
import { triggerMeta, formatRelative } from '@/lib/automations/trigger-meta'
import type { ValidationIssue } from '@/lib/automations/validate'
import { issueToast } from '@/components/automations/issue-toast'
import { useCan } from '@/hooks/use-can'
import { Button } from '@/components/ui/button'
import { GatedButton } from '@/components/ui/gated-button'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

export function CampaignAutomationTab({ campaignId }: { campaignId: string }) {
  const t = useTranslations('Campaigns.automation')
  const tList = useTranslations('Automations.list')
  const tSteps = useTranslations('Automations.builder.steps')
  const tBuilder = useTranslations('Automations.builder')
  const router = useRouter()
  const canEdit = useCan('send-messages')
  const [rows, setRows] = useState<CampaignAutomationSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/campaigns/${campaignId}/automations`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}))
        if (cancelled) return
        if (!res.ok) {
          setError(body.error || t('loadError'))
          setRows([])
          return
        }
        setError(null)
        setRows((body.automations ?? []) as CampaignAutomationSummary[])
      })
      .catch(() => {
        if (cancelled) return
        setError(t('loadError'))
        setRows([])
      })
    return () => {
      cancelled = true
    }
  }, [campaignId, t])

  async function toggleActive(row: CampaignAutomationSummary, next: boolean) {
    setRows((prev) => prev?.map((r) => (r.id === row.id ? { ...r, is_active: next } : r)) ?? prev)
    const res = await fetch(`/api/automations/${row.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ is_active: next }),
    })
    if (!res.ok) {
      setRows((prev) => prev?.map((r) => (r.id === row.id ? { ...r, is_active: !next } : r)) ?? prev)
      const body = await res.json().catch(() => ({}))
      const issue: ValidationIssue | undefined = body?.issues?.[0]
      if (issue?.message) {
        const { title, description } = issueToast(issue, tBuilder)
        toast.error(tList('toasts.cannotActivate', { name: row.name }), {
          description: description ? `${title}: ${description}` : title,
        })
      } else {
        toast.error(body?.error ?? tList('toasts.updateError'))
      }
      return
    }
    toast.success(next ? tList('toasts.activated') : tList('toasts.paused'))
  }

  function linkLabel(link: CampaignAutomationLink): string {
    switch (link.kind) {
      case 'entry_trigger':
        return t('links.entryTrigger')
      case 'entry_trigger_any':
        return t('links.entryTriggerAny')
      case 'scheduled_audience':
        return t('links.scheduledAudience')
      case 'keyword':
        return t('links.keyword', { keyword: link.detail ?? '' })
      case 'step':
        return t('links.step', { step: link.detail ? tSteps(link.detail) : '' })
    }
  }

  if (rows === null) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const activeCount = rows.filter((r) => r.is_active).length

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-medium">{t('title')}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {rows.length === 0 ? t('subtitleEmpty') : t('subtitle', { total: rows.length, active: activeCount })}
          </p>
        </div>
        <GatedButton
          size="sm"
          canAct={canEdit}
          gateReason="create automations"
          onClick={() => router.push(`/automations/new?campaign=${campaignId}`)}
        >
          <Plus className="h-4 w-4" />
          {t('new')}
        </GatedButton>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {rows.length === 0 && !error ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/40 px-6 py-10 text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10">
            <Zap className="h-5 w-5 text-primary" />
          </div>
          <p className="mt-3 text-sm font-medium">{t('emptyTitle')}</p>
          <p className="mt-1 max-w-md text-xs text-muted-foreground">{t('empty')}</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map((a) => {
            const meta = triggerMeta(a.trigger_type)
            return (
              <li key={a.id} className="rounded-xl border border-border bg-card">
                <div className="flex items-center gap-4 p-4">
                  <button
                    type="button"
                    onClick={() => router.push(`/automations/${a.id}/edit`)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold">{a.name}</span>
                      {a.is_active && <span className="h-2 w-2 rounded-full bg-primary" aria-label="active" />}
                    </div>
                    {a.description && (
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">{a.description}</p>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <span
                        className={cn(
                          'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium',
                          meta.pillClass,
                        )}
                      >
                        {meta.label}
                      </span>
                      {a.links.map((link) => (
                        <span
                          key={`${link.kind}:${link.detail ?? ''}`}
                          className={cn(
                            'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px]',
                            link.kind === 'entry_trigger_any'
                              ? 'border-border text-muted-foreground'
                              : 'border-primary/30 bg-primary/10 text-primary',
                          )}
                        >
                          {linkLabel(link)}
                        </span>
                      ))}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span>{t('steps', { count: a.step_count })}</span>
                      <span aria-hidden>·</span>
                      <span className="tabular-nums">
                        {a.execution_count === 1
                          ? tList('runs', { count: a.execution_count })
                          : tList('runsPlural', { count: a.execution_count })}
                      </span>
                      <span aria-hidden>·</span>
                      <span>{tList('lastRun', { time: formatRelative(a.last_executed_at) })}</span>
                    </div>
                  </button>

                  <div className="flex items-center gap-2">
                    <Switch
                      checked={a.is_active}
                      disabled={!canEdit}
                      onCheckedChange={(v) => void toggleActive(a, !!v)}
                      aria-label={a.is_active ? tList('deactivate') : tList('activate')}
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      title={tList('viewLogs')}
                      onClick={() => router.push(`/automations/${a.id}/logs`)}
                    >
                      <FileText className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => router.push(`/automations/${a.id}/edit`)}
                    >
                      <Pencil className="h-4 w-4" />
                      {t('open')}
                    </Button>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
