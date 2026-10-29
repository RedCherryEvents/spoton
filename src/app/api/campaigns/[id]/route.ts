import { NextResponse } from 'next/server'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { asJsonError, loadOwnedCampaign } from '@/lib/campaigns/access'
import { normalizeWhatsAppNumber } from '@/lib/campaigns/whatsapp-link'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getCurrentAccount()
    const { id } = await params
    const campaign = await loadOwnedCampaign(ctx, id)
    return NextResponse.json({ campaign })
  } catch (err) {
    return asJsonError(err) ?? toErrorResponse(err)
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole('agent')
    const { id } = await params
    const existing = await loadOwnedCampaign(ctx, id)
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

    const patch: Record<string, unknown> = {}
    for (const key of ['name', 'code', 'keyword', 'description', 'status', 'starts_at', 'ends_at']) {
      if (key in body) patch[key] = body[key]
    }
    if (patch.status && !['draft', 'active', 'paused', 'closed', 'archived'].includes(String(patch.status))) {
      return NextResponse.json({ error: 'invalid status' }, { status: 400 })
    }
    if (body.settings && typeof body.settings === 'object' && !Array.isArray(body.settings)) {
      const allowedSettings = new Set([
        'duplicate_rule',
        'client_name',
        'brand_color',
        'logo_url',
        'whatsapp_number',
        'terms_url',
        'test_numbers',
        'closed_message',
        'duplicate_message',
      ])
      const next = { ...(existing.settings ?? {}) } as Record<string, unknown>
      const incoming = body.settings as Record<string, unknown>
      for (const [key, value] of Object.entries(incoming)) {
        if (!allowedSettings.has(key)) continue
        if (value === null || value === '') delete next[key]
        else next[key] = value
      }
      if (next.terms_url !== undefined) {
        try {
          const u = new URL(String(next.terms_url))
          if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('bad protocol')
        } catch {
          return NextResponse.json({ error: 'T&C link must be a full web address (https://…)' }, { status: 400 })
        }
      }
      if (next.test_numbers !== undefined) {
        const raw = Array.isArray(next.test_numbers) ? next.test_numbers : String(next.test_numbers).split(/[,\n]/)
        const numbers = raw.map((n) => String(n).replace(/\D/g, '')).filter((n) => n.length >= 9)
        if (numbers.length === 0) delete next.test_numbers
        else next.test_numbers = [...new Set(numbers)]
      }
      for (const key of ['closed_message', 'duplicate_message'] as const) {
        if (next[key] !== undefined) next[key] = String(next[key]).slice(0, 1000)
      }
      if (next.whatsapp_number !== undefined) {
        const n = normalizeWhatsAppNumber(String(next.whatsapp_number))
        if (!n) {
          return NextResponse.json(
            { error: 'WhatsApp number must include the country code, e.g. +27 79 863 7339' },
            { status: 400 },
          )
        }
        next.whatsapp_number = n
      }
      if (typeof next.duplicate_rule === 'string') {
        const allowed = ['whatsapp', 'email', 'whatsapp_per_day', 'unlimited']
        if (!allowed.includes(next.duplicate_rule)) {
          return NextResponse.json({ error: 'invalid duplicate_rule' }, { status: 400 })
        }
      }
      patch.settings = next
    }

    // A competition can't go live without its published T&Cs.
    if (patch.status === 'active') {
      const settings = (patch.settings ?? existing.settings ?? {}) as { terms_required?: boolean; terms_url?: string }
      if (settings.terms_required && !settings.terms_url) {
        return NextResponse.json(
          { error: 'Add the terms & conditions link (Settings) before activating this campaign.' },
          { status: 400 },
        )
      }
    }

    const { data, error } = await ctx.supabase
      .from('campaigns')
      .update(patch)
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select('*')
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ campaign: data })
  } catch (err) {
    return asJsonError(err) ?? toErrorResponse(err)
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole('agent')
    const { id } = await params
    await loadOwnedCampaign(ctx, id)
    const { error } = await ctx.supabase
      .from('campaigns')
      .delete()
      .eq('id', id)
      .eq('account_id', ctx.accountId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return asJsonError(err) ?? toErrorResponse(err)
  }
}
