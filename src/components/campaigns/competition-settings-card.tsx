'use client'

import { useTranslations } from 'next-intl'
import type { Campaign } from '@/types'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

/** Terms link, test numbers and the not-open / duplicate replies. */
export function CompetitionSettingsCard({
  campaign,
  saving,
  onSave,
}: {
  campaign: Campaign
  saving: boolean
  onSave: (patch: Record<string, unknown>) => Promise<void>
}) {
  const t = useTranslations('Campaigns.competition')
  const s = campaign.settings ?? {}

  // Save on blur, only when the value changed; empty clears the setting.
  const saveSetting = (key: string, value: string, current: string) => {
    if (value.trim() === current.trim()) return
    void onSave({ settings: { [key]: value.trim() || null } })
  }

  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-4">
      <div>
        <h2 className="text-sm font-medium">{t('title')}</h2>
        <p className="text-xs text-muted-foreground">{t('hint')}</p>
      </div>

      <div>
        <Label htmlFor="campaign-terms-url">
          {t('termsUrl')}
          {s.terms_required ? <span className="text-red-400"> *</span> : null}
        </Label>
        <Input
          id="campaign-terms-url"
          type="url"
          placeholder="https://"
          defaultValue={s.terms_url ?? ''}
          disabled={saving}
          onBlur={(e) => saveSetting('terms_url', e.target.value, s.terms_url ?? '')}
        />
        {s.terms_required && !s.terms_url ? <p className="mt-1 text-xs text-amber-500">{t('termsRequired')}</p> : null}
      </div>

      <div>
        <Label htmlFor="campaign-test-numbers">{t('testNumbers')}</Label>
        <Textarea
          id="campaign-test-numbers"
          rows={2}
          placeholder="+27 82 123 4567, +27 83 765 4321"
          defaultValue={(s.test_numbers ?? []).map((n) => `+${n}`).join(', ')}
          disabled={saving}
          onBlur={(e) =>
            saveSetting('test_numbers', e.target.value, (s.test_numbers ?? []).map((n) => `+${n}`).join(', '))
          }
        />
        <p className="mt-1 text-xs text-muted-foreground">{t('testNumbersHint')}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="campaign-closed-message">{t('closedMessage')}</Label>
          <Textarea
            id="campaign-closed-message"
            rows={3}
            defaultValue={s.closed_message ?? ''}
            disabled={saving}
            onBlur={(e) => saveSetting('closed_message', e.target.value, s.closed_message ?? '')}
          />
          <p className="mt-1 text-xs text-muted-foreground">{t('closedMessageHint')}</p>
        </div>
        <div>
          <Label htmlFor="campaign-duplicate-message">{t('duplicateMessage')}</Label>
          <Textarea
            id="campaign-duplicate-message"
            rows={3}
            defaultValue={s.duplicate_message ?? ''}
            disabled={saving}
            onBlur={(e) => saveSetting('duplicate_message', e.target.value, s.duplicate_message ?? '')}
          />
          <p className="mt-1 text-xs text-muted-foreground">{t('duplicateMessageHint')}</p>
        </div>
      </div>
    </section>
  )
}
