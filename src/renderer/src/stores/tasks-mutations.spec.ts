/**
 * tasks-mutations.spec.ts
 * Mutation tests for tasks.ts store (part 1/2) — NoCoverage gaps.
 * setGroupParent, staleThresholdMinutes, boardAssignees, openTask links/assignees.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useTasksStore } from '@renderer/stores/tasks'
import { useAgentsStore } from '@renderer/stores/agents'

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
  agentGroupsCreate: vi.fn().mockResolvedValue({ success: true, group: { id: 1, name: 'G', sort_order: 0, created_at: '' } }),
  agentGroupsRename: vi.fn().mockResolvedValue({ success: true }),
  agentGroupsDelete: vi.fn().mockResolvedValue({ success: true }),
  agentGroupsSetMember: vi.fn().mockResolvedValue({ success: true }),
  agentGroupsSetParent: vi.fn().mockResolvedValue({ success: true }),
  getConfigValue: vi.fn().mockResolvedValue({ success: false, value: null }),
  agentKill: vi.fn(),
}

Object.defineProperty(window, 'electronAPI', {
  value: mockElectronAPI,
  writable: true,
})

// ─── setGroupParent (NoCoverage) ─────────────────────────────────────────────

describe('tasks — setGroupParent (NoCoverage)', () => {
  const DB_PATH = '/test/project/.claude/project.db'

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
    mockElectronAPI.queryDb.mockResolvedValue([])
    mockElectronAPI.migrateDb.mockResolvedValue({ success: true })
    mockElectronAPI.watchDb.mockResolvedValue(undefined)
    mockElectronAPI.onDbChanged.mockReturnValue(() => {})
    mockElectronAPI.agentGroupsList.mockResolvedValue({ success: true, groups: [] })
    mockElectronAPI.agentGroupsSetParent.mockResolvedValue({ success: true })
  })

  it('calls agentGroupsSetParent with dbPath, groupId and parentId', async () => {
    const store = useTasksStore()
    const agentsStore = useAgentsStore()
    await store.setProject('/test/project', DB_PATH)
    vi.clearAllMocks()
    mockElectronAPI.agentGroupsList.mockResolvedValue({ success: true, groups: [] })

    await agentsStore.setGroupParent(3, 1)

    expect(mockElectronAPI.agentGroupsSetParent).toHaveBeenCalledWith(DB_PATH, 3, 1)
  })

  it('calls agentGroupsSetParent with null parentId to detach group', async () => {
    const store = useTasksStore()
    const agentsStore = useAgentsStore()
    await store.setProject('/test/project', DB_PATH)
    vi.clearAllMocks()
    mockElectronAPI.agentGroupsList.mockResolvedValue({ success: true, groups: [] })

    await agentsStore.setGroupParent(5, null)

    expect(mockElectronAPI.agentGroupsSetParent).toHaveBeenCalledWith(DB_PATH, 5, null)
  })

  it('does not call agentGroupsSetParent when dbPath is null', async () => {
    const agentsStore = useAgentsStore()
    await agentsStore.setGroupParent(1, 2)

    expect(mockElectronAPI.agentGroupsSetParent).not.toHaveBeenCalled()
  })

  it('refetches agentGroups after setGroupParent succeeds', async () => {
    const store = useTasksStore()
    const agentsStore = useAgentsStore()
    await store.setProject('/test/project', DB_PATH)
    vi.clearAllMocks()
    const groups = [{ id: 10, name: 'Root', position: 0, members: [] }]
    mockElectronAPI.agentGroupsList.mockResolvedValue({ success: true, groups })

    await agentsStore.setGroupParent(3, null)

    expect(mockElectronAPI.agentGroupsList).toHaveBeenCalled()
    expect(store.agentGroups).toHaveLength(1)
    expect(store.agentGroups[0].name).toBe('Root')
  })
})

// ─── staleThresholdMinutes via getConfigValue (NoCoverage) ───────────────────

describe('tasks — staleThresholdMinutes via getConfigValue (NoCoverage)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
    mockElectronAPI.queryDb.mockResolvedValue([])
    mockElectronAPI.migrateDb.mockResolvedValue({ success: true })
    mockElectronAPI.watchDb.mockResolvedValue(undefined)
    mockElectronAPI.onDbChanged.mockReturnValue(() => {})
  })

  it('uses default 120 when getConfigValue fails', async () => {
    mockElectronAPI.getConfigValue.mockResolvedValue({ success: false, value: null })
    const store = useTasksStore()
    await store.setProject('/p', '/p/.claude/db')

    expect(store.staleThresholdMinutes).toBe(120)
  })

  it('updates staleThresholdMinutes when getConfigValue returns valid number', async () => {
    mockElectronAPI.getConfigValue.mockResolvedValue({ success: true, value: '60' })
    const store = useTasksStore()
    await store.setProject('/p', '/p/.claude/db')

    expect(store.staleThresholdMinutes).toBe(60)
    expect(mockElectronAPI.getConfigValue).toHaveBeenCalledWith('/p/.claude/db', 'stale_threshold_minutes')
  })

  it('ignores result when parsed value is 0', async () => {
    mockElectronAPI.getConfigValue.mockResolvedValue({ success: true, value: '0' })
    const store = useTasksStore()
    await store.setProject('/p', '/p/.claude/db')

    expect(store.staleThresholdMinutes).toBe(120)
  })

  it('ignores result when parsed value is NaN', async () => {
    mockElectronAPI.getConfigValue.mockResolvedValue({ success: true, value: 'bad' })
    const store = useTasksStore()
    await store.setProject('/p', '/p/.claude/db')

    expect(store.staleThresholdMinutes).toBe(120)
  })

  it('does not throw when getConfigValue throws', async () => {
    mockElectronAPI.getConfigValue.mockRejectedValue(new Error('IPC error'))
    const store = useTasksStore()
    await expect(store.setProject('/p', '/p/.claude/db')).resolves.not.toThrow()
    expect(store.staleThresholdMinutes).toBe(120)
  })
})

// ─── boardAssignees rebuild in refresh (NoCoverage) ──────────────────────────

describe('tasks — boardAssignees rebuild in refresh (NoCoverage)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
    mockElectronAPI.migrateDb.mockResolvedValue({ success: true })
    mockElectronAPI.watchDb.mockResolvedValue(undefined)
    mockElectronAPI.onDbChanged.mockReturnValue(() => {})
  })

  it('populates boardAssignees from query results', async () => {
    const store = useTasksStore()
    store.dbPath = '/p/.claude/db'
    mockElectronAPI.queryDb
      .mockResolvedValueOnce([{ id: 1, title: 'A', status: 'todo', agent_assigned_id: null }])
      .mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { task_id: 1, agent_id: 10, agent_name: 'dev-front', role: 'primary' },
        { task_id: 1, agent_id: 20, agent_name: 'dev-back', role: 'support' },
      ])

    await store.refresh()

    const a = store.boardAssignees.get(1)
    expect(a).toHaveLength(2)
    expect(a![0].agent_name).toBe('dev-front')
    expect(a![0].role).toBe('primary')
    expect(a![1].role).toBe('support')
  })

  it('clears boardAssignees from previous refresh before rebuilding', async () => {
    const store = useTasksStore()
    store.dbPath = '/p/.claude/db'
    mockElectronAPI.queryDb
      .mockResolvedValueOnce([{ id: 1, title: 'T1', status: 'todo', agent_assigned_id: null }])
      .mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ task_id: 1, agent_id: 10, agent_name: 'dev', role: 'primary' }])

    await store.refresh()
    expect(store.boardAssignees.get(1)).toHaveLength(1)

    mockElectronAPI.queryDb
      .mockResolvedValueOnce([{ id: 1, title: 'T1', status: 'todo', agent_assigned_id: null }])
      .mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([])
      .mockResolvedValueOnce([]).mockResolvedValueOnce([])

    await store.refresh()
    expect(store.boardAssignees.get(1)).toBeUndefined()
  })

  it('handles multiple tasks with different assignees', async () => {
    const store = useTasksStore()
    store.dbPath = '/p/.claude/db'
    mockElectronAPI.queryDb
      .mockResolvedValueOnce([
        { id: 1, title: 'T1', status: 'todo', agent_assigned_id: null },
        { id: 2, title: 'T2', status: 'in_progress', agent_assigned_id: null },
      ])
      .mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { task_id: 1, agent_id: 10, agent_name: 'dev-front', role: 'primary' },
        { task_id: 2, agent_id: 20, agent_name: 'dev-back', role: 'reviewer' },
      ])

    await store.refresh()

    expect(store.boardAssignees.get(1)).toHaveLength(1)
    expect(store.boardAssignees.get(2)![0].role).toBe('reviewer')
  })
})

// ─── openTask taskLinks and taskAssignees (NoCoverage) ───────────────────────

describe('tasks — openTask taskLinks and taskAssignees (NoCoverage)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
    mockElectronAPI.queryDb.mockResolvedValue([])
    mockElectronAPI.migrateDb.mockResolvedValue({ success: true })
    mockElectronAPI.watchDb.mockResolvedValue(undefined)
    mockElectronAPI.onDbChanged.mockReturnValue(() => {})
  })

  it('loads taskLinks from IPC when dbPath is set', async () => {
    const store = useTasksStore()
    await store.setProject('/p', '/p/.claude/db')
    const links = [{ id: 1, from_task: 10, to_task: 20, type: 'blocks' }]
    mockElectronAPI.getTaskLinks.mockResolvedValue({ success: true, links })
    mockElectronAPI.queryDb.mockResolvedValue([])

    await store.openTask({ id: 10, title: 'T' } as never)

    expect(mockElectronAPI.getTaskLinks).toHaveBeenCalledWith('/p/.claude/db', 10)
    expect(store.taskLinks).toEqual(links)
  })

  it('loads taskAssignees from IPC when dbPath is set', async () => {
    const store = useTasksStore()
    await store.setProject('/p', '/p/.claude/db')
    const assignees = [{ agent_id: 5, agent_name: 'review', role: 'reviewer', assigned_at: '' }]
    mockElectronAPI.getTaskAssignees.mockResolvedValue({ success: true, assignees })
    mockElectronAPI.queryDb.mockResolvedValue([])

    await store.openTask({ id: 10, title: 'T' } as never)

    expect(mockElectronAPI.getTaskAssignees).toHaveBeenCalledWith('/p/.claude/db', 10)
    expect(store.taskAssignees).toEqual(assignees)
  })

  it('keeps taskLinks empty when getTaskLinks returns success=false', async () => {
    const store = useTasksStore()
    await store.setProject('/p', '/p/.claude/db')
    mockElectronAPI.getTaskLinks.mockResolvedValue({ success: false, links: [] })
    mockElectronAPI.queryDb.mockResolvedValue([])

    await store.openTask({ id: 10, title: 'T' } as never)

    expect(store.taskLinks).toHaveLength(0)
  })

  it('keeps taskAssignees empty when getTaskAssignees returns success=false', async () => {
    const store = useTasksStore()
    await store.setProject('/p', '/p/.claude/db')
    mockElectronAPI.getTaskAssignees.mockResolvedValue({ success: false, assignees: [] })
    mockElectronAPI.queryDb.mockResolvedValue([])

    await store.openTask({ id: 10, title: 'T' } as never)

    expect(store.taskAssignees).toHaveLength(0)
  })

  it('clears taskLinks on each openTask call', async () => {
    const store = useTasksStore()
    await store.setProject('/p', '/p/.claude/db')
    mockElectronAPI.getTaskLinks.mockResolvedValueOnce({ success: true, links: [{ id: 1 }] })
    mockElectronAPI.getTaskAssignees.mockResolvedValue({ success: true, assignees: [] })
    mockElectronAPI.queryDb.mockResolvedValue([])

    await store.openTask({ id: 1, title: 'First' } as never)
    expect(store.taskLinks).toHaveLength(1)

    mockElectronAPI.getTaskLinks.mockResolvedValue({ success: true, links: [] })
    await store.openTask({ id: 2, title: 'Second' } as never)
    expect(store.taskLinks).toHaveLength(0)
  })
})
