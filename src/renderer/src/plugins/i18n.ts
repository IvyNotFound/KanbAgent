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
import es from '../locales/es.json'
import pt from '../locales/pt.json'
import ar from '../locales/ar.json'
import ja from '../locales/ja.json'
import ptBR from '../locales/pt-BR.json'
import pl from '../locales/pl.json'
import no from '../locales/no.json'
import da from '../locales/da.json'
import ru from '../locales/ru.json'
import fi from '../locales/fi.json'
import sv from '../locales/sv.json'
import de from '../locales/de.json'
import it from '../locales/it.json'
import ko from '../locales/ko.json'
import zhCN from '../locales/zh-CN.json'
import tr from '../locales/tr.json'

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
    pt,
    es,
    ar,
    ja,
    'pt-BR': ptBR,
    pl,
    no,
    da,
    ru,
    fi,
    sv,
    de,
    it,
    ko,
    'zh-CN': zhCN,
    tr,
  },
})

export default i18n
