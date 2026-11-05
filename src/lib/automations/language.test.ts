import { describe, expect, it } from 'vitest'
import {
  languageFromTagName,
  languageTagName,
  localizeStepConfig,
  normalizeLanguage,
} from './language'
import { validateStepsForActivation } from './validate'

describe('normalizeLanguage', () => {
  it('reads names, codes, list-row ids and common spellings', () => {
    expect(normalizeLanguage('isiZulu')).toBe('zu')
    expect(normalizeLanguage(' ZULU ')).toBe('zu')
    expect(normalizeLanguage('lang_xh')).toBe('xh')
    expect(normalizeLanguage('Afrikaans')).toBe('af')
    expect(normalizeLanguage('sesotho')).toBe('st')
    expect(normalizeLanguage('English')).toBe('en')
  })
  it('rejects anything else, including campaign keywords', () => {
    expect(normalizeLanguage('SAVE')).toBeNull()
    expect(normalizeLanguage('')).toBeNull()
    expect(normalizeLanguage(undefined)).toBeNull()
  })
})

describe('language tags', () => {
  it('round-trips through the tag name', () => {
    expect(languageTagName('zu')).toBe('Language: isiZulu')
    expect(languageFromTagName('Language: isiZulu')).toBe('zu')
    expect(languageFromTagName('SPOT ON welcomed')).toBeNull()
  })
})

describe('localizeStepConfig', () => {
  const cfg = {
    text: 'Hello',
    var_key: 'answer',
    translations: { af: { text: 'Hallo', var_key: 'hacked' }, zu: { text: '' } },
  }

  it('swaps in the wording for the contact language only', () => {
    expect(localizeStepConfig(cfg, 'af')).toEqual({ text: 'Hallo', var_key: 'answer' })
  })
  it('falls back to English when there is no (or an empty) translation', () => {
    expect(localizeStepConfig(cfg, 'xh')).toEqual({ text: 'Hello', var_key: 'answer' })
    expect(localizeStepConfig(cfg, 'zu')).toEqual({ text: 'Hello', var_key: 'answer' })
    expect(localizeStepConfig(cfg, null)).toEqual({ text: 'Hello', var_key: 'answer' })
  })
  it('never passes `translations` on, and leaves steps without it untouched', () => {
    expect(localizeStepConfig(cfg, 'en')).not.toHaveProperty('translations')
    const plain = { text: 'Hi' }
    expect(localizeStepConfig(plain, 'af')).toBe(plain)
  })
})

describe('translation activation checks', () => {
  const buttons = (translations: unknown) => [
    {
      step_type: 'send_buttons',
      step_config: {
        kind: 'buttons',
        body: 'Pick one',
        buttons: [{ id: 'a', title: 'Yes' }],
        translations,
      },
    },
  ]

  it('accepts a valid translation', () => {
    expect(validateStepsForActivation(buttons({ af: { body: 'Kies een', buttons: [{ id: 'a', title: 'Ja' }] } }))).toEqual([])
  })
  it('rejects unknown languages, changed ids and over-long labels', () => {
    expect(validateStepsForActivation(buttons({ fr: { body: 'Choisis' } }))).toHaveLength(1)
    expect(validateStepsForActivation(buttons({ af: { buttons: [{ id: 'b', title: 'Ja' }] } }))).toHaveLength(1)
    expect(
      validateStepsForActivation(buttons({ zu: { buttons: [{ id: 'a', title: 'x'.repeat(21) }] } })),
    ).toHaveLength(1)
  })
  it('checks set_language values', () => {
    expect(validateStepsForActivation([{ step_type: 'set_language', step_config: { value: '{{message.text}}' } }])).toEqual([])
    expect(validateStepsForActivation([{ step_type: 'set_language', step_config: { value: 'isiZulu' } }])).toEqual([])
    expect(validateStepsForActivation([{ step_type: 'set_language', step_config: { value: 'Klingon' } }])).toHaveLength(1)
  })
})
