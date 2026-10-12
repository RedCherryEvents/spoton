// Flows see every inbound before automations (see the webhook), and a
// flow that starts a run consumes the message, which suppresses
// `keyword_match` automations. These helpers flag automation keywords
// whose every match is guaranteed to also start a flow first.

export interface KeywordListener {
  keywords?: unknown
  match_type?: unknown
  case_sensitive?: unknown
}

export interface KeywordConflict {
  /** Automation keyword that can never fire on its own. */
  automationKeyword: string
  /** Flow keyword that captures it. */
  flowKeyword: string
}

function keywordList(listener: KeywordListener): string[] {
  return Array.isArray(listener.keywords)
    ? listener.keywords.filter((k): k is string => typeof k === 'string' && k.trim().length > 0)
    : []
}

/**
 * Pairs where any message triggering the automation keyword also
 * triggers the flow keyword. Matching is case-insensitive unless both
 * sides opt into case sensitivity.
 */
export function blockedAutomationKeywords(
  automation: KeywordListener,
  flow: KeywordListener,
): KeywordConflict[] {
  const caseSensitive = automation.case_sensitive === true && flow.case_sensitive === true
  const norm = (s: string) => (caseSensitive ? s.trim() : s.trim().toLowerCase())
  const flowExact = flow.match_type === 'exact'

  const conflicts: KeywordConflict[] = []
  for (const a of keywordList(automation)) {
    const an = norm(a)
    const hit = keywordList(flow).find((f) => {
      const fn = norm(f)
      return flowExact ? an === fn : an.includes(fn)
    })
    if (hit) conflicts.push({ automationKeyword: a, flowKeyword: hit })
  }
  return conflicts
}
