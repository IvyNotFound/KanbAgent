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
import { ref, computed } from 'vue'
import i18n, { loadLocaleMessages } from '../plugins/i18n'
import type { AppLocale } from '../plugins/i18n'
import { setDarkMode } from '../utils/agentColor'
import { vuetifyThemeName } from '../plugins/vuetifyTheme'
import type { CliType, CliInstance } from '@shared/cli-types'
import type { CliModelDef } from '@shared/cli-models'
import { CLI_CAPABILITIES } from '../utils/cliCapabilities'

export type Theme = 'dark' | 'light'

/**
 * Parse stored defaultCliInstance key → { cli, distro }.
 * Backward compat: if no ':' separator, treat as distro-only (legacy format). (T1090)
 */
export function parseDefaultCliInstance(stored: string): { cli: string | null; distro: string } {
  const sep = stored.indexOf(':')
  if (sep === -1) return { cli: null, distro: stored }
  return { cli: stored.slice(0, sep), distro: stored.slice(sep + 1) }
}
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
   * Applies a theme via Vuetify's theme system.
   * Vuetify updates --v-theme-* CSS vars and data-v-theme attribute automatically.
   *
   * @param t - The theme to apply ('dark' | 'light')
   * @returns {void}
   */
  function applyTheme(t: Theme) {
    const dark = t === 'dark'
    vuetifyThemeName.value = t
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
  const RTL_LOCALES: Language[] = ['ar']

  async function setLanguage(l: Language) {
    await loadLocaleMessages(l as AppLocale)
    language.value = l
    localStorage.setItem('language', l)
    // Sync to vue-i18n global locale for hot-switching
    i18n.global.locale.value = l
    // Apply RTL direction for Arabic and other RTL locales
    document.documentElement.dir = RTL_LOCALES.includes(l) ? 'rtl' : 'ltr'
  }

  // Apply direction on load
  document.documentElement.dir = RTL_LOCALES.includes(language.value) ? 'rtl' : 'ltr'

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

  // Default CLI instance (T857, renamed T1032, T1090)
  const defaultCliInstance = ref<string>(
    localStorage.getItem('defaultCliInstance') || localStorage.getItem('defaultClaudeInstance') || ''
  )
  function setDefaultCliInstance(cli: string, distro: string) {
    const key = cli ? `${cli}:${distro}` : distro
    defaultCliInstance.value = key
    localStorage.setItem('defaultCliInstance', key)
    localStorage.removeItem('defaultClaudeInstance') // cleanup legacy key (T1044)
  }

  // Max file lines instruction (T899) — default true for new installs (T1898)
  const maxFileLinesEnabled = ref<boolean>(localStorage.getItem('maxFileLinesEnabled') !== 'false')
  const maxFileLinesCount = ref<number>(parseInt(localStorage.getItem('maxFileLinesCount') ?? '400', 10) || 400)

  /** Push current maxFileLines config to the main process hookServer (T1898). */
  function syncMaxFileLinesToMain() {
    window.electronAPI?.updateMaxFileLines?.(maxFileLinesEnabled.value, maxFileLinesCount.value)
  }

  function setMaxFileLinesEnabled(enabled: boolean) {
    maxFileLinesEnabled.value = enabled
    localStorage.setItem('maxFileLinesEnabled', String(enabled))
    syncMaxFileLinesToMain()
  }

  function setMaxFileLinesCount(n: number) {
    const clamped = Math.max(50, Math.min(10000, n))
    maxFileLinesCount.value = clamped
    localStorage.setItem('maxFileLinesCount', String(clamped))
    syncMaxFileLinesToMain()
  }

  // Push initial config to main on store creation (T1898)
  syncMaxFileLinesToMain()

  // AI Coding Assistants — enabled CLIs + detection cache (T1013)
  const enabledClis = ref<CliType[]>(
    JSON.parse(localStorage.getItem('enabledClis') || '[]') as CliType[]
  )
  const allCliInstances = ref<CliInstance[]>([])
  const detectingClis = ref(false)

  // T1918: Project primary CLI from DB config (set by T1912 init-new-project)
  const projectPrimaryCli = ref<CliType | null>(null)

  /** Load primary_cli from DB config. Must be called after project is set. */
  async function loadPrimaryCli(dbPath: string): Promise<void> {
    try {
      const result = await window.electronAPI.getConfigValue(dbPath, 'primary_cli')
      if (result.success && result.value) {
        projectPrimaryCli.value = result.value as CliType
      } else {
        projectPrimaryCli.value = null
      }
    } catch { projectPrimaryCli.value = null }
  }

  /**
   * Resolved primary CLI for the current project (T1918).
   * Cascade: project config primary_cli → first enabled CLI → 'claude' (ultimate fallback).
   */
  const primaryCli = computed<CliType>(() => {
    if (projectPrimaryCli.value) return projectPrimaryCli.value
    if (enabledClis.value.length > 0) return enabledClis.value[0]
    return 'claude'
  })

  function toggleCli(cli: CliType) {
    const current = enabledClis.value
    if (current.includes(cli)) {
      enabledClis.value = current.filter(c => c !== cli)
    } else {
      enabledClis.value = [...current, cli]
    }
    localStorage.setItem('enabledClis', JSON.stringify(enabledClis.value))
  }

  async function refreshCliDetection(forceRefresh = false): Promise<void> {
    detectingClis.value = true
    try {
      const raw = await window.electronAPI.getCliInstances(undefined, forceRefresh) as CliInstance[]
      allCliInstances.value = raw
    } catch {
      allCliInstances.value = []
    } finally {
      detectingClis.value = false
    }
  }

  // Worktree isolation default (T1143)
  const worktreeDefault = ref<boolean>(true)

  /** Load worktreeDefault from DB config. Must be called after project is set. */
  async function loadWorktreeDefault(dbPath: string): Promise<void> {
    try {
      const result = await window.electronAPI.getConfigValue(dbPath, 'worktree_default')
      if (result.success && result.value !== null) {
        worktreeDefault.value = result.value !== '0'
      }
    } catch { /* keep default true */ }
  }

  /** Persist worktreeDefault to DB config. Rolls back on IPC failure. */
  async function setWorktreeDefault(dbPath: string, enabled: boolean): Promise<void> {
    const prev = worktreeDefault.value
    worktreeDefault.value = enabled
    try {
      await window.electronAPI.setConfigValue(dbPath, 'worktree_default', enabled ? '1' : '0')
    } catch {
      worktreeDefault.value = prev
    }
  }

  // Per-CLI default models (T1803, replaces T1362 opencode-only)
  const defaultModels = ref<Partial<Record<CliType, string>>>({})
  const cliModels = ref<Partial<Record<CliType, CliModelDef[]>>>({})

  /** Load default models for all model-capable CLIs from DB config. */
  async function loadDefaultModels(dbPath: string): Promise<void> {
    const modelClis = enabledClis.value.filter(c => CLI_CAPABILITIES[c]?.modelSelection)
    await Promise.all(modelClis.map(async (cli) => {
      try {
        const result = await window.electronAPI.getConfigValue(dbPath, `default_model_${cli}`)
        if (result.success && result.value) {
          defaultModels.value = { ...defaultModels.value, [cli]: result.value }
          return
        }
        // Backward compat: migrate opencode_default_model → default_model_opencode
        if (cli === 'opencode') {
          const legacy = await window.electronAPI.getConfigValue(dbPath, 'opencode_default_model')
          if (legacy.success && legacy.value) {
            defaultModels.value = { ...defaultModels.value, opencode: legacy.value }
            await window.electronAPI.setConfigValue(dbPath, 'default_model_opencode', legacy.value)
          }
        }
      } catch { /* keep empty */ }
    }))
  }

  function getDefaultModel(cli: CliType): string {
    return defaultModels.value[cli] ?? ''
  }

  async function setDefaultModel(dbPath: string, cli: CliType, value: string): Promise<void> {
    const trimmed = value.trim()
    const prev = defaultModels.value[cli] ?? ''
    defaultModels.value = { ...defaultModels.value, [cli]: trimmed }
    try {
      await window.electronAPI.setConfigValue(dbPath, `default_model_${cli}`, trimmed)
    } catch {
      defaultModels.value = { ...defaultModels.value, [cli]: prev }
    }
  }

  /** Fetch available model lists from IPC for all model-capable CLIs. */
  async function loadCliModels(): Promise<void> {
    try {
      const raw = await window.electronAPI.getCliModels() as Partial<Record<CliType, CliModelDef[]>>
      if (raw && typeof raw === 'object') {
        cliModels.value = raw
      }
    } catch { /* keep empty */ }
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
    // AI Coding Assistants (T1013)
    enabledClis,
    allCliInstances,
    detectingClis,
    toggleCli,
    refreshCliDetection,
    // Project primary CLI (T1918)
    projectPrimaryCli,
    primaryCli,
    loadPrimaryCli,
    // Desktop notifications (T755)
    notificationsEnabled,
    setNotificationsEnabled,
    // Default CLI instance (T857, renamed T1032)
    defaultCliInstance,
    setDefaultCliInstance,
    // Worktree isolation default (T1143)
    worktreeDefault,
    loadWorktreeDefault,
    setWorktreeDefault,
    // Per-CLI default models (T1803)
    defaultModels,
    cliModels,
    loadDefaultModels,
    getDefaultModel,
    setDefaultModel,
    loadCliModels,
  }
})
