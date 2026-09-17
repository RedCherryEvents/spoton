import { createHash, randomBytes } from 'node:crypto'
import type { CampaignReportSharePermissions } from '@/types'

export const DEFAULT_REPORT_EXPIRY_DAYS = 14
export const MAX_REPORT_EXPIRY_DAYS = 90

export function generateReportToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url')
  return { token, hash: hashReportToken(token) }
}

export function hashReportToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function reportUrl(token: string, baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '')
  return `${trimmed}/report/${token}`
}

export function reportExpiresAt(
  expiresInDays: number | undefined,
  now: Date = new Date(),
): Date {
  const days = clampExpiryDays(expiresInDays)
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000)
}

export function clampExpiryDays(expiresInDays: number | undefined): number {
  if (
    expiresInDays === undefined ||
    !Number.isFinite(expiresInDays) ||
    expiresInDays <= 0
  ) {
    return DEFAULT_REPORT_EXPIRY_DAYS
  }
  return Math.min(Math.floor(expiresInDays), MAX_REPORT_EXPIRY_DAYS)
}

export function parsePermissions(
  value: unknown,
): CampaignReportSharePermissions {
  const row = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  return {
    summary: row.summary !== false,
    statistics: row.statistics !== false,
    answer_breakdown: row.answer_breakdown !== false,
    entry_details: row.entry_details !== false,
  }
}

export function isShareActive(share: {
  expires_at: string
  revoked_at?: string | null
}, now = new Date()): boolean {
  if (share.revoked_at) return false
  return new Date(share.expires_at).getTime() > now.getTime()
}

export function appOrigin(request: Request): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim()
  if (explicit) return explicit.replace(/\/+$/, '')
  return new URL(request.url).origin
}
