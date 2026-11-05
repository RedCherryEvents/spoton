// Customer language for automations.
//
// A contact's language is a tag named "Language: <name>" (e.g.
// "Language: isiZulu"), so it shows on the contact and can be used to
// filter broadcasts. The `set_language` step writes it; the engine
// reads it before each run.
//
// Any message step can carry per-language text in `translations`:
//
//   { text: 'Hello', translations: { af: { text: 'Hallo' }, zu: { text: 'Sawubona' } } }
//
// When the contact's language has a variant, its text replaces the
// English; otherwise the English is sent. Only wording can change
// (TRANSLATABLE_KEYS): ids, variables and settings always come from the
// base step.
//
// No runtime imports, so the setup scripts can load it with plain Node.

export const LANGUAGES = [
  { code: 'en', name: 'English', aliases: ['english', 'eng', 'en'] },
  { code: 'af', name: 'Afrikaans', aliases: ['afrikaans', 'afr', 'af'] },
  { code: 'zu', name: 'isiZulu', aliases: ['isizulu', 'zulu', 'zu'] },
  { code: 'xh', name: 'isiXhosa', aliases: ['isixhosa', 'xhosa', 'xh'] },
  { code: 'st', name: 'Sesotho', aliases: ['sesotho', 'sotho', 'southern sotho', 'st'] },
] as const

export type LanguageCode = (typeof LANGUAGES)[number]['code']

export const DEFAULT_LANGUAGE: LanguageCode = 'en'
export const LANGUAGE_TAG_PREFIX = 'Language: '

/** Message wording a translation may replace. */
export const TRANSLATABLE_KEYS = [
  'text',
  'body',
  'header',
  'footer',
  'buttons',
  'button_label',
  'sections',
  'retry_text',
] as const

export type StepTranslations = Partial<Record<LanguageCode, Record<string, unknown>>>

/**
 * "isiZulu", "zulu", "ZU", "lang_zu" → "zu". Null when it isn't one of
 * ours. Accepts a list-row id (`lang_<code>`) so a tap always resolves.
 */
export function normalizeLanguage(raw: unknown): LanguageCode | null {
  const v = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/^lang_/, '')
  if (!v) return null
  for (const lang of LANGUAGES) {
    if ((lang.aliases as readonly string[]).includes(v)) return lang.code
  }
  return null
}

export function languageName(code: LanguageCode): string {
  return LANGUAGES.find((l) => l.code === code)?.name ?? code
}

export function languageTagName(code: LanguageCode): string {
  return `${LANGUAGE_TAG_PREFIX}${languageName(code)}`
}

/** "Language: isiZulu" → "zu"; any other tag → null. */
export function languageFromTagName(tagName: unknown): LanguageCode | null {
  const name = String(tagName ?? '')
  if (!name.startsWith(LANGUAGE_TAG_PREFIX)) return null
  return normalizeLanguage(name.slice(LANGUAGE_TAG_PREFIX.length))
}

/**
 * The step config to send for a contact: the base config with the
 * contact's translation (wording keys only) laid over it, and the
 * `translations` key removed so it never reaches Meta.
 */
export function localizeStepConfig<T extends object>(config: T, language: string | null | undefined): T {
  if (!config || typeof config !== 'object' || !('translations' in config)) return config
  const { translations, ...base } = config as T & { translations?: unknown }
  const code = normalizeLanguage(language)
  if (!code || code === DEFAULT_LANGUAGE || !translations || typeof translations !== 'object') {
    return base as T
  }
  const variant = (translations as Record<string, unknown>)[code]
  if (!variant || typeof variant !== 'object') return base as T
  const out: Record<string, unknown> = { ...base }
  for (const key of TRANSLATABLE_KEYS) {
    const value = (variant as Record<string, unknown>)[key]
    if (value !== undefined && value !== null && value !== '') out[key] = value
  }
  return out as T
}
