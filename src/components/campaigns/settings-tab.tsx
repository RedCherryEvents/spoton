'use client'

import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import type { Campaign, CampaignDuplicateRule, CampaignFieldDefinition } from '@/types'
import { parseDuplicateRule } from '@/lib/campaigns/duplicate'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function CampaignSettingsTab({
  campaign,
  fields,
  onCampaignChange,
  onFieldsChange,
  saving,
  onSave,
}: {
  campaign: Campaign
  fields: CampaignFieldDefinition[]
  onCampaignChange: (c: Campaign) => void
  onFieldsChange: (fields: CampaignFieldDefinition[]) => void
  saving: boolean
  onSave: (patch: Record<string, unknown>) => Promise<void>
}) {
  const t = useTranslations('Campaigns')
  const [fieldKey, setFieldKey] = useState('')
  const [fieldLabel, setFieldLabel] = useState('')
  const rule = parseDuplicateRule(campaign.settings?.duplicate_rule)

  async function addField() {
    const res = await fetch(`/api/campaigns/${campaign.id}/fields`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: fieldKey, label: fieldLabel, field_type: 'text' }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      toast.error(body.error || t('detail.fieldError'))
      return
    }
    setFieldKey('')
    setFieldLabel('')
    onFieldsChange([...fields, body.field])
  }

  async function deleteField(fieldId: string) {
    const res = await fetch(`/api/campaigns/${campaign.id}/fields/${fieldId}`, { method: 'DELETE' })
    if (!res.ok) {
      toast.error(t('detail.fieldError'))
      return
    }
    onFieldsChange(fields.filter((f) => f.id !== fieldId))
  }

  return (
    <div className="space-y-6">
      <section className="space-y-3 rounded-xl border border-border bg-card p-4">
        <h2 className="text-sm font-medium">{t('detail.details')}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>{t('detail.name')}</Label>
            <Input
              defaultValue={campaign.name}
              onBlur={(e) => {
                if (e.target.value !== campaign.name) void onSave({ name: e.target.value })
              }}
            />
          </div>
          <div>
            <Label>{t('detail.keyword')}</Label>
            <Input
              defaultValue={campaign.keyword ?? ''}
              onBlur={(e) => void onSave({ keyword: e.target.value || null })}
            />
          </div>
        </div>
      </section>

      <section className="space-y-3 rounded-xl border border-border bg-card p-4">
        <h2 className="text-sm font-medium">{t('settings.period')}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>{t('settings.starts')}</Label>
            <Input
              type="date"
              defaultValue={campaign.starts_at?.slice(0, 10) ?? ''}
              onBlur={(e) => void onSave({ starts_at: e.target.value ? `${e.target.value}T00:00:00.000Z` : null })}
            />
          </div>
          <div>
            <Label>{t('settings.ends')}</Label>
            <Input
              type="date"
              defaultValue={campaign.ends_at?.slice(0, 10) ?? ''}
              onBlur={(e) => void onSave({ ends_at: e.target.value ? `${e.target.value}T23:59:59.000Z` : null })}
            />
          </div>
        </div>
      </section>

      <section className="space-y-3 rounded-xl border border-border bg-card p-4">
        <h2 className="text-sm font-medium">{t('settings.duplicate')}</h2>
        <p className="text-xs text-muted-foreground">{t('settings.duplicateHint')}</p>
        <select
          className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
          value={rule}
          disabled={saving}
          onChange={(e) => {
            const duplicate_rule = e.target.value as CampaignDuplicateRule
            onCampaignChange({
              ...campaign,
              settings: { ...campaign.settings, duplicate_rule },
            })
            void onSave({ settings: { duplicate_rule } })
          }}
        >
          <option value="whatsapp">{t('settings.ruleWhatsapp')}</option>
          <option value="email">{t('settings.ruleEmail')}</option>
          <option value="whatsapp_per_day">{t('settings.ruleWhatsappDay')}</option>
          <option value="unlimited">{t('settings.ruleUnlimited')}</option>
        </select>
      </section>

      <section className="space-y-3 rounded-xl border border-border bg-card p-4">
        <h2 className="text-sm font-medium">{t('settings.branding')}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>{t('settings.clientName')}</Label>
            <Input
              defaultValue={campaign.settings?.client_name ?? ''}
              onBlur={(e) => void onSave({ settings: { client_name: e.target.value } })}
            />
          </div>
          <div>
            <Label>{t('settings.brandColor')}</Label>
            <Input
              defaultValue={campaign.settings?.brand_color ?? ''}
              placeholder="#C8102E"
              onBlur={(e) => void onSave({ settings: { brand_color: e.target.value } })}
            />
          </div>
          <div className="sm:col-span-2">
            <Label>{t('settings.logoUrl')}</Label>
            <Input
              defaultValue={campaign.settings?.logo_url ?? ''}
              onBlur={(e) => void onSave({ settings: { logo_url: e.target.value } })}
            />
          </div>
        </div>
      </section>

      <section className="space-y-3 rounded-xl border border-border bg-card p-4">
        <h2 className="text-sm font-medium">{t('detail.fieldsTitle')}</h2>
        {fields.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('detail.fieldsEmpty')}</p>
        ) : (
          <ul className="space-y-2">
            {fields.map((f) => (
              <li key={f.id} className="flex items-center justify-between text-sm">
                <span>
                  {f.label} <span className="font-mono text-xs text-muted-foreground">{f.key}</span>
                </span>
                <Button variant="ghost" size="icon" onClick={() => void deleteField(f.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2">
          <Input placeholder={t('detail.fieldKey')} value={fieldKey} onChange={(e) => setFieldKey(e.target.value)} />
          <Input placeholder={t('detail.fieldLabel')} value={fieldLabel} onChange={(e) => setFieldLabel(e.target.value)} />
          <Button size="sm" onClick={() => void addField()} disabled={!fieldKey.trim() || !fieldLabel.trim()}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </section>
    </div>
  )
}
