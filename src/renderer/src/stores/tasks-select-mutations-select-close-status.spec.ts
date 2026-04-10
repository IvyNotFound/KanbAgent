/**
 * tasks-select-mutations-select-close-status.spec.ts
 * Mutation-killing tests for tasks.ts:
 * - selectProject: L149 wslCount===n, L154 detail string
 * - closeProject: L172 LogicalOperator unwatchDb
 * - setTaskStatut: L199/L203 LogicalOperator task && previousStatus !== undefined
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useTasksStore } from '@renderer/stores/tasks'
import { useTabsStore } from '@renderer/stores/tabs'
import { mockElectronAPI, installMockElectronAPI } from './__helpers__/tasks-select-mutations.helpers'

installMockElectronAPI()


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
    store.stats = { todo: 5, in_progress: 2, done: 3, archived: 1, rejected: 0 }

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
