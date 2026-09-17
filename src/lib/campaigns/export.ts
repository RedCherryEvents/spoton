import type { Campaign, CampaignFieldDefinition } from '@/types'
import { orderedAnswers } from './answers'
import type { HydratedCampaignEntry } from './query'
import type { CampaignStats } from './stats'

export interface ExportColumn {
  key: string
  label: string
}

export interface ExportRow {
  values: Record<string, string>
}

const BASE_COLUMNS: ExportColumn[] = [
  { key: 'entry_number', label: 'Entry #' },
  { key: 'entry_reference', label: 'Entry Reference' },
  { key: 'created_at', label: 'Created At' },
  { key: 'completed_at', label: 'Completed At' },
  { key: 'name', label: 'Full Name' },
  { key: 'phone', label: 'WhatsApp' },
  { key: 'email', label: 'Email' },
]

const TRAILING_COLUMNS: ExportColumn[] = [
  { key: 'status', label: 'Status' },
  { key: 'campaign', label: 'Campaign' },
]

const INTERNAL_COLUMNS: ExportColumn[] = [
  { key: 'assigned_agent', label: 'Assigned Agent' },
]

export function exportColumns(
  fields: CampaignFieldDefinition[],
  opts?: { includeAgent?: boolean },
): ExportColumn[] {
  const dynamic = [...fields]
    .sort((a, b) => a.position - b.position)
    .map((f) => ({ key: `field:${f.key}`, label: f.label }))
  return [
    ...BASE_COLUMNS,
    ...dynamic,
    ...TRAILING_COLUMNS,
    ...(opts?.includeAgent === false ? [] : INTERNAL_COLUMNS),
  ]
}

export function toExportRow(
  entry: HydratedCampaignEntry,
  campaign: Campaign,
  fields: CampaignFieldDefinition[],
): ExportRow {
  const values: Record<string, string> = {
    entry_number: entry.entry_number != null ? String(entry.entry_number) : '',
    entry_reference: entry.entry_reference ?? '',
    created_at: entry.created_at,
    completed_at: entry.completed_at ?? '',
    name: entry.contact?.name ?? '',
    phone: entry.contact?.phone ?? '',
    email: entry.contact?.email ?? '',
    status: entry.status,
    campaign: campaign.name,
    assigned_agent: entry.assigned_agent?.full_name ?? '',
  }
  for (const field of fields) {
    values[`field:${field.key}`] = entry.answers?.[field.key]?.value ?? ''
  }
  for (const extra of orderedAnswers(fields, entry.answers ?? {})) {
    if (fields.some((f) => f.key === extra.key)) continue
    values[`field:${extra.key}`] = extra.value
  }
  return { values }
}

export function toCsv(columns: ExportColumn[], rows: ExportRow[]): string {
  const header = columns.map((c) => csvCell(c.label)).join(',')
  const body = rows.map((row) => columns.map((c) => csvCell(row.values[c.key] ?? '')).join(','))
  return `\uFEFF${[header, ...body].join('\n')}`
}

function csvCell(value: string): string {
  const text = value.replace(/\r\n/g, '\n')
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

/** Excel-readable SpreadsheetML 2003 XML (opens in Excel / Sheets / Numbers). */
export function toExcelXml(
  columns: ExportColumn[],
  rows: ExportRow[],
  sheetName: string,
): string {
  const safeSheet = xml(sheetName.slice(0, 31) || 'Entries')
  const header = columns
    .map((c) => `<Cell><Data ss:Type="String">${xml(c.label)}</Data></Cell>`)
    .join('')
  const body = rows
    .map((row) => {
      const cells = columns
        .map((c) => `<Cell><Data ss:Type="String">${xml(row.values[c.key] ?? '')}</Data></Cell>`)
        .join('')
      return `<Row>${cells}</Row>`
    })
    .join('')
  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Worksheet ss:Name="${safeSheet}">
<Table>
<Row>${header}</Row>
${body}
</Table>
</Worksheet>
</Workbook>`
}

export function filenameFor(
  campaign: Campaign,
  format: 'csv' | 'xls' | 'pdf',
  now = new Date(),
): string {
  const slug = campaign.code.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 40)
  const day = now.toISOString().slice(0, 10)
  return `${slug}-entries-${day}.${format}`
}

export function filterSummary(input: {
  status?: string
  dateFrom?: string
  dateTo?: string
  search?: string
  fieldFilters?: Record<string, string>
  fields?: CampaignFieldDefinition[]
}): string[] {
  const lines: string[] = []
  if (input.status) lines.push(`Status: ${input.status}`)
  if (input.dateFrom || input.dateTo) {
    lines.push(`Date: ${input.dateFrom || '…'} – ${input.dateTo || '…'}`)
  }
  if (input.search) lines.push(`Search: ${input.search}`)
  if (input.fieldFilters) {
    for (const [key, value] of Object.entries(input.fieldFilters)) {
      const label = input.fields?.find((f) => f.key === key)?.label ?? key
      lines.push(`${label}: ${value}`)
    }
  }
  return lines
}

export function xml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function safeBrandColor(value: string | null | undefined): string {
  return /^#[0-9A-Fa-f]{3,8}$/.test(value ?? '') ? value! : '#C8102E'
}

export function safeLogoUrl(value: string | null | undefined): string | null {
  if (!value) return null
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
    return parsed.toString()
  } catch {
    return null
  }
}

export function buildReportModel(args: {
  campaign: Campaign
  stats: CampaignStats
  columns: ExportColumn[]
  rows: ExportRow[]
  filters: string[]
  accountName: string
  includeAgent?: boolean
}): ReportModel {
  return {
    brand: 'SPOT ON',
    accountName: args.accountName,
    campaignName: args.campaign.name,
    clientName: args.campaign.settings?.client_name || args.accountName,
    brandColor: safeBrandColor(args.campaign.settings?.brand_color),
    logoUrl: safeLogoUrl(args.campaign.settings?.logo_url),
    period: formatPeriod(args.campaign.starts_at, args.campaign.ends_at),
    filters: args.filters,
    stats: args.stats,
    columns: args.includeAgent === false
      ? args.columns.filter((c) => c.key !== 'assigned_agent')
      : args.columns,
    rows: args.rows,
  }
}

export interface ReportModel {
  brand: string
  accountName: string
  campaignName: string
  clientName: string
  brandColor: string
  logoUrl: string | null
  period: string
  filters: string[]
  stats: CampaignStats
  columns: ExportColumn[]
  rows: ExportRow[]
}

function formatPeriod(start?: string | null, end?: string | null): string {
  if (!start && !end) return 'All time'
  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    })
  if (start && end) return `${fmt(start)} – ${fmt(end)}`
  if (start) return `From ${fmt(start)}`
  return `Until ${fmt(end!)}`
}
