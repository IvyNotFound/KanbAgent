/**
 * tasks-mutation-actions.spec.ts
 * Targets surviving EqualityOperator and ArithmeticOperator mutations in tasks.ts.
 * Focus: setTaskStatut guard conditions, closeProject reset precision.
 * Split from tasks-mutation.spec.ts (T1348)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useTasksStore } from '@renderer/stores/tasks'
import { mockElectronAPI, installMockElectronAPI } from './__helpers__/tasks-mutation.helpers'

installMockElectronAPI()


// ─── EqualityOperator: setTaskStatut impossible transition ───────────────────
// Tests the guard conditions in setTaskStatut

describe('tasks — setTaskStatut guard conditions', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('returns early when dbPath is null — no IPC call', async () => {
    ;(mockElectronAPI as Record<string, ReturnType<typeof vi.fn>>).tasksUpdateStatus =
      vi.fn().mockResolvedValue({ success: true })

    const store = useTasksStore()
    store.dbPath = null

    await store.setTaskStatut(1, 'in_progress')

    expect((mockElectronAPI as Record<string, ReturnType<typeof vi.fn>>).tasksUpdateStatus).not.toHaveBeenCalled()
  })

  it('IPC is called with exactly the provided taskId (not taskId±1)', async () => {
    ;(mockElectronAPI as Record<string, ReturnType<typeof vi.fn>>).tasksUpdateStatus =
      vi.fn().mockResolvedValue({ success: true })

    const store = useTasksStore()
    store.dbPath = '/p/.claude/db'
    store.tasks = [{ id: 42, status: 'todo', title: 'T' }] as never

    await store.setTaskStatut(42, 'in_progress')

    const call = (mockElectronAPI as Record<string, ReturnType<typeof vi.fn>>).tasksUpdateStatus.mock.calls[0]
    expect(call[1]).toBe(42)
    expect(call[1]).not.toBe(41)
    expect(call[1]).not.toBe(43)
  })

  it('rollback restores previousStatus exactly (not a different status)', async () => {
    ;(mockElectronAPI as Record<string, ReturnType<typeof vi.fn>>).tasksUpdateStatus =
      vi.fn().mockRejectedValue(new Error('fail'))

    const store = useTasksStore()
    store.dbPath = '/p/.claude/db'
    store.tasks = [{ id: 1, status: 'todo', title: 'T' }] as never

    await expect(store.setTaskStatut(1, 'in_progress')).rejects.toThrow()

    // Rollback must restore 'todo', not another status
    expect(store.tasks[0].status).toBe('todo')
    expect(store.tasks[0].status).not.toBe('in_progress')
    expect(store.tasks[0].status).not.toBe('done')
  })

  it('rollback on success=false restores previousStatus exactly', async () => {
    ;(mockElectronAPI as Record<string, ReturnType<typeof vi.fn>>).tasksUpdateStatus =
      vi.fn().mockResolvedValue({ success: false, error: 'BLOCKED' })

    const store = useTasksStore()
    store.dbPath = '/p/.claude/db'
    store.tasks = [{ id: 1, status: 'archived', title: 'T' }] as never

    await expect(store.setTaskStatut(1, 'in_progress')).rejects.toThrow()

    // Rollback: archived → in_progress failed → must be back to archived
    expect(store.tasks[0].status).toBe('archived')
  })
})


// ─── EqualityOperator: closeProject clears stats exactly ─────────────────────
// Mutation target: replace === 0 with !== 0 or stats values

describe('tasks — closeProject resets stats to zero', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
    mockElectronAPI.migrateDb.mockResolvedValue({ success: true })
    mockElectronAPI.watchDb.mockResolvedValue(undefined)
    mockElectronAPI.onDbChanged.mockReturnValue(() => {})
    mockElectronAPI.unwatchDb.mockResolvedValue(undefined)
  })

  it('stats are all exactly 0 after closeProject (not 1 or -1)', async () => {
    const store = useTasksStore()
    await store.setProject('/p', '/p/.claude/db')

    // Simulate non-zero stats
    store.stats.todo = 5
    store.stats.in_progress = 3
    store.stats.done = 10
    store.stats.archived = 2

    store.closeProject()

    expect(store.stats.todo).toBe(0)
    expect(store.stats.in_progress).toBe(0)
    expect(store.stats.done).toBe(0)
    expect(store.stats.archived).toBe(0)
  })

  it('tasks array is empty after closeProject (length = 0, not 1 or -1)', async () => {
    const store = useTasksStore()
    await store.setProject('/p', '/p/.claude/db')
    store.tasks = [{ id: 1, status: 'todo', title: 'T' }] as never

    store.closeProject()

    expect(store.tasks).toHaveLength(0)
  })
})
