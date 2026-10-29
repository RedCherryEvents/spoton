import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { asJsonError, loadOwnedCampaign } from '@/lib/campaigns/access'
import { appendEntryEvent } from '@/lib/campaigns/events'
import { engineSendTemplate } from '@/lib/automations/meta-send'

/**
 * POST: notify a drawn winner. Admins only; one notification per draw.
 * Sends an approved WhatsApp template (the winner's 24-hour window has
 * usually closed by the time a draw happens, so free text won't do).
 * This is the only path that contacts a winner — nothing is automatic.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; drawId: string }> },
) {
  try {
    const ctx = await requireRole('admin')
    const { id, drawId } = await params
    const campaign = await loadOwnedCampaign(ctx, id)
    if (campaign.status !== 'closed') {
      return NextResponse.json({ error: 'The campaign must be Closed to notify a winner.' }, { status: 400 })
    }

    const body = (await request.json().catch(() => null)) as
      | { template_name?: unknown; language?: unknown; params?: unknown }
      | null
    const templateName = typeof body?.template_name === 'string' ? body.template_name.trim() : ''
    if (!templateName) {
      return NextResponse.json({ error: 'Pick the approved WhatsApp template to send.' }, { status: 400 })
    }
    const language = typeof body?.language === 'string' && body.language.trim() ? body.language.trim() : undefined
    const templateParams = Array.isArray(body?.params)
      ? body.params.filter((p): p is string => typeof p === 'string')
      : undefined

    const { data: draw } = await ctx.supabase
      .from('campaign_draws')
      .select('*')
      .eq('id', drawId)
      .eq('campaign_id', campaign.id)
      .eq('account_id', ctx.accountId)
      .maybeSingle()
    if (!draw) return NextResponse.json({ error: 'Draw not found.' }, { status: 404 })
    if (draw.notified_at) {
      return NextResponse.json({ error: 'This winner has already been notified.' }, { status: 409 })
    }

    const { data: entry } = await ctx.supabase
      .from('campaign_entries')
      .select('id, contact_id, metadata')
      .eq('id', draw.winner_entry_id)
      .eq('account_id', ctx.accountId)
      .maybeSingle()
    if (!entry?.contact_id) return NextResponse.json({ error: 'The winning entry has no contact.' }, { status: 400 })

    const { data: conversation } = await ctx.supabase
      .from('conversations')
      .select('id')
      .eq('account_id', ctx.accountId)
      .eq('contact_id', entry.contact_id)
      .maybeSingle()
    if (!conversation) return NextResponse.json({ error: "The winner's conversation was not found." }, { status: 400 })

    // Claim the draw first so two admins can't both send.
    const now = new Date().toISOString()
    const { data: claimed } = await ctx.supabase
      .from('campaign_draws')
      .update({ notified_at: now, notified_by: ctx.userId, notification_template: templateName })
      .eq('id', draw.id)
      .is('notified_at', null)
      .select('id')
    if (!claimed || claimed.length === 0) {
      return NextResponse.json({ error: 'This winner has already been notified.' }, { status: 409 })
    }

    let messageId: string
    try {
      const sent = await engineSendTemplate({
        accountId: ctx.accountId,
        userId: ctx.userId,
        conversationId: conversation.id,
        contactId: entry.contact_id,
        templateName,
        language,
        params: templateParams,
      })
      messageId = sent.whatsapp_message_id
    } catch (err) {
      // Release the claim so it can be retried with a working template.
      await ctx.supabase
        .from('campaign_draws')
        .update({ notified_at: null, notified_by: null, notification_template: null })
        .eq('id', draw.id)
      return NextResponse.json(
        { error: `WhatsApp did not accept the template: ${err instanceof Error ? err.message : String(err)}` },
        { status: 502 },
      )
    }

    await ctx.supabase.from('campaign_draws').update({ notification_message_id: messageId }).eq('id', draw.id)
    await ctx.supabase
      .from('campaign_entries')
      .update({
        metadata: appendEntryEvent(entry.metadata as Record<string, unknown> | null, {
          type: 'winner_notified',
          label: `Winner notified (template ${templateName})`,
          detail: messageId,
        }),
        updated_at: now,
      })
      .eq('id', entry.id)
      .eq('account_id', ctx.accountId)

    return NextResponse.json({ ok: true, message_id: messageId })
  } catch (err) {
    return asJsonError(err) ?? toErrorResponse(err)
  }
}
