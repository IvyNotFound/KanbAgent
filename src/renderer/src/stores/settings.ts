/**
 * Pinia store for application settings and configuration.
 *
 * Manages:
 * - Theme (dark/light mode)
 * - Language (fr/en)
 * - App info (version, name)
 *
 * @module stores/settings
 */

import { defineStore } from 'pinia'
import { ref } from 'vue'
import i18n from '../plugins/i18n'
import { setDarkMode } from '../utils/agentColor'

export type Theme = 'dark' | 'light'
export type Language =
  | 'fr'
  | 'en'
  | 'es'
  | 'pt'
  | 'pt-BR'
  | 'de'
  | 'no'
  | 'it'
  | 'ar'
  | 'ru'
  | 'pl'
  | 'sv'
  | 'fi'
  | 'da'
  | 'tr'
  | 'zh-CN'
  | 'ko'
  | 'ja'

interface AppInfo {
  version: string
  name: string
}

/**
 * Settings store using Pinia composition API.
 *
 * State:
 * - theme: Current theme ('dark' | 'light')
 * - language: UI language ('fr' | 'en')
 * - github: GitHub connection settings
 * - appInfo: Application metadata
 *
 * Actions:
 * - setTheme, applyTheme: Theme management
 * - setLanguage: Language switching
 *
 * @returns {object} Store instance with state and methods
 */
export const useSettingsStore = defineStore('settings', () => {
  // Theme
  const theme = ref<Theme>((localStorage.getItem('theme') as Theme) || 'dark')

  /**
   * Persists and applies a new theme.
   *
   * @param t - The theme to apply ('dark' | 'light')
   * @returns {void}
   */
  function setTheme(t: Theme) {
    theme.value = t
    localStorage.setItem('theme', t)
    applyTheme(t)
  }

  /**
   * Applies a theme to the document root element.
   * Adds/removes the 'dark' CSS class used by Tailwind.
   *
   * @param t - The theme to apply ('dark' | 'light')
   * @returns {void}
   */
  function applyTheme(t: Theme) {
    const dark = t === 'dark'
    if (dark) {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
    setDarkMode(dark)
  }

  // Apply theme on load
  applyTheme(theme.value)

  // Language
  const language = ref<Language>((localStorage.getItem('language') as Language) || 'fr')

  /**
   * Persists and applies a new UI language.
   *
   * @param l - The language code to set ('fr' | 'en')
   * @returns {void}
   */
  function setLanguage(l: Language) {
    language.value = l
    localStorage.setItem('language', l)
    // Sync to vue-i18n global locale for hot-switching
    i18n.global.locale.value = l
  }

  // App info
  const appInfo = ref<AppInfo>({
    version: (import.meta.env['VITE_APP_VERSION'] as string) || '0.2.0',
    name: 'Agent Viewer'
  })

  // Auto-launch agent sessions (T340)
  const autoLaunchAgentSessions = ref<boolean>(localStorage.getItem('autoLaunchAgentSessions') !== 'false')

  /** @param enabled - Enable/disable auto-launch of agent terminal sessions on task creation */
  function setAutoLaunchAgentSessions(enabled: boolean) {
    autoLaunchAgentSessions.value = enabled
    localStorage.setItem('autoLaunchAgentSessions', String(enabled))
  }

  // Auto-launch review sessions (T341)
  const autoReviewEnabled = ref<boolean>(localStorage.getItem('autoReviewEnabled') !== 'false')
  const autoReviewThreshold = ref<number>(Math.max(3, parseInt(localStorage.getItem('autoReviewThreshold') ?? '10', 10) || 10))

  /** @param enabled - Enable/disable auto-launch of review sessions when done threshold is reached */
  function setAutoReviewEnabled(enabled: boolean) {
    autoReviewEnabled.value = enabled
    localStorage.setItem('autoReviewEnabled', String(enabled))
  }

  /** @param n - Minimum done tasks to trigger auto-review (clamped to ≥3) */
  function setAutoReviewThreshold(n: number) {
    const clamped = Math.max(3, n)
    autoReviewThreshold.value = clamped
    localStorage.setItem('autoReviewThreshold', String(clamped))
  }

  // Default Claude instance (T857)
  const defaultClaudeInstance = ref<string>(localStorage.getItem('defaultClaudeInstance') || '')
  function setDefaultClaudeInstance(distro: string) {
    defaultClaudeInstance.value = distro
    localStorage.setItem('defaultClaudeInstance', distro)
  }

  const defaultClaudeProfile = ref<string>(localStorage.getItem('defaultClaudeProfile') || 'claude')
  function setDefaultClaudeProfile(profile: string) {
    defaultClaudeProfile.value = profile
    localStorage.setItem('defaultClaudeProfile', profile)
  }

  // Max file lines instruction (T899)
  const maxFileLinesEnabled = ref<boolean>(localStorage.getItem('maxFileLinesEnabled') === 'true')
  const maxFileLinesCount = ref<number>(parseInt(localStorage.getItem('maxFileLinesCount') ?? '400', 10) || 400)

  function setMaxFileLinesEnabled(enabled: boolean) {
    maxFileLinesEnabled.value = enabled
    localStorage.setItem('maxFileLinesEnabled', String(enabled))
  }

  function setMaxFileLinesCount(n: number) {
    const clamped = Math.max(50, Math.min(10000, n))
    maxFileLinesCount.value = clamped
    localStorage.setItem('maxFileLinesCount', String(clamped))
  }

  // Desktop notifications (T755)
  const notificationsEnabled = ref<boolean>(localStorage.getItem('notificationsEnabled') === 'true')

  /** Enable/disable desktop notifications for task status transitions. */
  async function setNotificationsEnabled(enabled: boolean): Promise<void> {
    if (enabled && Notification.permission !== 'granted') {
      const perm = await Notification.requestPermission()
      if (perm !== 'granted') return
    }
    notificationsEnabled.value = enabled
    localStorage.setItem('notificationsEnabled', String(enabled))
  }

  return {
    // Theme
    theme,
    setTheme,
    applyTheme,
    // Language
    language,
    setLanguage,
    // App info
    appInfo,
    // Auto-launch (T340)
    autoLaunchAgentSessions,
    setAutoLaunchAgentSessions,
    // Auto-review (T341)
    autoReviewEnabled,
    autoReviewThreshold,
    setAutoReviewEnabled,
    setAutoReviewThreshold,
    // Max file lines instruction (T899)
    maxFileLinesEnabled,
    maxFileLinesCount,
    setMaxFileLinesEnabled,
    setMaxFileLinesCount,
    // Desktop notifications (T755)
    notificationsEnabled,
    setNotificationsEnabled,
    // Default Claude instance (T857)
    defaultClaudeInstance,
    setDefaultClaudeInstance,
    defaultClaudeProfile,
    setDefaultClaudeProfile,
  }
})
