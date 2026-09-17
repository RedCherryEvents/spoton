import type { CampaignAnswerMap, CampaignFieldDefinition } from '@/types'

export function parseAnswers(raw: unknown): CampaignAnswerMap {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: CampaignAnswerMap = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const row = value as Record<string, unknown>
      out[key] = {
        label: typeof row.label === 'string' ? row.label : key,
        value: row.value == null ? null : String(row.value),
      }
      continue
    }
    if (typeof value === 'string' || typeof value === 'number') {
      out[key] = { label: key, value: String(value) }
    }
  }
  return out
}

export function upsertAnswer(
  answers: CampaignAnswerMap,
  field: Pick<CampaignFieldDefinition, 'key' | 'label'>,
  value: string,
): CampaignAnswerMap {
  return {
    ...answers,
    [field.key]: { label: field.label, value },
  }
}

export function answerValue(answers: CampaignAnswerMap, key: string): string {
  const row = answers[key]
  if (!row || row.value == null || row.value === '') return ''
  return row.value
}

export function answersMatchSearch(answers: CampaignAnswerMap, needle: string): boolean {
  const q = needle.trim().toLowerCase()
  if (!q) return true
  return Object.values(answers).some((row) => {
    const label = row.label?.toLowerCase() ?? ''
    const value = (row.value ?? '').toLowerCase()
    return label.includes(q) || value.includes(q)
  })
}

/** Ordered answer rows for drawers / exports — campaign fields first, then leftovers. */
export function orderedAnswers(
  fields: CampaignFieldDefinition[],
  answers: CampaignAnswerMap,
): Array<{ key: string; label: string; value: string }> {
  const seen = new Set<string>()
  const rows: Array<{ key: string; label: string; value: string }> = []
  for (const field of [...fields].sort((a, b) => a.position - b.position)) {
    seen.add(field.key)
    rows.push({
      key: field.key,
      label: field.label,
      value: answerValue(answers, field.key),
    })
  }
  for (const [key, row] of Object.entries(answers)) {
    if (seen.has(key)) continue
    rows.push({ key, label: row.label || key, value: row.value ?? '' })
  }
  return rows
}
