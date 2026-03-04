/**
 * Pinia store for application settings and configuration.
 *
 * Manages:
 * - Theme (dark/light mode)
 * - Language (fr/en)
 * - GitHub integration (token, repo URL)
 * - App info (version, name)
 * - CLAUDE.md sync status
 *
 * @module stores/settings
 */

import { defineStore } from 'pinia'
import { ref } from 'vue'
import i18n from '../plugins/i18n'
import { setDarkMode } from '../utils/agentColor'

export type Theme = 'dark' | 'light'
export type Language = 'fr' | 'en'

interface GitHubSettings {
  repoUrl: string
  owner: string
  repo: string
  connected: boolean
  lastCheck: string | null
}

interface AppInfo {
  version: string
  name: string
}

interface ClaudeMdInfo {
  projectCommit: string | null
  masterCommit: string | null
  needsUpdate: boolean
}

/**
 * Settings store using Pinia composition API.
 *
 * State:
 * - theme: Current theme ('dark' | 'light')
 * - language: UI language ('fr' | 'en')
 * - github: GitHub connection settings
 * - appInfo: Application metadata
 * - claudeMdInfo: CLAUDE.md sync status
 *
 * Actions:
 * - setTheme, applyTheme: Theme management
 * - setLanguage: Language switching
 * - setGitHubRepo: GitHub config
 * - setClaudeMdInfo: Update sync status
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

  // GitHub settings
  const github = ref<GitHubSettings>({
    repoUrl: localStorage.getItem('github_repo_url') || '',
    owner: '',
    repo: '',
    connected: false,
    lastCheck: localStorage.getItem('github_last_check') || null
  })

  /**
   * Parses and stores a GitHub repository URL.
   * Extracts owner and repo name from HTTPS or SSH URL formats.
   *
   * @param url - GitHub repository URL (e.g. https://github.com/owner/repo)
   * @returns {void}
   */
  function setGitHubRepo(url: string) {
    github.value.repoUrl = url
    localStorage.setItem('github_repo_url', url)
    // Parse owner/repo from URL
    const match = url.match(/github\.com[/:]([^/]+)\/([^/.]+)/)
    if (match) {
      github.value.owner = match[1]
      github.value.repo = match[2].replace(/\.git$/, '')
    }
  }

  /**
   * Updates GitHub connection status and persists the last check timestamp.
   *
   * @param connected - Whether the GitHub connection is active
   * @returns {void}
   */
  function setGitHubConnected(connected: boolean) {
    github.value.connected = connected
    if (connected) {
      github.value.lastCheck = new Date().toISOString()
      localStorage.setItem('github_last_check', github.value.lastCheck)
    }
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

  // CLAUDE.md sync
  const claudeMdInfo = ref<ClaudeMdInfo>({
    projectCommit: null,
    masterCommit: null,
    needsUpdate: false
  })

  /** @param info - Partial CLAUDE.md sync state to merge */
  function setClaudeMdInfo(info: Partial<ClaudeMdInfo>) {
    Object.assign(claudeMdInfo.value, info)
  }

  return {
    // Theme
    theme,
    setTheme,
    applyTheme,
    // Language
    language,
    setLanguage,
    // GitHub
    github,
    setGitHubRepo,
    setGitHubConnected,
    // App info
    appInfo,
    // CLAUDE.md
    claudeMdInfo,
    setClaudeMdInfo,
    // Auto-launch (T340)
    autoLaunchAgentSessions,
    setAutoLaunchAgentSessions,
    // Auto-review (T341)
    autoReviewEnabled,
    autoReviewThreshold,
    setAutoReviewEnabled,
    setAutoReviewThreshold,
    // Desktop notifications (T755)
    notificationsEnabled,
    setNotificationsEnabled,
  }
})
