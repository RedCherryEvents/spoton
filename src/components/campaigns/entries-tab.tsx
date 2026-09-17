'use client'

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Download, Share2 } from 'lucide-react'
import type { Campaign, CampaignFieldDefinition, CampaignEntry } from '@/types'
import type { HydratedCampaignEntry, EntryFilters } from '@/lib/campaigns/query'
import { Button } from '@/components/ui/button'
import { GatedButton } from '@/components/ui/gated-button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useCan } from '@/hooks/use-can'
import { EntryStatusBadge } from './status-badge'
import { EntryDrawer } from './entry-drawer'
import { ExportModal } from './export-modal'
import { ShareReportModal } from './share-modal'

const STATUSES = ['in_progress', 'completed', 'invalid', 'duplicate', 'disqualified'] as const

export function CampaignEntriesTab({
  campaign,
  fields,
  entries,
  total,
  page,
  pageSize,
  filters,
  onFiltersChange,
  loading,
}: {
  campaign: Campaign
  fields: CampaignFieldDefinition[]
  entries: HydratedCampaignEntry[]
  total: number
  page: number
  pageSize: number
  filters: EntryFilters
  onFiltersChange: (next: EntryFilters) => void
  loading: boolean
}) {
  const t = useTranslations('Campaigns.entries')
  const ts = useTranslations('Campaigns.entryStatus')
  const canExport = useCan('export-campaigns')
  const [selected, setSelected] = useState<CampaignEntry | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [fieldDraft, setFieldDraft] = useState<Record<string, string>>(filters.fieldFilters ?? {})

  const pages = Math.max(1, Math.ceil(total / pageSize))
  const filterLines = useMemo(() => {
    const lines: string[] = []
    if (filters.status) lines.push(`${t('status')}: ${ts(filters.status)}`)
    if (filters.dateFrom || filters.dateTo) {
      lines.push(`${filters.dateFrom || '…'} – ${filters.dateTo || '…'}`)
    }
    if (filters.search) lines.push(filters.search)
    for (const [key, value] of Object.entries(filters.fieldFilters ?? {})) {
      const label = fields.find((f) => f.key === key)?.label ?? key
      lines.push(`${label}: ${value}`)
    }
    return lines
  }, [filters, fields, t, ts])

  function patch(partial: Partial<EntryFilters>) {
    onFiltersChange({ ...filters, page: 1, ...partial })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{t('matching', { count: total })}</p>
        <div className="flex gap-2">
          <GatedButton canAct={canExport} gateReason="share campaign reports" variant="outline" onClick={() => setShareOpen(true)}>
            <Share2 className="h-4 w-4" />
            {t('share')}
          </GatedButton>
          <GatedButton canAct={canExport} gateReason="export campaign entries" onClick={() => setExportOpen(true)}>
            <Download className="h-4 w-4" />
            {t('export')}
          </GatedButton>
        </div>
      </div>

      <div className="grid gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2">
          <Label>{t('search')}</Label>
          <Input
            value={filters.search ?? ''}
            placeholder={t('search')}
            onChange={(e) => patch({ search: e.target.value || undefined })}
          />
        </div>
        <div>
          <Label>{t('status')}</Label>
          <select
            className="mt-1 h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
            value={filters.status ?? ''}
            onChange={(e) => patch({ status: e.target.value || undefined })}
          >
            <option value="">{t('allStatuses')}</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {ts(s)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label>{t('sort')}</Label>
          <select
            className="mt-1 h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
            value={filters.sort ?? 'newest'}
            onChange={(e) => patch({ sort: e.target.value as EntryFilters['sort'] })}
          >
            <option value="newest">{t('sortNewest')}</option>
            <option value="oldest">{t('sortOldest')}</option>
            <option value="entry_reference">{t('sortReference')}</option>
            <option value="name_asc">{t('sortNameAsc')}</option>
            <option value="name_desc">{t('sortNameDesc')}</option>
            <option value="status">{t('sortStatus')}</option>
            <option value="date">{t('sortDate')}</option>
            {fields.map((f) => (
              <option key={f.id} value={`field:${f.key}`}>
                {f.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label>{t('from')}</Label>
          <Input type="date" value={filters.dateFrom ?? ''} onChange={(e) => patch({ dateFrom: e.target.value || undefined })} />
        </div>
        <div>
          <Label>{t('to')}</Label>
          <Input type="date" value={filters.dateTo ?? ''} onChange={(e) => patch({ dateTo: e.target.value || undefined })} />
        </div>
        <div>
          <Label>{t('reference')}</Label>
          <Input value={filters.entryReference ?? ''} onChange={(e) => patch({ entryReference: e.target.value || undefined })} />
        </div>
        <div>
          <Label>{t('name')}</Label>
          <Input value={filters.name ?? ''} onChange={(e) => patch({ name: e.target.value || undefined })} />
        </div>
        <div>
          <Label>{t('phone')}</Label>
          <Input value={filters.phone ?? ''} onChange={(e) => patch({ phone: e.target.value || undefined })} />
        </div>
        <div>
          <Label>{t('email')}</Label>
          <Input value={filters.email ?? ''} onChange={(e) => patch({ email: e.target.value || undefined })} />
        </div>
        {fields.map((f) => (
          <div key={f.id}>
            <Label>{f.label}</Label>
            {f.field_type === 'select' && Array.isArray(f.options) ? (
              <select
                className="mt-1 h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
                value={fieldDraft[f.key] ?? ''}
                onChange={(e) => {
                  const next = { ...fieldDraft, [f.key]: e.target.value }
                  setFieldDraft(next)
                  const fieldFilters = Object.fromEntries(
                    Object.entries(next).filter(([, v]) => v),
                  )
                  patch({ fieldFilters: Object.keys(fieldFilters).length ? fieldFilters : undefined })
                }}
              >
                <option value="">Any</option>
                {f.options.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            ) : (
              <Input
                value={fieldDraft[f.key] ?? ''}
                onBlur={() => {
                  const fieldFilters = Object.fromEntries(
                    Object.entries(fieldDraft).filter(([, v]) => v),
                  )
                  patch({ fieldFilters: Object.keys(fieldFilters).length ? fieldFilters : undefined })
                }}
                onChange={(e) => setFieldDraft((prev) => ({ ...prev, [f.key]: e.target.value }))}
              />
            )}
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('colNumber')}</TableHead>
              <TableHead>{t('colDate')}</TableHead>
              <TableHead>{t('colName')}</TableHead>
              <TableHead>{t('colPhone')}</TableHead>
              <TableHead>{t('colEmail')}</TableHead>
              <TableHead>{t('colStatus')}</TableHead>
              <TableHead>{t('colReference')}</TableHead>
              {fields.map((f) => (
                <TableHead key={f.id}>{f.label}</TableHead>
              ))}
              <TableHead>{t('colAgent')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8 + fields.length} className="py-10 text-center text-muted-foreground">
                  {loading ? '…' : t('empty')}
                </TableCell>
              </TableRow>
            ) : (
              entries.map((entry) => (
                <TableRow
                  key={entry.id}
                  className="cursor-pointer"
                  onClick={() => setSelected(entry)}
                >
                  <TableCell className="tabular-nums">{entry.entry_number ?? '—'}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {formatWhen(entry.created_at)}
                  </TableCell>
                  <TableCell>{entry.contact?.name || '—'}</TableCell>
                  <TableCell>{entry.contact?.phone || '—'}</TableCell>
                  <TableCell>{entry.contact?.email || '—'}</TableCell>
                  <TableCell>
                    <EntryStatusBadge status={entry.status} />
                  </TableCell>
                  <TableCell className="font-mono text-xs">{entry.entry_reference || '—'}</TableCell>
                  {fields.map((f) => (
                    <TableCell key={f.id}>{entry.answers?.[f.key]?.value || '—'}</TableCell>
                  ))}
                  <TableCell>{entry.assigned_agent?.full_name || '—'}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{t('page', { page })}</span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => patch({ page: page - 1 })}>
            {t('prev')}
          </Button>
          <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => patch({ page: page + 1 })}>
            {t('next')}
          </Button>
        </div>
      </div>

      <EntryDrawer
        campaign={campaign}
        campaignId={campaign.id}
        entry={selected}
        fields={fields}
        onClose={() => setSelected(null)}
      />
      <ExportModal
        open={exportOpen}
        onOpenChange={setExportOpen}
        campaign={campaign}
        total={total}
        filterLines={filterLines}
        filters={filters}
      />
      <ShareReportModal
        open={shareOpen}
        onOpenChange={setShareOpen}
        campaignId={campaign.id}
      />
    </div>
  )
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}
