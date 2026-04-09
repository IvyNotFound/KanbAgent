/**
 * Vue I18n plugin setup for KanbAgent.
 *
 * Supports 18 locales: fr (default), en, es, pt, pt-BR, de, no, it, ar, ru, pl, sv, fi, da, tr, zh-CN, ko, ja.
 * Language is persisted in localStorage under the key 'language'.
 * Fallback locale: 'en'. Arabic (ar) is loaded but full RTL layout support is deferred.
 *
 * Only en (fallback) and the user's saved locale are loaded eagerly.
 * Other locales are loaded on demand via loadLocaleMessages().
 *
 * @module plugins/i18n
 */

import { createI18n } from 'vue-i18n'
import en from '../locales/en.json'

export type AppLocale =
  | 'fr'
  | 'en'
  | 'es'
  | 'pt'
  | 'pt-BR'
  | 'de'
  | 'no'
  | 'it'
  | 'ar' // RTL — layout global à prévoir dans une phase ultérieure
  | 'ru'
  | 'pl'
  | 'sv'
  | 'fi'
  | 'da'
  | 'tr'
  | 'zh-CN'
  | 'ko'
  | 'ja'

const localeImportMap: Record<AppLocale, () => Promise<{ default: Record<string, unknown> }>> = {
  en: () => import('../locales/en.json'),
  fr: () => import('../locales/fr.json'),
  es: () => import('../locales/es.json'),
  pt: () => import('../locales/pt.json'),
  'pt-BR': () => import('../locales/pt-BR.json'),
  de: () => import('../locales/de.json'),
  no: () => import('../locales/no.json'),
  it: () => import('../locales/it.json'),
  ar: () => import('../locales/ar.json'),
  ru: () => import('../locales/ru.json'),
  pl: () => import('../locales/pl.json'),
  sv: () => import('../locales/sv.json'),
  fi: () => import('../locales/fi.json'),
  da: () => import('../locales/da.json'),
  tr: () => import('../locales/tr.json'),
  'zh-CN': () => import('../locales/zh-CN.json'),
  ko: () => import('../locales/ko.json'),
  ja: () => import('../locales/ja.json'),
}

const loadedLocales = new Set<AppLocale>(['en'])

const savedLocale =
  (typeof localStorage !== 'undefined'
    ? (localStorage.getItem('language') as AppLocale | null)
    : null) ?? 'fr'

const initialMessages: Record<string, Record<string, unknown>> = { en }

const i18n = createI18n({
  legacy: false,
  locale: savedLocale,
  fallbackLocale: 'en',
  messages: initialMessages,
})

/**
 * Load locale messages on demand. No-op if already loaded.
 */
export async function loadLocaleMessages(locale: AppLocale): Promise<void> {
  if (loadedLocales.has(locale)) return
  const importFn = localeImportMap[locale]
  if (!importFn) return
  const messages = await importFn()
  i18n.global.setLocaleMessage(locale, messages.default)
  loadedLocales.add(locale)
}

/** Resolves when the saved locale is loaded. Immediate for 'en'. */
export const i18nReady: Promise<void> =
  savedLocale !== 'en'
    ? loadLocaleMessages(savedLocale as AppLocale)
    : Promise.resolve()

export default i18n
