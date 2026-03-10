/**
 * Tests for plugins/i18n.ts
 *
 * Strategy for mutation killing:
 * - StringLiteral mutations: 'fr' → '', 'en' → '', 'language' → ''
 * - ConditionalExpression: typeof localStorage !== 'undefined' → flipped
 * - LogicalExpression: ?? 'fr' → ?? ''
 * - legacy: false → legacy: true
 *
 * The module is a singleton (evaluated once on import), so we test the
 * exported instance properties directly. For localStorage-dependent tests,
 * we use vi.resetModules() + dynamic import to re-evaluate the module.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

describe('i18n plugin — static instance', () => {
  it('exports a non-null i18n instance', async () => {
    const { default: i18n } = await import('./i18n')
    expect(i18n).toBeDefined()
    expect(i18n).not.toBeNull()
  })

  it('has legacy mode disabled (legacy: false)', async () => {
    const { default: i18n } = await import('./i18n')
    // In Composition API mode (legacy: false), globalInjection is a property
    // and the instance exposes `mode: 'composition'`
    expect((i18n as { mode?: string }).mode).toBe('composition')
  })

  it('has fallbackLocale set to "en" (kills StringLiteral mutation on fallbackLocale)', async () => {
    const { default: i18n } = await import('./i18n')
    const fallback = i18n.global.fallbackLocale.value
    // fallbackLocale can be a string or an array depending on vue-i18n version
    const fallbackStr = Array.isArray(fallback) ? fallback[0] : fallback
    expect(fallbackStr).toBe('en')
  })

  it('has "fr" messages loaded (kills StringLiteral mutation on locale key)', async () => {
    const { default: i18n } = await import('./i18n')
    const messages = i18n.global.getLocaleMessage('fr')
    expect(messages).toBeDefined()
    // fr.json has common.loading = "Chargement…"
    expect((messages as { common?: { loading?: string } }).common?.loading).toBe('Chargement…')
  })

  it('has "en" messages loaded (kills StringLiteral mutation on "en" key)', async () => {
    const { default: i18n } = await import('./i18n')
    const messages = i18n.global.getLocaleMessage('en')
    expect(messages).toBeDefined()
    expect((messages as { common?: { loading?: string } }).common?.loading).toBe('Loading…')
  })

  it('has messages for all 18 locales registered', async () => {
    const { default: i18n } = await import('./i18n')
    const expectedLocales = [
      'fr', 'en', 'es', 'pt', 'pt-BR', 'de', 'no', 'it',
      'ar', 'ru', 'pl', 'sv', 'fi', 'da', 'tr', 'zh-CN', 'ko', 'ja',
    ]
    for (const locale of expectedLocales) {
      const msgs = i18n.global.getLocaleMessage(locale)
      expect(msgs, `Expected messages for locale "${locale}" to be defined`).toBeDefined()
      expect(Object.keys(msgs).length, `Expected messages for locale "${locale}" to be non-empty`).toBeGreaterThan(0)
    }
  })
})

describe('i18n plugin — localStorage locale resolution', () => {
  beforeEach(() => {
    vi.resetModules()
    localStorage.clear()
  })

  it('defaults to "fr" when localStorage has no "language" key (kills ?? "fr" mutation)', async () => {
    // localStorage is empty — no 'language' key
    localStorage.clear()
    const { default: i18n } = await import('./i18n')
    expect(i18n.global.locale.value).toBe('fr')
  })

  it('uses the locale stored in localStorage under key "language"', async () => {
    // Kills StringLiteral mutation on 'language' key:
    // if mutant changes 'language' → '' or other key, getItem returns null → defaults to 'fr'
    localStorage.setItem('language', 'en')
    const { default: i18n } = await import('./i18n')
    expect(i18n.global.locale.value).toBe('en')
  })

  it('uses "es" locale from localStorage correctly', async () => {
    localStorage.setItem('language', 'es')
    const { default: i18n } = await import('./i18n')
    expect(i18n.global.locale.value).toBe('es')
  })

  it('uses "de" locale from localStorage correctly', async () => {
    localStorage.setItem('language', 'de')
    const { default: i18n } = await import('./i18n')
    expect(i18n.global.locale.value).toBe('de')
  })

  it('defaults to "fr" when localStorage returns null (kills typeof check mutation)', async () => {
    // Simulate localStorage.getItem returning null (no key set)
    localStorage.removeItem('language')
    const { default: i18n } = await import('./i18n')
    // ?? 'fr' must apply → locale is 'fr'
    expect(i18n.global.locale.value).toBe('fr')
  })
})
