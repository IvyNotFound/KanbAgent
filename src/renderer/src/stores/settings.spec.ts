import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { nextTick } from 'vue'
import { useTasksStore } from '@renderer/stores/tasks'
import { useTabsStore } from '@renderer/stores/tabs'
import { useSettingsStore } from '@renderer/stores/settings'

// Mock window.electronAPI
const mockElectronAPI = {
  queryDb: vi.fn().mockResolvedValue([]),
  watchDb: vi.fn().mockResolvedValue(undefined),
  unwatchDb: vi.fn().mockResolvedValue(undefined),
  onDbChanged: vi.fn().mockReturnValue(() => {}),
  selectProjectDir: vi.fn().mockResolvedValue(null),
  showConfirmDialog: vi.fn().mockResolvedValue(true),
  migrateDb: vi.fn().mockResolvedValue({ success: true }),
  terminalKill: vi.fn(),
  findProjectDb: vi.fn().mockResolvedValue(null),
  getTaskLinks: vi.fn().mockResolvedValue({ success: true, links: [] }),
  getTaskAssignees: vi.fn().mockResolvedValue({ success: true, assignees: [] }),
  agentGroupsList: vi.fn().mockResolvedValue({ success: true, groups: [] }),
  agentGroupsCreate: vi.fn().mockResolvedValue({ success: true, group: { id: 1, name: 'New Group', sort_order: 0, created_at: '' } }),
  agentGroupsRename: vi.fn().mockResolvedValue({ success: true }),
  agentGroupsDelete: vi.fn().mockResolvedValue({ success: true }),
  agentGroupsSetMember: vi.fn().mockResolvedValue({ success: true }),
  agentKill: vi.fn(),
}

Object.defineProperty(window, 'electronAPI', {
  value: mockElectronAPI,
  writable: true,
})


describe('stores/settings', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
    // Reset document class
    document.documentElement.className = ''
  })

  describe('setTheme', () => {
    it('should set theme to dark', () => {
      const store = useSettingsStore()

      store.setTheme('dark')

      expect(store.theme).toBe('dark')
      expect(localStorage.getItem('theme')).toBe('dark')
      expect(document.documentElement.classList.contains('dark')).toBe(true)
    })

    it('should set theme to light', () => {
      const store = useSettingsStore()

      store.setTheme('light')

      expect(store.theme).toBe('light')
      expect(localStorage.getItem('theme')).toBe('light')
      expect(document.documentElement.classList.contains('dark')).toBe(false)
    })
  })

  describe('applyTheme', () => {
    it('should add dark class for dark theme', () => {
      const store = useSettingsStore()

      store.applyTheme('dark')

      expect(document.documentElement.classList.contains('dark')).toBe(true)
    })

    it('should remove dark class for light theme', () => {
      document.documentElement.classList.add('dark')
      const store = useSettingsStore()

      store.applyTheme('light')

      expect(document.documentElement.classList.contains('dark')).toBe(false)
    })
  })

  describe('setLanguage', () => {
    it('should set language to fr', () => {
      const store = useSettingsStore()

      store.setLanguage('fr')

      expect(store.language).toBe('fr')
      expect(localStorage.getItem('language')).toBe('fr')
    })

    it('should set language to en', () => {
      const store = useSettingsStore()

      store.setLanguage('en')

      expect(store.language).toBe('en')
      expect(localStorage.getItem('language')).toBe('en')
    })
  })

  describe('setGitHubRepo', () => {
    it('should parse owner and repo from HTTPS URL', () => {
      const store = useSettingsStore()

      store.setGitHubRepo('https://github.com/owner/repo')

      expect(store.github.owner).toBe('owner')
      expect(store.github.repo).toBe('repo')
      expect(store.github.repoUrl).toBe('https://github.com/owner/repo')
    })

    it('should parse owner and repo from SSH URL', () => {
      const store = useSettingsStore()

      store.setGitHubRepo('git@github.com:owner/repo.git')

      expect(store.github.owner).toBe('owner')
      expect(store.github.repo).toBe('repo')
    })

    it('should remove .git suffix', () => {
      const store = useSettingsStore()

      store.setGitHubRepo('https://github.com/owner/repo.git')

      expect(store.github.repo).toBe('repo')
    })

    it('should handle invalid URL gracefully', () => {
      const store = useSettingsStore()

      store.setGitHubRepo('invalid-url')

      expect(store.github.owner).toBe('')
      expect(store.github.repo).toBe('')
    })
  })

  describe('setGitHubConnected', () => {
    it('should set connected to true and update lastCheck', () => {
      const store = useSettingsStore()
      store.setGitHubConnected(true)

      expect(store.github.connected).toBe(true)
      expect(store.github.lastCheck).not.toBeNull()
    })

    it('should set connected to false without updating lastCheck', () => {
      const store = useSettingsStore()
      store.setGitHubConnected(true)
      const lastCheck = store.github.lastCheck

      store.setGitHubConnected(false)

      expect(store.github.connected).toBe(false)
      // lastCheck should not change when disconnecting
      expect(store.github.lastCheck).toBe(lastCheck)
    })
  })

  describe('setClaudeMdInfo', () => {
    it('should update claudeMdInfo fields partially', () => {
      const store = useSettingsStore()

      store.setClaudeMdInfo({ sha: 'abc123', hasUpdate: true })

      expect(store.claudeMdInfo.sha).toBe('abc123')
      expect(store.claudeMdInfo.hasUpdate).toBe(true)
    })

    it('should not crash with empty object', () => {
      const store = useSettingsStore()
      expect(() => store.setClaudeMdInfo({})).not.toThrow()
    })

    it('should merge partial updates without losing existing fields', () => {
      const store = useSettingsStore()
      store.setClaudeMdInfo({ sha: 'abc', hasUpdate: false })
      store.setClaudeMdInfo({ hasUpdate: true })

      // sha should be preserved, hasUpdate updated
      expect(store.claudeMdInfo.sha).toBe('abc')
      expect(store.claudeMdInfo.hasUpdate).toBe(true)
    })
  })
})


describe('stores/settings — autoLaunchAgentSessions', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
    document.documentElement.className = ''
  })

  it('should default to true', () => {
    const store = useSettingsStore()
    expect(store.autoLaunchAgentSessions).toBe(true)
  })

  it('should persist false to localStorage', () => {
    const store = useSettingsStore()
    store.setAutoLaunchAgentSessions(false)

    expect(store.autoLaunchAgentSessions).toBe(false)
    expect(localStorage.getItem('autoLaunchAgentSessions')).toBe('false')
  })

  it('should persist true to localStorage', () => {
    const store = useSettingsStore()
    store.setAutoLaunchAgentSessions(false)
    store.setAutoLaunchAgentSessions(true)

    expect(store.autoLaunchAgentSessions).toBe(true)
    expect(localStorage.getItem('autoLaunchAgentSessions')).toBe('true')
  })

  it('should read false from localStorage on init', () => {
    localStorage.setItem('autoLaunchAgentSessions', 'false')
    const store = useSettingsStore()

    expect(store.autoLaunchAgentSessions).toBe(false)
  })
})


describe('stores/settings — autoReviewEnabled', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
    document.documentElement.className = ''
  })

  it('should default to true', () => {
    const store = useSettingsStore()
    expect(store.autoReviewEnabled).toBe(true)
  })

  it('should persist enabled state', () => {
    const store = useSettingsStore()
    store.setAutoReviewEnabled(false)

    expect(store.autoReviewEnabled).toBe(false)
    expect(localStorage.getItem('autoReviewEnabled')).toBe('false')
  })
})


describe('stores/settings — autoReviewThreshold', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
    document.documentElement.className = ''
  })

  it('should default to 10', () => {
    const store = useSettingsStore()
    expect(store.autoReviewThreshold).toBe(10)
  })

  it('should clamp minimum to 3', () => {
    const store = useSettingsStore()
    store.setAutoReviewThreshold(1)

    expect(store.autoReviewThreshold).toBe(3)
    expect(localStorage.getItem('autoReviewThreshold')).toBe('3')
  })

  it('should accept values >= 3', () => {
    const store = useSettingsStore()
    store.setAutoReviewThreshold(5)

    expect(store.autoReviewThreshold).toBe(5)
  })

  it('should read from localStorage on init', () => {
    localStorage.setItem('autoReviewThreshold', '15')
    const store = useSettingsStore()

    expect(store.autoReviewThreshold).toBe(15)
  })

  it('should clamp invalid localStorage value to minimum', () => {
    localStorage.setItem('autoReviewThreshold', '1')
    const store = useSettingsStore()

    expect(store.autoReviewThreshold).toBe(3)
  })
})


describe('stores/settings — appInfo', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
    document.documentElement.className = ''
  })

  it('should have default name "Agent Viewer"', () => {
    const store = useSettingsStore()
    expect(store.appInfo.name).toBe('Agent Viewer')
  })

  it('should have a version string', () => {
    const store = useSettingsStore()
    expect(typeof store.appInfo.version).toBe('string')
    expect(store.appInfo.version.length).toBeGreaterThan(0)
  })
})

