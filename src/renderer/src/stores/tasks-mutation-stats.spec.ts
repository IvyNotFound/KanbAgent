/**
 * tasks-mutation-stats.spec.ts
 * Targets surviving ArithmeticOperator mutations in tasks.ts.
 * Focus: stats counter exact values, row.count assignment precision.
 * Split from tasks-mutation.spec.ts (T1348)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useTasksStore } from '@renderer/stores/tasks'
import { mockElectronAPI, installMockElectronAPI } from './__helpers__/tasks-mutation.helpers'

installMockElectronAPI()


// ─── ArithmeticOperator: stats counters exact values from refresh ─────────────
// Mutation target: +/- 1 on count aggregation — verify exact numeric values

describe('tasks — stats counters exact arithmetic from refresh', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
    mockElectronAPI.migrateDb.mockResolvedValue({ success: true })
    mockElectronAPI.watchDb.mockResolvedValue(undefined)
    mockElectronAPI.onDbChanged.mockReturnValue(() => {})
  })

  it('stats.todo equals exactly the count from rawStats (not count±1)', async () => {
    const store = useTasksStore()
    store.dbPath = '/p/.claude/db'

    mockElectronAPI.queryDb
      .mockResolvedValueOnce([]) // live tasks
      .mockResolvedValueOnce([]) // done tasks
      .mockResolvedValueOnce([]) // agents
      .mockResolvedValueOnce([
        { status: 'todo', count: 7 },
        { status: 'in_progress', count: 3 },
        { status: 'done', count: 12 },
        { status: 'archived', count: 1 },
      ])
      .mockResolvedValueOnce([]) // perimetres
      .mockResolvedValueOnce([]) // boardAssignees

    await store.refresh()

    expect(store.stats.todo).toBe(7)
    expect(store.stats.in_progress).toBe(3)
    expect(store.stats.done).toBe(12)
    expect(store.stats.archived).toBe(1)
  })

  it('stats.todo=1 is distinguishable from stats.todo=2', async () => {
    const store = useTasksStore()
    store.dbPath = '/p/.claude/db'

    mockElectronAPI.queryDb
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ status: 'todo', count: 1 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    await store.refresh()

    expect(store.stats.todo).toBe(1)
    expect(store.stats.todo).not.toBe(0)
    expect(store.stats.todo).not.toBe(2)
  })

  it('stats.done=5 is distinguishable from stats.done=4 or 6', async () => {
    const store = useTasksStore()
    store.dbPath = '/p/.claude/db'

    mockElectronAPI.queryDb
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ status: 'done', count: 5 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    await store.refresh()

    expect(store.stats.done).toBe(5)
    expect(store.stats.done).not.toBe(4)
    expect(store.stats.done).not.toBe(6)
  })

  it('stats stay zero for statuses not in rawStats', async () => {
    const store = useTasksStore()
    store.dbPath = '/p/.claude/db'

    mockElectronAPI.queryDb
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ status: 'todo', count: 3 }]) // only todo
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    await store.refresh()

    expect(store.stats.todo).toBe(3)
    expect(store.stats.in_progress).toBe(0)
    expect(store.stats.done).toBe(0)
    expect(store.stats.archived).toBe(0)
  })
})


// ─── ArithmeticOperator: stats row.count assignment ──────────────────────────
// Mutation target: s[status] = row.count → s[status] = row.count ± 1

describe('tasks — stats row.count assigned exactly (ArithmeticOperator)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
    mockElectronAPI.migrateDb.mockResolvedValue({ success: true })
    mockElectronAPI.watchDb.mockResolvedValue(undefined)
    mockElectronAPI.onDbChanged.mockReturnValue(() => {})
  })

  it('stats.archived = 0 when count is 0, not 1 or -1', async () => {
    const store = useTasksStore()
    store.dbPath = '/p/.claude/db'

    mockElectronAPI.queryDb
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ status: 'archived', count: 0 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    await store.refresh()

    expect(store.stats.archived).toBe(0)
    expect(store.stats.archived).not.toBe(1)
    expect(store.stats.archived).not.toBe(-1)
  })

  it('stats.in_progress = 10 not 9 or 11', async () => {
    const store = useTasksStore()
    store.dbPath = '/p/.claude/db'

    mockElectronAPI.queryDb
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ status: 'in_progress', count: 10 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    await store.refresh()

    expect(store.stats.in_progress).toBe(10)
    expect(store.stats.in_progress).not.toBe(9)
    expect(store.stats.in_progress).not.toBe(11)
  })
})
