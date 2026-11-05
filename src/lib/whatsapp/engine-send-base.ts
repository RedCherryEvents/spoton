import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import { sanitizePhoneForMeta, isValidE164 } from '@/lib/whatsapp/phone-utils'

// Shared database steps for the automation and flow senders.
//
// Each send needs the contact's phone and the account's WhatsApp config
// before it can call Meta, and writes the message row and the
// conversation summary afterwards. Those pairs don't depend on each
// other, so each pair runs in parallel: one database round trip before
// the Meta call and one after, instead of two each.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>

export interface SendTarget {
  contact: { id: string; phone: string }
  /** The contact's phone, sanitised for Meta. */
  sanitized: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  config: any
  accessToken: string
}

/**
 * Load the contact and the WhatsApp config, both scoped to the account.
 * The service-role client bypasses RLS, so the account filter is what
 * stops a send to another tenant's contact. Errors keep the order they
 * had when the lookups ran one after the other: contact, phone, config.
 */
export async function loadSendTarget(
  db: Db,
  accountId: string,
  contactId: string,
): Promise<SendTarget> {
  const [contactRes, configRes] = await Promise.all([
    db
      .from('contacts')
      .select('id, phone')
      .eq('id', contactId)
      .eq('account_id', accountId)
      .maybeSingle(),
    db.from('whatsapp_config').select('*').eq('account_id', accountId).single(),
  ])

  const contact = contactRes.data as { id: string; phone: string | null } | null
  if (contactRes.error || !contact?.phone) {
    throw new Error('contact not found for this account')
  }

  const sanitized = sanitizePhoneForMeta(contact.phone)
  if (!isValidE164(sanitized)) {
    throw new Error(`contact phone invalid: ${contact.phone}`)
  }

  const config = configRes.data
  if (configRes.error || !config) {
    throw new Error('WhatsApp not configured for this account')
  }

  return {
    contact: { id: contact.id, phone: contact.phone },
    sanitized,
    config,
    accessToken: decrypt(config.access_token),
  }
}

/**
 * Store a message Meta accepted, and refresh the conversation's
 * last-message summary. `status` stays 'sent': only Meta's status
 * webhook moves it to delivered / read.
 */
export async function recordBotMessage(
  db: Db,
  conversationId: string,
  row: Record<string, unknown>,
  lastMessageText: string | null,
): Promise<void> {
  const now = new Date().toISOString()
  const [{ error: msgErr }] = await Promise.all([
    db.from('messages').insert({
      conversation_id: conversationId,
      sender_type: 'bot',
      status: 'sent',
      ...row,
    }),
    db
      .from('conversations')
      .update({ last_message_text: lastMessageText, last_message_at: now, updated_at: now })
      .eq('id', conversationId),
  ])
  if (msgErr) {
    // Meta already has the message; surface the DB error but don't
    // pretend the send failed.
    throw new Error(`sent to Meta but DB insert failed: ${msgErr.message}`)
  }
}
