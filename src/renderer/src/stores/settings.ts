import { defineStore } from 'pinia'
import { ref } from 'vue'

export type Theme = 'dark' | 'light'
export type Language = 'fr' | 'en'

interface GitHubSettings {
  token: string
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

export const useSettingsStore = defineStore('settings', () => {
  // Theme
  const theme = ref<Theme>((localStorage.getItem('theme') as Theme) || 'dark')

  function setTheme(t: Theme) {
    theme.value = t
    localStorage.setItem('theme', t)
    applyTheme(t)
  }

  function applyTheme(t: Theme) {
    if (t === 'dark') {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  }

  // Apply theme on load
  applyTheme(theme.value)

  // Language
  const language = ref<Language>((localStorage.getItem('language') as Language) || 'fr')

  function setLanguage(l: Language) {
    language.value = l
    localStorage.setItem('language', l)
  }

  // GitHub settings
  const github = ref<GitHubSettings>({
    token: localStorage.getItem('github_token') || '',
    repoUrl: localStorage.getItem('github_repo_url') || '',
    owner: '',
    repo: '',
    connected: false,
    lastCheck: localStorage.getItem('github_last_check') || null
  })

  function setGitHubToken(token: string) {
    github.value.token = token
    localStorage.setItem('github_token', token)
  }

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

  // CLAUDE.md sync
  const claudeMdInfo = ref<ClaudeMdInfo>({
    projectCommit: null,
    masterCommit: null,
    needsUpdate: false
  })

  function setClaudeMdInfo(info: Partial<ClaudeMdInfo>) {
    Object.assign(claudeMdInfo.value, info)
  }

  return {
    // Theme
    theme,
    setTheme,
    // Language
    language,
    setLanguage,
    // GitHub
    github,
    setGitHubToken,
    setGitHubRepo,
    setGitHubConnected,
    // App info
    appInfo,
    // CLAUDE.md
    claudeMdInfo,
    setClaudeMdInfo
  }
})
