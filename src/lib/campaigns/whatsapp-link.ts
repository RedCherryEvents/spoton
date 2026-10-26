// WhatsApp click-to-chat entry links for campaigns (wa.me).
//
// Kept free of runtime imports so the one-off setup scripts in
// /scripts can load it with plain Node.

/**
 * Digits-only international number for a wa.me link
 * ("+27 79 863 7339" → "27798637339"), or null if it can't be one.
 * wa.me wants the country code with no "+", spaces or leading zeros.
 */
export function normalizeWhatsAppNumber(raw: string | null | undefined): string | null {
  const digits = String(raw ?? '').replace(/\D/g, '')
  return /^[1-9]\d{6,14}$/.test(digits) ? digits : null
}

/**
 * The keyword a customer should send. `campaigns.keyword` may hold a
 * comma-separated list ("BMWTEST2026, BMW"); the first one is the
 * prefill.
 */
export function campaignEntryKeyword(keyword: string | null | undefined): string | null {
  const first = String(keyword ?? '')
    .split(',')
    .map((k) => k.trim())
    .find(Boolean)
  return first ?? null
}

/**
 * `https://wa.me/<number>?text=<keyword>` — opens a chat with the
 * number and the keyword prefilled. Null when the number is invalid.
 */
export function buildWhatsAppEntryUrl(
  number: string | null | undefined,
  keyword?: string | null,
): string | null {
  const n = normalizeWhatsAppNumber(number)
  if (!n) return null
  const text = campaignEntryKeyword(keyword)
  return text ? `https://wa.me/${n}?text=${encodeURIComponent(text)}` : `https://wa.me/${n}`
}
