/**
 * Vue I18n plugin setup for agent-viewer.
 *
 * Supports: 'fr' (default), 'en', and additional locales.
 * Language is persisted in localStorage under the key 'language'.
 * Fallback locale: 'en'.
 *
 * @module plugins/i18n
 */

import { createI18n } from 'vue-i18n'
import fr from '../locales/fr.json'
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

const savedLocale = (localStorage.getItem('language') as AppLocale | null) ?? 'fr'

const i18n = createI18n({
  legacy: false,
  locale: savedLocale,
  fallbackLocale: 'en',
  messages: {
    fr,
    en,
  },
})

export default i18n
