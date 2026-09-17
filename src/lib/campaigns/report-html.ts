import type { ReportModel } from './export'
import { xml } from './export'

export function renderReportHtml(
  model: ReportModel,
  sections: {
    summary: boolean
    statistics: boolean
    answer_breakdown: boolean
    entry_details: boolean
  },
): string {
  const accent = model.brandColor
  const trend = sparkline(model.stats.trend.map((p) => p.count), accent)
  const totals = model.stats.totals

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>${xml(model.brand)} Campaign Report — ${xml(model.campaignName)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: Inter, ui-sans-serif, system-ui, sans-serif;
    color: #111;
    background: #f6f6f4;
  }
  .page {
    max-width: 920px;
    margin: 0 auto;
    padding: 40px 32px 80px;
    background: #fff;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    border-bottom: 3px solid ${xml(accent)};
    padding-bottom: 20px;
    margin-bottom: 28px;
  }
  .brand { font-size: 13px; letter-spacing: 0.16em; font-weight: 700; color: ${xml(accent)}; }
  h1 { margin: 6px 0 0; font-size: 28px; }
  .muted { color: #666; font-size: 13px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; }
  .stat { border: 1px solid #eee; border-radius: 12px; padding: 14px 16px; }
  .stat .label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #777; }
  .stat .value { font-size: 24px; font-weight: 700; margin-top: 6px; }
  h2 { font-size: 16px; margin: 32px 0 12px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #eee; vertical-align: top; }
  th { font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: #666; }
  .bar { display: flex; align-items: center; gap: 8px; margin: 6px 0; font-size: 13px; }
  .bar .track { flex: 1; height: 8px; background: #f1f1f1; border-radius: 99px; overflow: hidden; }
  .bar .fill { height: 100%; background: ${xml(accent)}; }
  @media print {
    body { background: #fff; }
    .page { padding: 0; max-width: none; }
    .no-print { display: none !important; }
  }
</style>
</head>
<body>
  <div class="page">
    <div class="no-print" style="margin-bottom:16px;font-size:13px;color:#666">
      Use your browser’s Print dialog and choose “Save as PDF”.
    </div>
    <header>
      <div>
        <div class="brand">${xml(model.brand)}</div>
        <h1>Campaign Report</h1>
        <p style="margin:8px 0 0;font-size:18px">${xml(model.campaignName)}</p>
      </div>
      <div style="text-align:right">
        ${model.logoUrl ? `<img src="${xml(model.logoUrl)}" alt="" style="max-height:48px;max-width:160px"/>` : ''}
        <div class="muted" style="margin-top:8px">${xml(model.clientName)}</div>
      </div>
    </header>
    <p class="muted">Campaign period: ${xml(model.period)}</p>
    ${model.filters.length ? `<p class="muted">Filter: ${xml(model.filters.join(' · '))}</p>` : ''}

    ${sections.summary ? `
    <h2>Summary</h2>
    <div class="grid">
      ${statCard('Total Entries', totals.total)}
      ${statCard('Completed', totals.completed)}
      ${statCard('Incomplete', totals.in_progress)}
      ${statCard('Invalid', totals.invalid)}
      ${statCard('Duplicate', totals.duplicate)}
    </div>` : ''}

    ${sections.statistics ? `
    <h2>Entry Trend</h2>
    ${trend}
    <p class="muted">${xml(model.stats.trend[0]?.day ?? '')} – ${xml(model.stats.trend.at(-1)?.day ?? '')}</p>
    ` : ''}

    ${sections.answer_breakdown && model.stats.top_answers.length ? `
    <h2>Top Responses</h2>
    ${model.stats.top_answers.map((field) => {
      const max = Math.max(...field.buckets.map((b) => b.count), 1)
      return `<h3 style="font-size:14px;margin:18px 0 8px">${xml(field.label)}</h3>
        ${field.buckets.map((b) => `
          <div class="bar">
            <div style="width:220px">${xml(b.value)}</div>
            <div class="track"><div class="fill" style="width:${Math.round((b.count / max) * 100)}%"></div></div>
            <div style="width:64px;text-align:right;font-variant-numeric:tabular-nums">${b.count.toLocaleString()}</div>
          </div>`).join('')}`
    }).join('')}` : ''}

    ${sections.entry_details ? `
    <h2>Appendix — Entry Data</h2>
    <table>
      <thead><tr>${model.columns.map((c) => `<th>${xml(c.label)}</th>`).join('')}</tr></thead>
      <tbody>
        ${model.rows.map((row) => `<tr>${model.columns.map((c) => `<td>${xml(row.values[c.key] ?? '')}</td>`).join('')}</tr>`).join('')}
      </tbody>
    </table>` : ''}
  </div>
</body>
</html>`
}

function statCard(label: string, value: number): string {
  return `<div class="stat"><div class="label">${xml(label)}</div><div class="value">${value.toLocaleString()}</div></div>`
}

function sparkline(values: number[], color: string): string {
  const w = 840
  const h = 160
  const max = Math.max(...values, 1)
  const step = values.length > 1 ? w / (values.length - 1) : w
  const pts = values
    .map((v, i) => `${i * step},${h - (v / max) * (h - 16) - 8}`)
    .join(' ')
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="160" role="img" aria-label="Entries over time">
    <polyline fill="none" stroke="${xml(color)}" stroke-width="3" points="${pts}"/>
  </svg>`
}
