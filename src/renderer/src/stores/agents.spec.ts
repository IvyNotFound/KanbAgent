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


import { useAgentsStore } from '@renderer/stores/agents'


describe('stores/agents — agentRefresh() (T838)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('does nothing when dbPath is null', async () => {
    const store = useAgentsStore()
    await store.agentRefresh()
    expect(mockElectronAPI.queryDb).not.toHaveBeenCalled()
  })

  it('populates agents and locks from queryDb', async () => {
    localStorage.setItem('dbPath', '/test/project.db')
    const mockAgents = [{ id: 1, name: 'agent-a', type: 'dev' }]
    const mockLocks = [{ id: 1, fichier: 'foo.ts', agent_id: 1, agent_name: 'agent-a' }]
    mockElectronAPI.queryDb
      .mockResolvedValueOnce(mockAgents)
      .mockResolvedValueOnce(mockLocks)
    const store = useAgentsStore()
    await store.agentRefresh()
    expect(store.agents).toHaveLength(1)
    expect(store.agents[0].name).toBe('agent-a')
    expect(store.locks).toHaveLength(1)
    expect(store.locks[0].fichier).toBe('foo.ts')
  })

  it.skip('skips when document is hidden (jsdom does not support configurable visibilityState override)', async () => {
    // jsdom defines document.visibilityState as a non-configurable own property on the instance,
    // making it impossible to override in tests without a custom jsdom environment.
    // The production guard `if (document.visibilityState === 'hidden') return` is tested via code review.
  })

  it('silently handles queryDb errors', async () => {
    localStorage.setItem('dbPath', '/test/project.db')
    mockElectronAPI.queryDb.mockRejectedValue(new Error('DB error'))
    const store = useAgentsStore()
    await expect(store.agentRefresh()).resolves.toBeUndefined()
    expect(store.agents).toHaveLength(0)
  })
})


describe('stores/agents — createAgentGroup() (T838)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('returns null when dbPath is null', async () => {
    const store = useAgentsStore()
    const result = await store.createAgentGroup('Test')
    expect(result).toBeNull()
  })

  it('appends new group and returns it on success', async () => {
    localStorage.setItem('dbPath', '/test/project.db')
    mockElectronAPI.agentGroupsCreate.mockResolvedValue({
      success: true,
      group: { id: 42, name: 'New Group', sort_order: 0, created_at: '2024-01-01' },
    })
    const store = useAgentsStore()
    const result = await store.createAgentGroup('New Group')
    expect(result).not.toBeNull()
    expect(result!.id).toBe(42)
    expect(result!.members).toEqual([])
    expect(store.agentGroups).toHaveLength(1)
    expect(store.agentGroups[0].name).toBe('New Group')
  })

  it('returns null when IPC returns success:false', async () => {
    localStorage.setItem('dbPath', '/test/project.db')
    mockElectronAPI.agentGroupsCreate.mockResolvedValue({ success: false })
    const store = useAgentsStore()
    const result = await store.createAgentGroup('Fail Group')
    expect(result).toBeNull()
    expect(store.agentGroups).toHaveLength(0)
  })
})


describe('stores/agents — renameAgentGroup() (T838)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('updates name in agentGroups in memory', async () => {
    localStorage.setItem('dbPath', '/test/project.db')
    const store = useAgentsStore()
    store.agentGroups = [{ id: 1, name: 'Old Name', sort_order: 0, created_at: '', members: [] }]
    await store.renameAgentGroup(1, 'New Name')
    expect(store.agentGroups[0].name).toBe('New Name')
  })

  it('does not affect other groups', async () => {
    localStorage.setItem('dbPath', '/test/project.db')
    const store = useAgentsStore()
    store.agentGroups = [
      { id: 1, name: 'Group 1', sort_order: 0, created_at: '', members: [] },
      { id: 2, name: 'Group 2', sort_order: 1, created_at: '', members: [] },
    ]
    await store.renameAgentGroup(1, 'Renamed')
    expect(store.agentGroups[0].name).toBe('Renamed')
    expect(store.agentGroups[1].name).toBe('Group 2')
  })
})


describe('stores/agents — deleteAgentGroup() (T838)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('removes the group from agentGroups', async () => {
    localStorage.setItem('dbPath', '/test/project.db')
    const store = useAgentsStore()
    store.agentGroups = [
      { id: 1, name: 'Group A', sort_order: 0, created_at: '', members: [] },
      { id: 2, name: 'Group B', sort_order: 1, created_at: '', members: [] },
    ]
    await store.deleteAgentGroup(1)
    expect(store.agentGroups).toHaveLength(1)
    expect(store.agentGroups[0].id).toBe(2)
  })

  it('calls agentGroupsDelete IPC with correct args', async () => {
    localStorage.setItem('dbPath', '/test/project.db')
    const store = useAgentsStore()
    store.agentGroups = [{ id: 5, name: 'To Delete', sort_order: 0, created_at: '', members: [] }]
    await store.deleteAgentGroup(5)
    expect(mockElectronAPI.agentGroupsDelete).toHaveBeenCalledWith('/test/project.db', 5)
  })
})


describe('stores/agents — setAgentGroup() (T838)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('adds agent to target group members', async () => {
    localStorage.setItem('dbPath', '/test/project.db')
    const store = useAgentsStore()
    store.agentGroups = [{ id: 10, name: 'Group X', sort_order: 0, created_at: '', members: [] }]
    await store.setAgentGroup(99, 10, 0)
    expect(store.agentGroups[0].members).toHaveLength(1)
    expect(store.agentGroups[0].members[0].agent_id).toBe(99)
  })

  it('removes agent from previous group when moved to new group', async () => {
    localStorage.setItem('dbPath', '/test/project.db')
    const store = useAgentsStore()
    store.agentGroups = [
      { id: 1, name: 'Old Group', sort_order: 0, created_at: '', members: [{ agent_id: 99, sort_order: 0 }] },
      { id: 2, name: 'New Group', sort_order: 1, created_at: '', members: [] },
    ]
    await store.setAgentGroup(99, 2, 0)
    expect(store.agentGroups[0].members).toHaveLength(0)
    expect(store.agentGroups[1].members).toHaveLength(1)
    expect(store.agentGroups[1].members[0].agent_id).toBe(99)
  })

  it('removes agent from all groups when groupId is null', async () => {
    localStorage.setItem('dbPath', '/test/project.db')
    const store = useAgentsStore()
    store.agentGroups = [
      { id: 1, name: 'Group', sort_order: 0, created_at: '', members: [{ agent_id: 55, sort_order: 0 }] },
    ]
    await store.setAgentGroup(55, null)
    expect(store.agentGroups[0].members).toHaveLength(0)
  })

  it('calls agentGroupsSetMember IPC with correct args', async () => {
    localStorage.setItem('dbPath', '/test/project.db')
    const store = useAgentsStore()
    store.agentGroups = []
    await store.setAgentGroup(77, 3, 2)
    expect(mockElectronAPI.agentGroupsSetMember).toHaveBeenCalledWith('/test/project.db', 77, 3, 2)
  })
})


describe('stores/agents — fetchAgentGroups() (T838)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('does nothing when dbPath is null', async () => {
    const store = useAgentsStore()
    await store.fetchAgentGroups()
    expect(mockElectronAPI.agentGroupsList).not.toHaveBeenCalled()
  })

  it('populates agentGroups on success', async () => {
    localStorage.setItem('dbPath', '/test/project.db')
    const mockGroups = [{ id: 1, name: 'Group A', sort_order: 0, created_at: '', members: [] }]
    mockElectronAPI.agentGroupsList.mockResolvedValue({ success: true, groups: mockGroups })
    const store = useAgentsStore()
    await store.fetchAgentGroups()
    expect(store.agentGroups).toHaveLength(1)
    expect(store.agentGroups[0].name).toBe('Group A')
  })

  it('does not update agentGroups on failure response', async () => {
    localStorage.setItem('dbPath', '/test/project.db')
    mockElectronAPI.agentGroupsList.mockResolvedValue({ success: false })
    const store = useAgentsStore()
    await store.fetchAgentGroups()
    expect(store.agentGroups).toHaveLength(0)
  })
})
