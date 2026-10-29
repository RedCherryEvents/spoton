import { NextResponse } from 'next/server'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { asJsonError, loadOwnedCampaign } from '@/lib/campaigns/access'
import { isMissingRelationError } from '@/lib/campaigns/schema-error'
import { drawWinner, eligiblePoolIds } from '@/lib/campaigns/draw'
import { appendEntryEvent } from '@/lib/campaigns/events'

const DRAWS_NOT_READY =
  'Winner draws need migration 045 (supabase/migrations/045_campaign_closed_and_draws.sql). Apply it, then reload.'

/** GET: the draw audit trail, the eligible-entry count, and each winner's details. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getCurrentAccount()
    const { id } = await params
    const campaign = await loadOwnedCampaign(ctx, id)

    const { data: entries, error: entriesErr } = await ctx.supabase
      .from('campaign_entries')
      .select('id, status, metadata')
      .eq('campaign_id', campaign.id)
      .eq('account_id', ctx.accountId)
    if (entriesErr) return NextResponse.json({ error: entriesErr.message }, { status: 500 })

    const { data: draws, error } = await ctx.supabase
      .from('campaign_draws')
      .select('*')
      .eq('campaign_id', campaign.id)
      .eq('account_id', ctx.accountId)
      .order('drawn_at', { ascending: false })
    if (error) {
      if (isMissingRelationError(error)) return NextResponse.json({ error: DRAWS_NOT_READY }, { status: 503 })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const winnerIds = (draws ?? []).map((d) => d.winner_entry_id as string)
    const { data: winners } = winnerIds.length
      ? await ctx.supabase
          .from('campaign_entries')
          .select('id, answers, created_at, contact:contacts(name, phone)')
          .in('id', winnerIds)
      : { data: [] }

    return NextResponse.json({
      status: campaign.status,
      eligible: eligiblePoolIds(entries ?? []).length,
      draws: (draws ?? []).map((d) => ({ ...d, winner: (winners ?? []).find((w) => w.id === d.winner_entry_id) ?? null })),
    })
  } catch (err) {
    return asJsonError(err) ?? toErrorResponse(err)
  }
}

/**
 * POST: run a random draw. Admins only, and only once the campaign is
 * Closed. Picks one eligible entry (Completed, not a test entry) with a
 * cryptographically secure random index and records the whole pool.
 * Nothing is sent to anyone: notifying the winner is a separate action.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('admin')
    const { id } = await params
    const campaign = await loadOwnedCampaign(ctx, id)
    if (campaign.status !== 'closed') {
      return NextResponse.json({ error: 'Close the campaign before drawing a winner.' }, { status: 400 })
    }
    const body = (await request.json().catch(() => ({}))) as { note?: unknown }
    const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 500) : null

    const { data: entries, error: entriesErr } = await ctx.supabase
      .from('campaign_entries')
      .select('id, status, metadata')
      .eq('campaign_id', campaign.id)
      .eq('account_id', ctx.accountId)
    if (entriesErr) return NextResponse.json({ error: entriesErr.message }, { status: 500 })

    const result = drawWinner(entries ?? [])
    if (!result) {
      return NextResponse.json({ error: 'There are no eligible (Completed, non-test) entries to draw from.' }, { status: 400 })
    }

    const { data: draw, error } = await ctx.supabase
      .from('campaign_draws')
      .insert({
        campaign_id: campaign.id,
        account_id: ctx.accountId,
        drawn_by: ctx.userId,
        method: 'random',
        note,
        ...result,
      })
      .select('*')
      .single()
    if (error) {
      if (isMissingRelationError(error)) return NextResponse.json({ error: DRAWS_NOT_READY }, { status: 503 })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const winner = (entries ?? []).find((e) => e.id === result.winner_entry_id)
    await ctx.supabase
      .from('campaign_entries')
      .update({
        metadata: appendEntryEvent(winner?.metadata as Record<string, unknown> | null, {
          type: 'winner_drawn',
          label: 'Drawn as winner (not yet notified)',
          detail: `draw ${draw.id}`,
        }),
        updated_at: new Date().toISOString(),
      })
      .eq('id', result.winner_entry_id)
      .eq('account_id', ctx.accountId)

    return NextResponse.json({ draw }, { status: 201 })
  } catch (err) {
    return asJsonError(err) ?? toErrorResponse(err)
  }
}
