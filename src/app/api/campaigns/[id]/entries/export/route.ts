import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { canExportCampaigns } from '@/lib/auth/roles'
import { ForbiddenError } from '@/lib/auth/account'
import { asJsonError, loadCampaignFields, loadOwnedCampaign } from '@/lib/campaigns/access'
import {
  DEFAULT_PAGE_SIZE,
  MAX_EXPORT_ROWS,
  parseEntryFilters,
  queryCampaignEntries,
} from '@/lib/campaigns/query'
import {
  buildReportModel,
  exportColumns,
  filenameFor,
  filterSummary,
  toCsv,
  toExcelXml,
  toExportRow,
} from '@/lib/campaigns/export'
import { renderReportHtml } from '@/lib/campaigns/report-html'
import { loadCampaignStats } from '@/lib/campaigns/stats'
import { parsePermissions } from '@/lib/campaigns/share'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole('admin')
    if (!canExportCampaigns(ctx.role)) throw new ForbiddenError('Insufficient role')
    const { id } = await params
    const campaign = await loadOwnedCampaign(ctx, id)
    const fields = await loadCampaignFields(ctx, campaign.id)

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    const format = body?.format === 'xlsx' || body?.format === 'xls'
      ? 'xls'
      : body?.format === 'pdf'
        ? 'pdf'
        : 'csv'
    const scope = body?.scope === 'page' ? 'page' : 'all'
    const url = new URL(request.url)
    const filterSource =
      body?.filters && typeof body.filters === 'object'
        ? (body.filters as Record<string, unknown>)
        : body ?? {}
    for (const key of ['q', 'status', 'from', 'to', 'reference', 'name', 'phone', 'email', 'tags', 'sort', 'order', 'page', 'pageSize']) {
      const value = filterSource[key]
      if (typeof value === 'string' && value) url.searchParams.set(key, value)
      if (typeof value === 'number') url.searchParams.set(key, String(value))
    }
    if (filterSource.fieldFilters && typeof filterSource.fieldFilters === 'object') {
      for (const [key, value] of Object.entries(filterSource.fieldFilters as Record<string, unknown>)) {
        if (typeof value === 'string' && value) url.searchParams.set(`field.${key}`, value)
      }
    }
    const filters = parseEntryFilters(url)
    const limit = scope === 'page' ? (filters.pageSize ?? DEFAULT_PAGE_SIZE) : MAX_EXPORT_ROWS
    const offset = scope === 'page'
      ? Math.max(0, ((filters.page ?? 1) - 1) * (filters.pageSize ?? DEFAULT_PAGE_SIZE))
      : 0

    const { entries, total } = await queryCampaignEntries({
      ctx,
      campaignId: campaign.id,
      fields,
      filters,
      limit,
      offset,
    })

    const columns = exportColumns(fields, { includeAgent: true })
    const rows = entries.map((entry) => toExportRow(entry, campaign, fields))
    const name = filenameFor(campaign, format === 'pdf' ? 'pdf' : format === 'xls' ? 'xls' : 'csv')

    if (format === 'csv') {
      return new NextResponse(toCsv(columns, rows), {
        headers: {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': `attachment; filename="${name}"`,
          'x-export-count': String(rows.length),
          'x-export-total': String(total),
        },
      })
    }

    if (format === 'xls') {
      return new NextResponse(toExcelXml(columns, rows, campaign.code || 'Entries'), {
        headers: {
          'content-type': 'application/vnd.ms-excel; charset=utf-8',
          'content-disposition': `attachment; filename="${name}"`,
          'x-export-count': String(rows.length),
          'x-export-total': String(total),
        },
      })
    }

    const permissions = parsePermissions(body?.sections)
    const stats = await loadCampaignStats({ ctx, campaignId: campaign.id, fields })
    const model = buildReportModel({
      campaign,
      stats,
      columns,
      rows,
      filters: filterSummary({ ...filters, fields }),
      accountName: ctx.account.name,
      includeAgent: false,
    })
    const html = renderReportHtml(model, permissions)
    return new NextResponse(html, {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'content-disposition': `inline; filename="${filenameFor(campaign, 'pdf').replace(/pdf$/, 'html')}"`,
      },
    })
  } catch (err) {
    return asJsonError(err) ?? toErrorResponse(err)
  }
}
