/**
 * Match a time_based trigger schedule against "now".
 *
 * Accepts either `HH:mm` (fires once in that minute) or a 5-field cron
 * (`m h dom month dow`). Only `*` and a single integer are supported per
 * field — enough for "every weekday at 9" without pulling in a parser.
 */

export interface ZonedParts {
  minute: number
  hour: number
  day: number
  month: number
  weekday: number
}

export function zonedParts(now: Date, timezone?: string): ZonedParts {
  if (!timezone) {
    return {
      minute: now.getMinutes(),
      hour: now.getHours(),
      day: now.getDate(),
      month: now.getMonth() + 1,
      weekday: now.getDay(),
    }
  }
  try {
    const fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
    })
    const bag: Record<string, string> = {}
    for (const part of fmt.formatToParts(now)) {
      if (part.type !== 'literal') bag[part.type] = part.value
    }
    const weekdayMap: Record<string, number> = {
      Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
    }
    return {
      minute: Number(bag.minute),
      hour: Number(bag.hour),
      day: Number(bag.day),
      month: Number(bag.month),
      weekday: weekdayMap[bag.weekday] ?? now.getDay(),
    }
  } catch {
    return zonedParts(now)
  }
}

function cronField(field: string, value: number): boolean {
  const f = field.trim()
  if (f === '*') return true
  const n = Number(f)
  return Number.isFinite(n) && n === value
}

export function scheduleMatchesNow(
  schedule: string,
  timezone?: string,
  now: Date = new Date(),
): boolean {
  const trimmed = schedule.trim()
  if (!trimmed) return false
  const z = zonedParts(now, timezone)

  const hm = /^(\d{1,2}):(\d{2})$/.exec(trimmed)
  if (hm) {
    return Number(hm[1]) === z.hour && Number(hm[2]) === z.minute
  }

  const parts = trimmed.split(/\s+/)
  if (parts.length === 5) {
    return (
      cronField(parts[0], z.minute) &&
      cronField(parts[1], z.hour) &&
      cronField(parts[2], z.day) &&
      cronField(parts[3], z.month) &&
      cronField(parts[4], z.weekday)
    )
  }
  return false
}

/** Minute-bucket used to skip duplicate fires in the same local minute. */
export function minuteKey(iso: string | null | undefined, timezone?: string): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const z = zonedParts(d, timezone)
  return `${z.day}-${z.month}-${z.hour}:${String(z.minute).padStart(2, '0')}`
}
