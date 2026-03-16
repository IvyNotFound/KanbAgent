/**
 * tasks-store-init.spec.ts
 * Mutation-killing tests for tasks.ts initial state shape,
 * query function LogicalOperator, watch(agents) conditional,
 * and setProject cfgRes LogicalOperator.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { nextTick } from 'vue'
import { useTasksStore } from '@renderer/stores/tasks'

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


// ─── Initial state shape (ObjectLiteral / ArrayDeclaration / BooleanLiteral) ──

describe('tasks — initial state shape (L36-50 mutations)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
    mockElectronAPI.queryDb.mockResolvedValue([])
  })

  it('tasks is initially an empty array (not a non-empty array)', () => {
    const store = useTasksStore()
    expect(store.tasks).toEqual([])
    expect(Array.isArray(store.tasks)).toBe(true)
  })

  it('perimetresData is initially an empty array', () => {
    const store = useTasksStore()
    expect(store.perimetresData).toEqual([])
    expect(Array.isArray(store.perimetresData)).toBe(true)
  })

  it('stats has all four keys initialized to 0 (ObjectLiteral mutation)', () => {
    const store = useTasksStore()
    expect(store.stats.todo).toBe(0)
    expect(store.stats.in_progress).toBe(0)
    expect(store.stats.done).toBe(0)
    expect(store.stats.archived).toBe(0)
  })

  it('stats is a plain object with exactly 4 status keys', () => {
    const store = useTasksStore()
    const keys = Object.keys(store.stats).sort()
    expect(keys).toEqual(['archived', 'done', 'in_progress', 'todo'])
  })

  it('taskLinks is initially an empty array (not a non-empty array)', () => {
    const store = useTasksStore()
    expect(store.taskLinks).toEqual([])
    expect(Array.isArray(store.taskLinks)).toBe(true)
    expect(store.taskLinks).toHaveLength(0)
  })

  it('taskAssignees is initially an empty array (not a non-empty array)', () => {
    const store = useTasksStore()
    expect(store.taskAssignees).toEqual([])
    expect(Array.isArray(store.taskAssignees)).toBe(true)
    expect(store.taskAssignees).toHaveLength(0)
  })

  it('doneTasksLimited is initially false (BooleanLiteral mutation)', () => {
    const store = useTasksStore()
    expect(store.doneTasksLimited).toBe(false)
    expect(store.doneTasksLimited).not.toBe(true)
  })
})


// ─── query: console.warn message (StringLiteral L56) ──────────────────────────

describe('tasks — query function string literal (L56)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('logs a warning when queryDb returns non-array and message includes "tasks query"', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const store = useTasksStore()
    store.dbPath = '/test/db'
    mockElectronAPI.queryDb.mockResolvedValueOnce({ error: 'permission denied' })

    await store.query('SELECT 1')

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('tasks query'),
      expect.anything()
    )
    warnSpy.mockRestore()
  })

  it('does not log when queryDb returns an array', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const store = useTasksStore()
    store.dbPath = '/test/db'
    mockElectronAPI.queryDb.mockResolvedValueOnce([{ id: 1 }])

    await store.query('SELECT 1')

    expect(warnSpy).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })
})


// ─── setProject: cfgRes LogicalOperator (L113) ────────────────────────────────

describe('tasks — setProject cfgRes.success && cfgRes.value !== null (L113 LogicalOperator)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
    mockElectronAPI.queryDb.mockResolvedValue([])
    mockElectronAPI.migrateDb.mockResolvedValue({ success: true })
    mockElectronAPI.watchDb.mockResolvedValue(undefined)
    mockElectronAPI.onDbChanged.mockReturnValue(() => {})
  })

  it('uses default 120 when success=true but value=null (cfgRes.value !== null is false)', async () => {
    mockElectronAPI.getConfigValue.mockResolvedValue({ success: true, value: null })
    const store = useTasksStore()
    await store.setProject('/p', '/p/.claude/db')
    // value is null → condition fails → stays 120
    expect(store.staleThresholdMinutes).toBe(120)
  })

  it('uses default 120 when success=false even with non-null value (cfgRes.success is false)', async () => {
    mockElectronAPI.getConfigValue.mockResolvedValue({ success: false, value: '60' })
    const store = useTasksStore()
    await store.setProject('/p', '/p/.claude/db')
    // success=false → condition fails → stays 120
    expect(store.staleThresholdMinutes).toBe(120)
  })

  it('updates threshold when both success=true AND value is non-null string', async () => {
    mockElectronAPI.getConfigValue.mockResolvedValue({ success: true, value: '45' })
    const store = useTasksStore()
    await store.setProject('/p', '/p/.claude/db')
    expect(store.staleThresholdMinutes).toBe(45)
  })
})


// ─── tasksByStatus: t.status in groups (ConditionalExpression L98) ────────────

describe('tasks — tasksByStatus: status key presence (L98 ConditionalExpression)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
    mockElectronAPI.queryDb.mockResolvedValue([])
  })

  it('excludes tasks with unknown status strings from all groups', () => {
    const store = useTasksStore()
    store.tasks = [
      { id: 1, status: 'todo', title: 'T1' },
      { id: 2, status: 'unknown_status', title: 'T2' },
      { id: 3, status: 'done', title: 'T3' },
    ] as never

    const groups = store.tasksByStatus
    const total = groups.todo.length + groups.in_progress.length + groups.done.length + groups.archived.length
    expect(total).toBe(2) // unknown_status excluded
    expect(groups.todo).toHaveLength(1)
    expect(groups.done).toHaveLength(1)
  })

  it('correctly groups all four valid statuses', () => {
    const store = useTasksStore()
    store.tasks = [
      { id: 1, status: 'todo', title: 'T1' },
      { id: 2, status: 'in_progress', title: 'T2' },
      { id: 3, status: 'done', title: 'T3' },
      { id: 4, status: 'archived', title: 'T4' },
    ] as never

    const groups = store.tasksByStatus
    expect(groups.todo[0].id).toBe(1)
    expect(groups.in_progress[0].id).toBe(2)
    expect(groups.done[0].id).toBe(3)
    expect(groups.archived[0].id).toBe(4)
  })

  it('empty tasks → all groups empty arrays', () => {
    const store = useTasksStore()
    store.tasks = []

    const groups = store.tasksByStatus
    expect(groups.todo).toHaveLength(0)
    expect(groups.in_progress).toHaveLength(0)
    expect(groups.done).toHaveLength(0)
    expect(groups.archived).toHaveLength(0)
  })

  it('single task in each group is correctly placed', () => {
    const store = useTasksStore()
    store.tasks = [
      { id: 10, status: 'in_progress', title: 'Active Task' },
    ] as never

    const groups = store.tasksByStatus
    expect(groups.in_progress).toHaveLength(1)
    expect(groups.in_progress[0].id).toBe(10)
    expect(groups.todo).toHaveLength(0)
    expect(groups.done).toHaveLength(0)
    expect(groups.archived).toHaveLength(0)
  })
})


// ─── watch(agents): selectedAgentId !== null guard (L280 ConditionalExpression) ─

describe('tasks — watch(agents) selectedAgentId !== null guard (L280)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
    mockElectronAPI.queryDb.mockResolvedValue([])
    mockElectronAPI.migrateDb.mockResolvedValue({ success: true })
    mockElectronAPI.watchDb.mockResolvedValue(undefined)
    mockElectronAPI.onDbChanged.mockReturnValue(() => {})
  })

  it('does NOT clear selectedAgentId=null when agent 0 disappears (null !== null is false)', async () => {
    // Guard: only act when selectedAgentId !== null
    // If mutation changes to `true`, it would always run and clear, failing when null
    const store = useTasksStore()
    store.selectedAgentId = null
    store.agents = [{ id: 5, name: 'dev' }] as never
    await nextTick()

    // Agent 5 disappears
    store.agents = [] as never
    await nextTick()

    // selectedAgentId was already null, should still be null (no change)
    expect(store.selectedAgentId).toBeNull()
  })

  it('clears selectedAgentId when it is non-null and agent is absent', async () => {
    const store = useTasksStore()
    store.agents = [{ id: 7, name: 'dev' }] as never
    store.selectedAgentId = 7
    await nextTick()

    store.agents = [] as never
    await nextTick()

    expect(store.selectedAgentId).toBeNull()
  })

  it('keeps selectedAgentId when agent still present in new list', async () => {
    const store = useTasksStore()
    store.agents = [{ id: 7, name: 'dev' }] as never
    store.selectedAgentId = 7
    await nextTick()

    store.agents = [{ id: 7, name: 'dev' }, { id: 8, name: 'other' }] as never
    await nextTick()

    expect(store.selectedAgentId).toBe(7)
  })
})


// ─── watch(dbPath): newPath !== oldPath guard (L273 ConditionalExpression) ─────

describe('tasks — watch(dbPath) newPath !== oldPath guard (L273)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
    mockElectronAPI.queryDb.mockResolvedValue([])
    mockElectronAPI.migrateDb.mockResolvedValue({ success: true })
    mockElectronAPI.watchDb.mockResolvedValue(undefined)
    mockElectronAPI.onDbChanged.mockReturnValue(() => {})
  })

  it('resets filters when dbPath changes to a different value', async () => {
    const store = useTasksStore()
    store.dbPath = '/project-a/.claude/project.db'
    store.selectedAgentId = 3
    store.selectedPerimetre = 'front-vuejs'
    await nextTick()

    store.dbPath = '/project-b/.claude/project.db'
    await nextTick()

    expect(store.selectedAgentId).toBeNull()
    expect(store.selectedPerimetre).toBeNull()
  })

  it('does NOT reset filters when dbPath changes to the same value (mutation: if true would reset)', async () => {
    const store = useTasksStore()
    store.dbPath = '/project-a/.claude/project.db'
    await nextTick()

    // Set filters after watcher has already fired for initial value
    store.selectedAgentId = 5
    store.selectedPerimetre = 'back-electron'

    // Same path — watcher should NOT fire (no change)
    store.dbPath = '/project-a/.claude/project.db'
    await nextTick()

    expect(store.selectedAgentId).toBe(5)
    expect(store.selectedPerimetre).toBe('back-electron')
  })
})
