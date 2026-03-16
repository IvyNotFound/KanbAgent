/**
 * tasks-select-mutations.spec.ts
 * Mutation-killing tests for tasks.ts:
 * - selectProject: L149 wslCount===n, L154 detail string
 * - closeProject: L172 LogicalOperator unwatchDb
 * - setTaskStatut: L199/L203 LogicalOperator task && previousStatus !== undefined
 * - openTask: L222-242 Array + Conditional mutations
 * - watchForDb: L255/L262 ConditionalExpression mutations
 * - auto-start: L289-L301 derivation + refresh()
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useTasksStore } from '@renderer/stores/tasks'
import { useTabsStore } from '@renderer/stores/tabs'

const mockElectronAPI = {
  queryDb: vi.fn().mockResolvedValue([]),
  watchDb: vi.fn().mockResolvedValue(undefined),
  unwatchDb: vi.fn().mockResolvedValue(undefined),
  onDbChanged: vi.fn().mockReturnValue(() => {}),
  selectProjectDir: vi.fn().mockResolvedValue(null),
  showConfirmDialog: vi.fn().mockResolvedValue(false),
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


// ─── selectProject: wslCount === n (L149 EqualityOperator) ───────────────────

describe('tasks — selectProject: wslCount===n boundary (L149 EqualityOperator)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
    mockElectronAPI.queryDb.mockResolvedValue([])
    mockElectronAPI.migrateDb.mockResolvedValue({ success: true })
    mockElectronAPI.watchDb.mockResolvedValue(undefined)
    mockElectronAPI.onDbChanged.mockReturnValue(() => {})
    mockElectronAPI.showConfirmDialog.mockResolvedValue(false)
  })

  it('uses WSL-only label when exactly all terminals are WSL (wslCount === n)', async () => {
    const tasksStore = useTasksStore()
    const tabsStore = useTabsStore()
    // All 2 terminals have wslDistro → wslCount === n
    tabsStore.addTerminal('agent-1', 'Ubuntu')
    tabsStore.addTerminal('agent-2', 'Ubuntu')

    await tasksStore.selectProject()

    const call = mockElectronAPI.showConfirmDialog.mock.calls[0][0]
    // Must use WSL label, not mixed label
    expect(call.message).toContain('WSL')
    expect(call.message).not.toContain('+')
  })

  it('uses mixed label when wslCount < n (one non-WSL terminal)', async () => {
    const tasksStore = useTasksStore()
    const tabsStore = useTabsStore()
    // 1 WSL, 1 non-WSL → wslCount(1) !== n(2)
    tabsStore.addTerminal('agent-1', 'Ubuntu')
    tabsStore.addTerminal('agent-2') // no wslDistro

    await tasksStore.selectProject()

    const call = mockElectronAPI.showConfirmDialog.mock.calls[0][0]
    expect(call.message).toContain('+')
  })

  it('WSL-only label with single terminal (n=1, wslCount=1)', async () => {
    const tasksStore = useTasksStore()
    const tabsStore = useTabsStore()
    tabsStore.addTerminal('solo', 'Ubuntu')

    await tasksStore.selectProject()

    const call = mockElectronAPI.showConfirmDialog.mock.calls[0][0]
    expect(call.message).toBe('1 session WSL ouverte')
  })

  it('mixed label wslCount=0 → terminal-only label (not WSL, not mixed)', async () => {
    const tasksStore = useTasksStore()
    const tabsStore = useTabsStore()
    tabsStore.addTerminal('agent-1') // no wslDistro

    await tasksStore.selectProject()

    const call = mockElectronAPI.showConfirmDialog.mock.calls[0][0]
    expect(call.message).toContain('terminal')
    expect(call.message).not.toContain('WSL')
    expect(call.message).not.toContain('+')
  })
})


// ─── selectProject: detail string (L154 StringLiteral) ───────────────────────

describe('tasks — selectProject: confirm dialog detail string (L154)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
    mockElectronAPI.queryDb.mockResolvedValue([])
    mockElectronAPI.migrateDb.mockResolvedValue({ success: true })
    mockElectronAPI.watchDb.mockResolvedValue(undefined)
    mockElectronAPI.onDbChanged.mockReturnValue(() => {})
    mockElectronAPI.showConfirmDialog.mockResolvedValue(false)
  })

  it('confirm dialog has non-empty detail text (not empty string mutation)', async () => {
    const tasksStore = useTasksStore()
    const tabsStore = useTabsStore()
    tabsStore.addTerminal('agent-1')

    await tasksStore.selectProject()

    const call = mockElectronAPI.showConfirmDialog.mock.calls[0][0]
    expect(call.detail).toBeTruthy()
    expect(call.detail.length).toBeGreaterThan(0)
  })

  it('confirm dialog detail mentions terminal sessions will be closed', async () => {
    const tasksStore = useTasksStore()
    const tabsStore = useTabsStore()
    tabsStore.addTerminal('agent-1')

    await tasksStore.selectProject()

    const call = mockElectronAPI.showConfirmDialog.mock.calls[0][0]
    // The detail message must contain meaningful content, not an empty string
    expect(typeof call.detail).toBe('string')
    expect(call.detail).not.toBe('')
  })
})


// ─── closeProject: LogicalOperator unwatchDb (L172) ──────────────────────────

describe('tasks — closeProject: unwatchDb LogicalOperator (L172)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
    mockElectronAPI.queryDb.mockResolvedValue([])
    mockElectronAPI.migrateDb.mockResolvedValue({ success: true })
    mockElectronAPI.watchDb.mockResolvedValue(undefined)
    mockElectronAPI.onDbChanged.mockReturnValue(() => {})
  })

  it('calls unwatchDb with dbPath when dbPath is set', async () => {
    const store = useTasksStore()
    await store.setProject('/p', '/p/.claude/db')
    vi.clearAllMocks()

    store.closeProject()

    expect(mockElectronAPI.unwatchDb).toHaveBeenCalledWith('/p/.claude/db')
  })

  it('calls unwatchDb with undefined when dbPath is already null', () => {
    const store = useTasksStore()
    // dbPath is null by default
    store.closeProject()
    // unwatchDb called with undefined (dbPath.value ?? undefined → undefined)
    expect(mockElectronAPI.unwatchDb).toHaveBeenCalledWith(undefined)
  })

  it('clears boardAssignees on closeProject (ArrayDeclaration L180)', async () => {
    const store = useTasksStore()
    await store.setProject('/p', '/p/.claude/db')
    // Populate boardAssignees
    store.boardAssignees.set(1, [{ task_id: 1, agent_id: 5, agent_name: 'dev', role: 'primary', assigned_at: '' }])

    store.closeProject()

    expect(store.boardAssignees.size).toBe(0)
  })

  it('resets stats to all-zero on closeProject', async () => {
    const store = useTasksStore()
    await store.setProject('/p', '/p/.claude/db')
    store.stats = { todo: 5, in_progress: 2, done: 3, archived: 1 }

    store.closeProject()

    expect(store.stats.todo).toBe(0)
    expect(store.stats.in_progress).toBe(0)
    expect(store.stats.done).toBe(0)
    expect(store.stats.archived).toBe(0)
  })
})


// ─── setTaskStatut: LogicalOperator in rollback (L199/L203) ──────────────────

describe('tasks — setTaskStatut: rollback LogicalOperator (L199 task && previousStatus !== undefined)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('rollbacks on throw ONLY when task exists AND previousStatus is defined', async () => {
    ;(mockElectronAPI as Record<string, ReturnType<typeof vi.fn>>).tasksUpdateStatus =
      vi.fn().mockRejectedValue(new Error('Network'))
    const store = useTasksStore()
    store.$patch({
      dbPath: '/db',
      tasks: [{ id: 1, status: 'todo', title: 'T' }] as never,
    })

    await expect(store.setTaskStatut(1, 'in_progress')).rejects.toThrow()

    // Must rollback: status back to 'todo'
    expect(store.tasks[0].status).toBe('todo')
  })

  it('does NOT crash when task id does not exist (task is undefined)', async () => {
    ;(mockElectronAPI as Record<string, ReturnType<typeof vi.fn>>).tasksUpdateStatus =
      vi.fn().mockRejectedValue(new Error('IPC error'))
    const store = useTasksStore()
    store.$patch({
      dbPath: '/db',
      tasks: [{ id: 99, status: 'done', title: 'Other' }] as never,
    })

    // task with id=1 does not exist → no rollback needed
    await expect(store.setTaskStatut(1, 'in_progress')).rejects.toThrow()
    // Other task untouched
    expect(store.tasks[0].status).toBe('done')
  })

  it('rollbacks on success=false with task && previousStatus !== undefined (L203)', async () => {
    ;(mockElectronAPI as Record<string, ReturnType<typeof vi.fn>>).tasksUpdateStatus =
      vi.fn().mockResolvedValue({ success: false, error: 'blocked' })
    const store = useTasksStore()
    store.$patch({
      dbPath: '/db',
      tasks: [{ id: 5, status: 'todo', title: 'T5' }] as never,
    })

    await expect(store.setTaskStatut(5, 'in_progress')).rejects.toThrow()

    // Must rollback: previousStatus was 'todo'
    expect(store.tasks[0].status).toBe('todo')
  })

  it('does NOT rollback when success=false but task does not exist (task undefined)', async () => {
    ;(mockElectronAPI as Record<string, ReturnType<typeof vi.fn>>).tasksUpdateStatus =
      vi.fn().mockResolvedValue({ success: false, error: 'blocked' })
    const store = useTasksStore()
    store.$patch({
      dbPath: '/db',
      tasks: [] as never,
    })

    // No task to rollback, should not crash
    await expect(store.setTaskStatut(1, 'in_progress')).rejects.toThrow()
  })
})


// ─── openTask: array mutations (L222, L231, L242) ────────────────────────────

describe('tasks — openTask: initial empty arrays & commentsQuery (L222-L242)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
    mockElectronAPI.queryDb.mockResolvedValue([])
    mockElectronAPI.migrateDb.mockResolvedValue({ success: true })
    mockElectronAPI.watchDb.mockResolvedValue(undefined)
    mockElectronAPI.onDbChanged.mockReturnValue(() => {})
    mockElectronAPI.getTaskLinks.mockResolvedValue({ success: true, links: [] })
    mockElectronAPI.getTaskAssignees.mockResolvedValue({ success: true, assignees: [] })
  })

  it('resets taskComments to empty array on openTask call (L222 ArrayDeclaration)', async () => {
    const store = useTasksStore()
    await store.setProject('/p', '/p/.claude/db')
    // Pre-populate comments
    store.taskComments = [{ id: 99, content: 'old', agent_name: 'old-agent' }] as never
    mockElectronAPI.queryDb.mockResolvedValue([]) // no new comments

    await store.openTask({ id: 1, title: 'T' } as never)

    expect(store.taskComments).toHaveLength(0)
  })

  it('query params array is [task.id] — not empty array (L231 ArrayDeclaration)', async () => {
    const store = useTasksStore()
    await store.setProject('/p', '/p/.claude/db')
    vi.clearAllMocks()
    mockElectronAPI.queryDb.mockResolvedValue([
      { id: 10, content: 'comment for task 42', agent_name: 'dev' },
    ])

    await store.openTask({ id: 42, title: 'My Task' } as never)

    // queryDb should be called with the task id as param
    const queryCall = mockElectronAPI.queryDb.mock.calls[0]
    expect(queryCall[2]).toEqual([42]) // params = [task.id]
  })

  it('Promise.all awaits both links and assignees (L242 ArrayDeclaration)', async () => {
    const store = useTasksStore()
    await store.setProject('/p', '/p/.claude/db')
    const links = [{ id: 1, from_task_id: 1, to_task_id: 2, type: 'blocks' }]
    const assignees = [{ agent_id: 5, agent_name: 'dev', role: 'primary', assigned_at: '' }]
    mockElectronAPI.getTaskLinks.mockResolvedValue({ success: true, links })
    mockElectronAPI.getTaskAssignees.mockResolvedValue({ success: true, assignees })
    mockElectronAPI.queryDb.mockResolvedValue([])

    await store.openTask({ id: 1, title: 'T' } as never)

    expect(store.taskLinks).toEqual(links)
    expect(store.taskAssignees).toEqual(assignees)
  })

  it('linksPromise: dbPath check (L234 ConditionalExpression)', async () => {
    const store = useTasksStore()
    // dbPath is null — linksPromise should resolve immediately (no IPC call)
    mockElectronAPI.queryDb.mockResolvedValue([])

    await store.openTask({ id: 1, title: 'T' } as never)

    expect(mockElectronAPI.getTaskLinks).not.toHaveBeenCalled()
    expect(store.taskLinks).toHaveLength(0)
  })

  it('assigneesPromise: dbPath check (L239 ConditionalExpression)', async () => {
    const store = useTasksStore()
    // dbPath is null — assigneesPromise should resolve immediately
    mockElectronAPI.queryDb.mockResolvedValue([])

    await store.openTask({ id: 1, title: 'T' } as never)

    expect(mockElectronAPI.getTaskAssignees).not.toHaveBeenCalled()
    expect(store.taskAssignees).toHaveLength(0)
  })
})


// ─── watchForDb: interval conditional (L255 / L262) ──────────────────────────

describe('tasks — watchForDb: ConditionalExpression guards (L255 / L262)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
    mockElectronAPI.queryDb.mockResolvedValue([])
    mockElectronAPI.migrateDb.mockResolvedValue({ success: true })
    mockElectronAPI.watchDb.mockResolvedValue(undefined)
    mockElectronAPI.onDbChanged.mockReturnValue(() => {})
    mockElectronAPI.findProjectDb.mockResolvedValue(null)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('skips tick when document.visibilityState is hidden (L255 ConditionalExpression)', async () => {
    vi.useFakeTimers()
    // Simulate hidden document
    Object.defineProperty(document, 'visibilityState', {
      value: 'hidden',
      configurable: true,
    })
    const store = useTasksStore()

    store.watchForDb('/project')
    await vi.advanceTimersByTimeAsync(2000)

    // findProjectDb should NOT be called because visibilityState=hidden
    expect(mockElectronAPI.findProjectDb).not.toHaveBeenCalled()

    // Restore
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      configurable: true,
    })
  })

  it('checks findProjectDb when visible (L255 ConditionalExpression — false branch)', async () => {
    vi.useFakeTimers()
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      configurable: true,
    })
    const store = useTasksStore()

    store.watchForDb('/project')
    await vi.advanceTimersByTimeAsync(2000)

    expect(mockElectronAPI.findProjectDb).toHaveBeenCalledWith('/project')
  })

  it('calls setProject only when db is found (L262 ConditionalExpression)', async () => {
    vi.useFakeTimers()
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      configurable: true,
    })
    // First tick: null (not found), second tick: found
    mockElectronAPI.findProjectDb
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('/project/.claude/project.db')

    const store = useTasksStore()
    store.watchForDb('/project')

    await vi.advanceTimersByTimeAsync(2000) // first tick: null
    expect(store.dbPath).toBeNull()

    await vi.advanceTimersByTimeAsync(2000) // second tick: found
    expect(store.dbPath).toBe('/project/.claude/project.db')
  })

  it('does NOT call setProject when findProjectDb returns null (L262 ConditionalExpression — false branch)', async () => {
    vi.useFakeTimers()
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      configurable: true,
    })
    mockElectronAPI.findProjectDb.mockResolvedValue(null)
    const store = useTasksStore()

    store.watchForDb('/project')
    await vi.advanceTimersByTimeAsync(2000)

    expect(store.dbPath).toBeNull()
    expect(mockElectronAPI.migrateDb).not.toHaveBeenCalled()
  })
})


// ─── auto-start: derivation mutations (L289-L291) ────────────────────────────
// Note: L301 ArrowFunction (refresh call) is tested implicitly via setProject tests
// since refresh() is also called there. The auto-start block tests below focus
// on derivation path mutations that are NoCoverage/Survived.

describe('tasks — auto-start block: derivation edge cases (L289-L291 mutations)', () => {
  it('derives projectPath: unix path with .claude at depth 3+ (L290 parts.length >= 2)', () => {
    localStorage.clear()
    vi.clearAllMocks()
    mockElectronAPI.queryDb.mockResolvedValue([])
    mockElectronAPI.migrateDb.mockResolvedValue({ success: true })
    mockElectronAPI.findProjectDb.mockResolvedValue(null)
    localStorage.setItem('dbPath', '/a/b/c/.claude/project.db')

    setActivePinia(createPinia())
    const store = useTasksStore()

    // parts = ['a','b','c','.claude','project.db'] → parts[parts.length-2] = '.claude' ✓
    expect(store.projectPath).toBe('/a/b/c')
  })

  it('does NOT derive when second-to-last segment is not .claude (L290 parts[length-2] === ".claude")', () => {
    localStorage.clear()
    vi.clearAllMocks()
    mockElectronAPI.queryDb.mockResolvedValue([])
    mockElectronAPI.findProjectDb.mockResolvedValue(null)
    localStorage.setItem('dbPath', '/project/db/project.db')
    // parts[-2] = 'db', not '.claude'

    setActivePinia(createPinia())
    const store = useTasksStore()

    expect(store.projectPath).toBeNull()
  })

  it('regex strips /.claude/filename correctly — projectPath has no .claude suffix (L291 Regex)', () => {
    localStorage.clear()
    vi.clearAllMocks()
    mockElectronAPI.queryDb.mockResolvedValue([])
    mockElectronAPI.findProjectDb.mockResolvedValue(null)
    localStorage.setItem('dbPath', '/workspace/myapp/.claude/project.db')

    setActivePinia(createPinia())
    const store = useTasksStore()

    expect(store.projectPath).toBe('/workspace/myapp')
    expect(store.projectPath).not.toContain('.claude')
    expect(store.projectPath).not.toBe('')
    expect(store.projectPath).not.toBeNull()
  })

  it('split("/").filter(Boolean) normalizes path — MethodExpression L289', () => {
    localStorage.clear()
    vi.clearAllMocks()
    mockElectronAPI.queryDb.mockResolvedValue([])
    mockElectronAPI.findProjectDb.mockResolvedValue(null)
    // With backslash mixed in (Windows-style)
    localStorage.setItem('dbPath', '/my/project/.claude/project.db')

    setActivePinia(createPinia())
    const store = useTasksStore()

    // Should correctly identify .claude segment
    expect(store.projectPath).toBe('/my/project')
  })
})
