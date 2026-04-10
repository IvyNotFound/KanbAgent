/**
 * tasks-select-mutations-open-watch-autostart.spec.ts
 * Mutation-killing tests for tasks.ts:
 * - openTask: L222-242 Array + Conditional mutations
 * - watchForDb: L255/L262 ConditionalExpression mutations
 * - auto-start: L289-L301 derivation + refresh()
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useTasksStore } from '@renderer/stores/tasks'
import { mockElectronAPI, installMockElectronAPI } from './__helpers__/tasks-select-mutations.helpers'

installMockElectronAPI()


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
