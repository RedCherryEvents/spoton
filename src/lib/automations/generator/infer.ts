/**
 * The one campaign a script talks about, by keyword, code or name.
 * Null when none or several match, so the user always confirms the
 * campaign rather than the generator guessing. Pure: safe in the browser.
 */
export function inferCampaignFromScript(
  script: string,
  campaigns: { id: string; name: string; code: string; keyword: string | null }[],
): string | null {
  const text = script.toLowerCase()
  const hasToken = (token: string) => {
    const t = token.trim().toLowerCase()
    if (t.length < 3) return false
    const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, 'u').test(text)
  }
  const hits = campaigns.filter((c) =>
    [c.keyword, c.code, c.name].some((t) => typeof t === 'string' && hasToken(t)),
  )
  return hits.length === 1 ? hits[0].id : null
}
