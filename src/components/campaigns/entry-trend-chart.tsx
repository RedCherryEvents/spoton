'use client'

export function EntryTrendChart({
  points,
}: {
  points: Array<{ day: string; count: number }>
}) {
  const w = 760
  const h = 180
  const pad = { top: 12, right: 12, bottom: 28, left: 36 }
  const max = Math.max(...points.map((p) => p.count), 1)
  const chartW = w - pad.left - pad.right
  const chartH = h - pad.top - pad.bottom
  const step = points.length > 1 ? chartW / (points.length - 1) : 0
  const xFor = (i: number) => pad.left + i * step
  const yFor = (v: number) => pad.top + chartH - (v / max) * chartH
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${xFor(i)},${yFor(p.count)}`).join(' ')
  const stride = Math.max(1, Math.ceil(points.length / 7))

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-[180px] w-full" role="img" aria-label="Entries over time">
      {points.map((p, i) =>
        i % stride === 0 ? (
          <text
            key={p.day}
            x={xFor(i)}
            y={h - 8}
            textAnchor="middle"
            className="fill-muted-foreground text-[10px]"
          >
            {shortDay(p.day)}
          </text>
        ) : null,
      )}
      <path d={d} fill="none" stroke="var(--primary)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function shortDay(key: string): string {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short' })
}
