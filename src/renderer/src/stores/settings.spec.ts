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


describe('stores/settings — maxFileLinesEnabled (T899)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
    document.documentElement.className = ''
  })

  it('should default to false', () => {
    const store = useSettingsStore()
    expect(store.maxFileLinesEnabled).toBe(false)
  })

  it('should persist enabled state to localStorage', () => {
    const store = useSettingsStore()
    store.setMaxFileLinesEnabled(true)
    expect(store.maxFileLinesEnabled).toBe(true)
    expect(localStorage.getItem('maxFileLinesEnabled')).toBe('true')
  })

  it('should persist disabled state to localStorage', () => {
    const store = useSettingsStore()
    store.setMaxFileLinesEnabled(true)
    store.setMaxFileLinesEnabled(false)
    expect(store.maxFileLinesEnabled).toBe(false)
    expect(localStorage.getItem('maxFileLinesEnabled')).toBe('false')
  })

  it('should read stored value on init', () => {
    localStorage.setItem('maxFileLinesEnabled', 'true')
    const store = useSettingsStore()
    expect(store.maxFileLinesEnabled).toBe(true)
  })
})


describe('stores/settings — maxFileLinesCount (T899)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
    document.documentElement.className = ''
  })

  it('should default to 400', () => {
    const store = useSettingsStore()
    expect(store.maxFileLinesCount).toBe(400)
  })

  it('should persist count to localStorage', () => {
    const store = useSettingsStore()
    store.setMaxFileLinesCount(600)
    expect(store.maxFileLinesCount).toBe(600)
    expect(localStorage.getItem('maxFileLinesCount')).toBe('600')
  })

  it('should clamp minimum to 50', () => {
    const store = useSettingsStore()
    store.setMaxFileLinesCount(10)
    expect(store.maxFileLinesCount).toBe(50)
    expect(localStorage.getItem('maxFileLinesCount')).toBe('50')
  })

  it('should clamp maximum to 10000', () => {
    const store = useSettingsStore()
    store.setMaxFileLinesCount(99999)
    expect(store.maxFileLinesCount).toBe(10000)
    expect(localStorage.getItem('maxFileLinesCount')).toBe('10000')
  })

  it('should read stored value on init', () => {
    localStorage.setItem('maxFileLinesCount', '250')
    const store = useSettingsStore()
    expect(store.maxFileLinesCount).toBe(250)
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

describe('stores/settings — defaultCliInstance (T857, T1032)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
    document.documentElement.className = ''
  })

  it('should default to empty string', () => {
    const store = useSettingsStore()
    expect(store.defaultCliInstance).toBe('')
  })

  it('should persist distro to localStorage', () => {
    const store = useSettingsStore()
    store.setDefaultCliInstance('Ubuntu-24.04')
    expect(store.defaultCliInstance).toBe('Ubuntu-24.04')
    expect(localStorage.getItem('defaultCliInstance')).toBe('Ubuntu-24.04')
  })

  it('should read stored value on init', () => {
    localStorage.setItem('defaultCliInstance', 'Debian')
    const store = useSettingsStore()
    expect(store.defaultCliInstance).toBe('Debian')
  })

  it('should fallback to legacy defaultClaudeInstance key', () => {
    localStorage.setItem('defaultClaudeInstance', 'Arch')
    const store = useSettingsStore()
    expect(store.defaultCliInstance).toBe('Arch')
  })
})

describe('stores/settings — defaultClaudeProfile (T857)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
    document.documentElement.className = ''
  })

  it('should default to "claude"', () => {
    const store = useSettingsStore()
    expect(store.defaultClaudeProfile).toBe('claude')
  })

  it('should persist profile to localStorage', () => {
    const store = useSettingsStore()
    store.setDefaultClaudeProfile('claude-work')
    expect(store.defaultClaudeProfile).toBe('claude-work')
    expect(localStorage.getItem('defaultClaudeProfile')).toBe('claude-work')
  })

  it('should read stored value on init', () => {
    localStorage.setItem('defaultClaudeProfile', 'claude-beta')
    const store = useSettingsStore()
    expect(store.defaultClaudeProfile).toBe('claude-beta')
  })
})

