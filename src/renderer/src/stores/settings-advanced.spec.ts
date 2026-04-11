import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useSettingsStore, parseDefaultCliInstance } from '@renderer/stores/settings'

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
  getConfigValue: vi.fn().mockResolvedValue({ success: true, value: null }),
  setConfigValue: vi.fn().mockResolvedValue({ success: true }),
}

Object.defineProperty(window, 'electronAPI', {
  value: mockElectronAPI,
  writable: true,
})


describe('stores/settings — language init from localStorage', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
    document.documentElement.className = ''
  })

  it('should default to "fr" when localStorage is empty', () => {
    const store = useSettingsStore()
    expect(store.language).toBe('fr')
  })

  it('should init language to "en" when localStorage has "en"', () => {
    localStorage.setItem('language', 'en')
    const store = useSettingsStore()
    expect(store.language).toBe('en')
  })

  it('should init language to "fr" when localStorage has "fr"', () => {
    localStorage.setItem('language', 'fr')
    const store = useSettingsStore()
    expect(store.language).toBe('fr')
  })

  it('should init language to "de" when localStorage has "de"', () => {
    localStorage.setItem('language', 'de')
    const store = useSettingsStore()
    expect(store.language).toBe('de')
  })

  it('setLanguage persists and updates store', async () => {
    const store = useSettingsStore()
    await store.setLanguage('en')
    expect(store.language).toBe('en')
    expect(localStorage.getItem('language')).toBe('en')
  })

  it('setLanguage("ar") sets document dir to rtl', async () => {
    const store = useSettingsStore()
    await store.setLanguage('ar')
    expect(document.documentElement.dir).toBe('rtl')
  })

  it('setLanguage("fr") sets document dir to ltr', async () => {
    const store = useSettingsStore()
    await store.setLanguage('fr')
    expect(document.documentElement.dir).toBe('ltr')
  })
})


describe('stores/settings — notificationsEnabled (T755)', () => {
  const mockRequestPermission = vi.fn().mockResolvedValue('granted')

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
    document.documentElement.className = ''
    if (typeof (global as Record<string, unknown>)['Notification'] === 'undefined') {
      ;(global as Record<string, unknown>)['Notification'] = {
        permission: 'granted',
        requestPermission: mockRequestPermission,
      }
    }
    mockRequestPermission.mockResolvedValue('granted')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should default to false when localStorage is empty', () => {
    const store = useSettingsStore()
    expect(store.notificationsEnabled).toBe(false)
  })

  it('should NOT default to true (guard against BooleanLiteral mutation)', () => {
    const store = useSettingsStore()
    expect(store.notificationsEnabled).toBe(false)
  })

  it('should read true from localStorage when set to "true"', () => {
    localStorage.setItem('notificationsEnabled', 'true')
    const store = useSettingsStore()
    expect(store.notificationsEnabled).toBe(true)
  })

  it('should remain false when localStorage has "false"', () => {
    localStorage.setItem('notificationsEnabled', 'false')
    const store = useSettingsStore()
    expect(store.notificationsEnabled).toBe(false)
  })

  it('setNotificationsEnabled(true) with granted permission enables notifications', async () => {
    ;(global as Record<string, unknown>)['Notification'] = {
      permission: 'granted',
      requestPermission: mockRequestPermission,
    }
    const store = useSettingsStore()
    await store.setNotificationsEnabled(true)
    expect(store.notificationsEnabled).toBe(true)
    expect(localStorage.getItem('notificationsEnabled')).toBe('true')
  })

  it('setNotificationsEnabled(false) disables without permission check', async () => {
    ;(global as Record<string, unknown>)['Notification'] = {
      permission: 'granted',
      requestPermission: mockRequestPermission,
    }
    const store = useSettingsStore()
    await store.setNotificationsEnabled(true)
    await store.setNotificationsEnabled(false)
    expect(store.notificationsEnabled).toBe(false)
    expect(localStorage.getItem('notificationsEnabled')).toBe('false')
  })

  it('setNotificationsEnabled(true) does NOT enable when permission denied', async () => {
    mockRequestPermission.mockResolvedValue('denied')
    ;(global as Record<string, unknown>)['Notification'] = {
      permission: 'default',
      requestPermission: mockRequestPermission,
    }
    const store = useSettingsStore()
    await store.setNotificationsEnabled(true)
    expect(store.notificationsEnabled).toBe(false)
  })
})


describe('stores/settings — enabledClis (T1013)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
    document.documentElement.className = ''
  })

  it('should default to [] when localStorage is empty', () => {
    const store = useSettingsStore()
    expect(store.enabledClis).toEqual([])
  })

  it('toggleCli adds a cli if not present', () => {
    const store = useSettingsStore()
    store.toggleCli('gemini' as 'claude')
    expect(store.enabledClis).toContain('gemini')
  })

  it('toggleCli removes a cli if already present', () => {
    const store = useSettingsStore()
    store.toggleCli('claude')
    // First toggle on empty adds it, second toggle removes it
    store.toggleCli('claude')
    expect(store.enabledClis).not.toContain('claude')
  })

  it('toggleCli persists to localStorage', () => {
    const store = useSettingsStore()
    store.toggleCli('codex' as 'claude')
    const stored = JSON.parse(localStorage.getItem('enabledClis') || '[]') as string[]
    expect(stored).toContain('codex')
  })
})

// ── parseDefaultCliInstance (T1090) ───────────────────────────────────────────

describe('parseDefaultCliInstance', () => {
  it('returns empty distro and null cli for empty string', () => {
    expect(parseDefaultCliInstance('')).toEqual({ cli: null, distro: '' })
  })

  it('returns distro-only with null cli for legacy format (no colon)', () => {
    expect(parseDefaultCliInstance('Ubuntu')).toEqual({ cli: null, distro: 'Ubuntu' })
  })

  it('parses cli:distro format correctly', () => {
    expect(parseDefaultCliInstance('claude:Ubuntu')).toEqual({ cli: 'claude', distro: 'Ubuntu' })
  })

  it('parses cli:local format correctly', () => {
    expect(parseDefaultCliInstance('codex:local')).toEqual({ cli: 'codex', distro: 'local' })
  })

  it('handles distro with colons (e.g. Ubuntu-24.04 edge case)', () => {
    // Distro names should not contain colons, but we only split on the first colon
    expect(parseDefaultCliInstance('claude:Ubuntu-24.04')).toEqual({ cli: 'claude', distro: 'Ubuntu-24.04' })
  })
})

// ── setDefaultCliInstance (T1090) ─────────────────────────────────────────────

describe('stores/settings — setDefaultCliInstance (T1090)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('stores cli:distro key', () => {
    const store = useSettingsStore()
    store.setDefaultCliInstance('claude', 'Ubuntu')
    expect(store.defaultCliInstance).toBe('claude:Ubuntu')
    expect(localStorage.getItem('defaultCliInstance')).toBe('claude:Ubuntu')
  })

  it('stores cli:local for local instance', () => {
    const store = useSettingsStore()
    store.setDefaultCliInstance('codex', 'local')
    expect(store.defaultCliInstance).toBe('codex:local')
  })

  it('removes legacy defaultClaudeInstance key on save', () => {
    localStorage.setItem('defaultClaudeInstance', 'Ubuntu')
    const store = useSettingsStore()
    store.setDefaultCliInstance('claude', 'Ubuntu')
    expect(localStorage.getItem('defaultClaudeInstance')).toBeNull()
  })
})


describe('stores/settings — setWorktreeDefault rollback (T1147)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
    document.documentElement.className = ''
  })

  it('should update ref on successful IPC call', async () => {
    mockElectronAPI.setConfigValue.mockResolvedValue({ success: true })
    const store = useSettingsStore()
    expect(store.worktreeDefault).toBe(true)
    await store.setWorktreeDefault('/fake/db', false)
    expect(store.worktreeDefault).toBe(false)
  })

  it('should rollback ref when IPC call throws', async () => {
    mockElectronAPI.setConfigValue.mockRejectedValue(new Error('IPC failed'))
    const store = useSettingsStore()
    expect(store.worktreeDefault).toBe(true)
    await store.setWorktreeDefault('/fake/db', false)
    expect(store.worktreeDefault).toBe(true)
  })

  it('should rollback to false when IPC fails after setting true', async () => {
    mockElectronAPI.setConfigValue
      .mockResolvedValueOnce({ success: true })
      .mockRejectedValueOnce(new Error('IPC failed'))
    const store = useSettingsStore()
    await store.setWorktreeDefault('/fake/db', false)
    expect(store.worktreeDefault).toBe(false)
    await store.setWorktreeDefault('/fake/db', true)
    expect(store.worktreeDefault).toBe(false)
  })
})
