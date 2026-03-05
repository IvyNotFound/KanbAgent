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


import { useProjectStore } from '@renderer/stores/project'


describe('stores/project — setProjectPathOnly (T838)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('updates projectPath ref', () => {
    const store = useProjectStore()
    store.setProjectPathOnly('/new/path')
    expect(store.projectPath).toBe('/new/path')
  })

  it('persists to localStorage', () => {
    const store = useProjectStore()
    store.setProjectPathOnly('/persisted/path')
    expect(localStorage.getItem('projectPath')).toBe('/persisted/path')
  })

  it('does not change dbPath', () => {
    localStorage.setItem('dbPath', '/original/db.sqlite')
    const store = useProjectStore()
    store.setProjectPathOnly('/new/path')
    expect(store.dbPath).toBe('/original/db.sqlite')
  })
})


describe('stores/project — closeWizard (T838)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('resets setupWizardTarget to null', () => {
    const store = useProjectStore()
    store.setupWizardTarget = { projectPath: '/some/path', hasCLAUDEmd: true }
    store.closeWizard()
    expect(store.setupWizardTarget).toBeNull()
  })

  it('is a no-op when setupWizardTarget is already null', () => {
    const store = useProjectStore()
    expect(store.setupWizardTarget).toBeNull()
    store.closeWizard()
    expect(store.setupWizardTarget).toBeNull()
  })
})

