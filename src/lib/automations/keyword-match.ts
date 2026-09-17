import type { KeywordMatchTriggerConfig } from '@/types'

/** Letter, digit or underscore in any script — the "inside a word" test. */
const WORD_CHAR = '[\\p{L}\\p{N}_]'
const WORD_CHAR_RE = /[\p{L}\p{N}_]/u

function isWordChar(ch: string | undefined): boolean {
  return Boolean(ch && WORD_CHAR_RE.test(ch))
}

/**
 * Whole-word keyword test, behind `match_type: 'word'` (issue #409 — a
 * one-letter keyword under `contains` fires on every message containing
 * that letter, e.g. "k" on "thanks").
 *
 * Deliberately NOT `\b`, which is defined against `[A-Za-z0-9_]` and so
 * breaks two cases that matter for WhatsApp traffic:
 *
 *   - A keyword carrying punctuation: `/\bhi!\b/` demands a word character
 *     after the "!", so it never matches "say hi!".
 *   - Any non-Latin script: every character of "안녕" is a non-word
 *     character to `\b`, so `/\b안녕\b/` matches nothing at all.
 *
 * Unicode-aware lookarounds handle both. Note this really is word-based:
 * it won't find "안녕" inside "안녕하세요", because a language that doesn't
 * delimit words with spaces has no word edge there. That's what `contains`
 * is for, and it stays the default.
 *
 * Exported for direct unit testing of the escaping / boundary edges.
 */
export function matchesWholeWord(
  text: string,
  keyword: string,
  caseSensitive = false,
): boolean {
  if (!keyword) return false
  // The keyword is account-supplied free text, so metacharacters have to
  // be literal — otherwise "(" is an unterminated group and RegExp throws.
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(
    `(?<!${WORD_CHAR})${escaped}(?!${WORD_CHAR})`,
    caseSensitive ? 'u' : 'iu',
  )
  return pattern.test(text)
}

/**
 * `exact` is the campaign-keyword footgun: people type JOIN, then
 * "JOIN I want to enter". Requiring the *entire* message to equal the
 * keyword meant those inbounds silently missed. Exact now matches the
 * whole trimmed message, or the keyword as the leading token
 * (`WINICC2027 I want to enter` yes, `WINICC2027xyz` no, `please JOIN` no).
 */
function exactOrLeadingToken(haystack: string, keyword: string): boolean {
  if (haystack === keyword) return true
  if (!haystack.startsWith(keyword)) return false
  return haystack.length === keyword.length || !isWordChar(haystack[keyword.length])
}

/**
 * Pure keyword matcher — safe to import from client components (the
 * automation builder's live sample) and from the engine. Does not touch
 * the database.
 */
export function keywordTextMatches(
  cfg: Pick<KeywordMatchTriggerConfig, 'keywords' | 'match_type' | 'case_sensitive'>,
  messageText: string,
): boolean {
  if (!cfg?.keywords || cfg.keywords.length === 0) return false
  const text = (messageText ?? '').toString()
  if (!text.trim()) return false

  if (cfg.match_type === 'word') {
    return cfg.keywords.some((raw) =>
      matchesWholeWord(text, raw, cfg.case_sensitive),
    )
  }

  const haystack = (cfg.case_sensitive ? text : text.toLowerCase()).trim()
  return cfg.keywords.some((raw) => {
    const k = (cfg.case_sensitive ? raw : raw.toLowerCase()).trim()
    if (!k) return false
    if (cfg.match_type === 'exact') return exactOrLeadingToken(haystack, k)
    if (cfg.match_type === 'starts_with') return haystack.startsWith(k)
    if (cfg.match_type === 'ends_with') return haystack.endsWith(k)
    return haystack.includes(k)
  })
}
