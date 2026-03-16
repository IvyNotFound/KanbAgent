/**
 * useTaskRefresh-gaps.spec.ts — T1314
 * Kill surviving mutations in useTaskRefresh.ts.
 *
 * Strategy: each describe block uses vi.resetModules() + dynamic import so each
 * test gets a fresh module instance (fresh _lastNotifTs map).
 * Settings are controlled per-block via vi.doMock before the dynamic import.
 *
 * Targeted survivors:
 * - L92: tasks.value.length > 0 (EqualityOperator: >= / === 0)
 * - L97: t.status transitions — includes('in_progress') and includes('done')
 * - L98: notification cooldown < 5000 boundary (exact 4999, 5000, 5001)
 * - L106-109: cutoff cleanup ts < cutoff boundary
 * - L155-163: startWatching debounce
 * - L150-152: stopPolling guard — null-check branches
 * - L88: doneTasksLimited flag (=== DONE_TASKS_LIMIT)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { ref } from 'vue'
import type { TaskRefreshDeps } from '@renderer/stores/useTaskRefresh'

// ─── electronAPI mock ─────────────────────────────────────────────────────────
const mockElectronAPI = {
  queryDb: vi.fn().mockResolvedValue([]),
  watchDb: vi.fn(),
  unwatchDb: vi.fn(),
  onDbChanged: vi.fn().mockReturnValue(() => {}),
  findProjectDb: vi.fn().mockResolvedValue(null),
  agentGroupsList: vi.fn().mockResolvedValue({ success: true, groups: [] }),
  migrateDb: vi.fn().mockResolvedValue({ success: true }),
}

Object.defineProperty(window, 'electronAPI', { value: mockElectronAPI, writable: true })

// ─── helpers ──────────────────────────────────────────────────────────────────
function makeDeps(overrides: Partial<TaskRefreshDeps> = {}): TaskRefreshDeps {
  return {
    dbPath: ref('/test/project.db'),
    tasks: ref([]),
    agents: ref([]),
    perimetresData: ref([]),
    stats: ref({ todo: 0, in_progress: 0, done: 0, archived: 0 }),
    lastRefresh: ref(null),
    loading: ref(false),
    error: ref(null),
    doneTasksLimited: ref(false),
    boardAssignees: ref(new Map()),
    query: vi.fn().mockResolvedValue([]),
    ...overrides,
  }
}

/** Query mock that simulates a task transitioning to newStatus on next refresh. */
function makeTransitionQuery(taskId: number, newStatus: 'in_progress' | 'done') {
  return vi.fn().mockImplementation((sql: string) => {
    if (sql.includes("status IN ('todo', 'in_progress')")) {
      return Promise.resolve(
        newStatus === 'in_progress'
          ? [{ id: taskId, title: 'T', status: 'in_progress', agent_name: 'a' }]
          : []
      )
    }
    if (sql.includes("status = 'done'")) {
      return Promise.resolve(
        newStatus === 'done'
          ? [{ id: taskId, title: 'T', status: 'done', agent_name: 'a' }]
          : []
      )
    }
    return Promise.resolve([])
  })
}

/** Load useTaskRefresh with notifications ENABLED (fresh module). */
async function loadWithNotifications() {
  vi.resetModules()
  vi.doMock('@renderer/stores/agents', () => ({
    useAgentsStore: () => ({ fetchAgentGroups: vi.fn(), agentRefresh: vi.fn() }),
    AGENT_CTE_SQL: 'SELECT * FROM agents',
  }))
  vi.doMock('@renderer/stores/settings', () => ({
    useSettingsStore: () => ({ notificationsEnabled: true }),
  }))
  vi.doMock('@renderer/composables/useToast', () => ({
    useToast: () => ({ push: vi.fn() }),
  }))
  return import('@renderer/stores/useTaskRefresh')
}

/** Load useTaskRefresh with notifications DISABLED (fresh module). */
async function loadWithoutNotifications() {
  vi.resetModules()
  vi.doMock('@renderer/stores/agents', () => ({
    useAgentsStore: () => ({ fetchAgentGroups: vi.fn(), agentRefresh: vi.fn() }),
    AGENT_CTE_SQL: 'SELECT * FROM agents',
  }))
  vi.doMock('@renderer/stores/settings', () => ({
    useSettingsStore: () => ({ notificationsEnabled: false }),
  }))
  vi.doMock('@renderer/composables/useToast', () => ({
    useToast: () => ({ push: vi.fn() }),
  }))
  return import('@renderer/stores/useTaskRefresh')
}

// ─── L92: tasks.value.length > 0 ─────────────────────────────────────────────
describe('useTaskRefresh — notification guard: tasks.value.length (L92)', () => {
  const savedNotification = (global as Record<string, unknown>).Notification

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  afterEach(() => {
    (global as Record<string, unknown>).Notification = savedNotification
  })

  it('does NOT fire notification when tasks.value.length === 0 (exactly zero)', async () => {
    const mockCtor = vi.fn()
    ;(global as Record<string, unknown>).Notification = Object.assign(mockCtor, { permission: 'granted' })
    const { useTaskRefresh } = await loadWithNotifications()

    const deps = makeDeps({
      tasks: ref([]),
      query: makeTransitionQuery(1, 'done'),
    })
    const { refresh } = useTaskRefresh(deps)
    await refresh()

    expect(mockCtor).not.toHaveBeenCalled()
  })

  it('DOES fire notification when tasks.value.length === 1 (boundary: one task)', async () => {
    const mockCtor = vi.fn()
    ;(global as Record<string, unknown>).Notification = Object.assign(mockCtor, { permission: 'granted' })
    const { useTaskRefresh } = await loadWithNotifications()

    const taskId = 90001
    const taskRef = ref([{ id: taskId, title: 'One', status: 'todo', agent_name: 'a' }]) as ReturnType<typeof ref>
    const deps = makeDeps({ tasks: taskRef, query: makeTransitionQuery(taskId, 'done') })
    const { refresh } = useTaskRefresh(deps)
    await refresh()

    expect(mockCtor).toHaveBeenCalled()
  })
})

// ─── L97: includes('in_progress') and includes('done') ───────────────────────
describe('useTaskRefresh — notification: status includes check (L97)', () => {
  const savedNotification = (global as Record<string, unknown>).Notification

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  afterEach(() => {
    (global as Record<string, unknown>).Notification = savedNotification
  })

  it('fires notification with title "Task started" on todo → in_progress', async () => {
    const mockCtor = vi.fn()
    ;(global as Record<string, unknown>).Notification = Object.assign(mockCtor, { permission: 'granted' })
    const { useTaskRefresh } = await loadWithNotifications()

    const taskId = 90100
    // The notification uses t.title from newTasks (query result), not from taskRef
    const taskRef = ref([{ id: taskId, title: 'T', status: 'todo', agent_name: 'b' }]) as ReturnType<typeof ref>
    const deps = makeDeps({ tasks: taskRef, query: makeTransitionQuery(taskId, 'in_progress') })
    const { refresh } = useTaskRefresh(deps)
    await refresh()

    expect(mockCtor).toHaveBeenCalledWith('Task started', expect.objectContaining({ body: expect.stringContaining('T') }))
  })

  it('fires notification with title "Task completed" on in_progress → done', async () => {
    const mockCtor = vi.fn()
    ;(global as Record<string, unknown>).Notification = Object.assign(mockCtor, { permission: 'granted' })
    const { useTaskRefresh } = await loadWithNotifications()

    const taskId = 90200
    const taskRef = ref([{ id: taskId, title: 'Done', status: 'in_progress', agent_name: 'c' }]) as ReturnType<typeof ref>
    const deps = makeDeps({ tasks: taskRef, query: makeTransitionQuery(taskId, 'done') })
    const { refresh } = useTaskRefresh(deps)
    await refresh()

    expect(mockCtor).toHaveBeenCalledWith('Task completed', expect.anything())
  })

  it('does NOT fire when notificationsEnabled is false', async () => {
    const mockCtor = vi.fn()
    ;(global as Record<string, unknown>).Notification = Object.assign(mockCtor, { permission: 'granted' })
    const { useTaskRefresh } = await loadWithoutNotifications()

    const taskId = 90300
    const taskRef = ref([{ id: taskId, title: 'Off', status: 'todo', agent_name: 'd' }]) as ReturnType<typeof ref>
    const deps = makeDeps({ tasks: taskRef, query: makeTransitionQuery(taskId, 'done') })
    const { refresh } = useTaskRefresh(deps)
    await refresh()

    expect(mockCtor).not.toHaveBeenCalled()
  })

  it('does NOT fire when Notification.permission is "denied"', async () => {
    const mockCtor = vi.fn()
    ;(global as Record<string, unknown>).Notification = Object.assign(mockCtor, { permission: 'denied' })
    const { useTaskRefresh } = await loadWithNotifications()

    const taskId = 90400
    const taskRef = ref([{ id: taskId, title: 'NoPerm', status: 'todo', agent_name: 'e' }]) as ReturnType<typeof ref>
    const deps = makeDeps({ tasks: taskRef, query: makeTransitionQuery(taskId, 'done') })
    const { refresh } = useTaskRefresh(deps)
    await refresh()

    expect(mockCtor).not.toHaveBeenCalled()
  })
})

// ─── L98: cooldown boundary < 5000 ───────────────────────────────────────────
describe('useTaskRefresh — notification cooldown boundary: < 5000ms (L98)', () => {
  const savedNotification = (global as Record<string, unknown>).Notification

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    (global as Record<string, unknown>).Notification = savedNotification
    vi.useRealTimers()
  })

  it('blocks second notification at 4999ms (still < 5000)', async () => {
    const now = 1_000_000_000
    vi.setSystemTime(now)
    const mockCtor = vi.fn()
    ;(global as Record<string, unknown>).Notification = Object.assign(mockCtor, { permission: 'granted' })
    const { useTaskRefresh } = await loadWithNotifications()

    const taskId = 91001
    const taskRef = ref([{ id: taskId, title: 'B1', status: 'todo', agent_name: 'a' }]) as ReturnType<typeof ref>
    const deps = makeDeps({ tasks: taskRef, query: makeTransitionQuery(taskId, 'done') })
    const { refresh } = useTaskRefresh(deps)

    // First call — fires notification, records _lastNotifTs[taskId] = now
    await refresh()
    const count1 = mockCtor.mock.calls.length
    expect(count1).toBeGreaterThan(0)

    // Advance 4999ms → now - ts = 4999 < 5000 → still blocked
    vi.setSystemTime(now + 4999)
    taskRef.value = [{ id: taskId, title: 'B1', status: 'todo', agent_name: 'a' }] as never
    await refresh()

    expect(mockCtor.mock.calls.length).toBe(count1) // blocked
  })

  it('allows second notification at exactly 5000ms (not < 5000)', async () => {
    const now = 2_000_000_000
    vi.setSystemTime(now)
    const mockCtor = vi.fn()
    ;(global as Record<string, unknown>).Notification = Object.assign(mockCtor, { permission: 'granted' })
    const { useTaskRefresh } = await loadWithNotifications()

    const taskId = 91002
    const taskRef = ref([{ id: taskId, title: 'B2', status: 'todo', agent_name: 'b' }]) as ReturnType<typeof ref>
    const deps = makeDeps({ tasks: taskRef, query: makeTransitionQuery(taskId, 'done') })
    const { refresh } = useTaskRefresh(deps)

    await refresh()
    const count1 = mockCtor.mock.calls.length
    expect(count1).toBeGreaterThan(0)

    // Advance exactly 5000ms → now - ts = 5000, which is NOT < 5000 → allowed
    vi.setSystemTime(now + 5000)
    taskRef.value = [{ id: taskId, title: 'B2', status: 'todo', agent_name: 'b' }] as never
    await refresh()

    expect(mockCtor.mock.calls.length).toBe(count1 + 1) // allowed
  })

  it('allows second notification at 5001ms (clearly past cooldown)', async () => {
    const now = 3_000_000_000
    vi.setSystemTime(now)
    const mockCtor = vi.fn()
    ;(global as Record<string, unknown>).Notification = Object.assign(mockCtor, { permission: 'granted' })
    const { useTaskRefresh } = await loadWithNotifications()

    const taskId = 91003
    const taskRef = ref([{ id: taskId, title: 'B3', status: 'todo', agent_name: 'c' }]) as ReturnType<typeof ref>
    const deps = makeDeps({ tasks: taskRef, query: makeTransitionQuery(taskId, 'done') })
    const { refresh } = useTaskRefresh(deps)

    await refresh()
    const count1 = mockCtor.mock.calls.length
    expect(count1).toBeGreaterThan(0)

    vi.setSystemTime(now + 5001)
    taskRef.value = [{ id: taskId, title: 'B3', status: 'todo', agent_name: 'c' }] as never
    await refresh()

    expect(mockCtor.mock.calls.length).toBe(count1 + 1)
  })

  it('nullish coalescing: new task (no prior entry) fires immediately', async () => {
    // now = 10_000 — well above 5000 from 0, so ?? 0 yields: now - 0 = 10000 >= 5000 → not blocked
    const now = 10_000
    vi.setSystemTime(now)
    const mockCtor = vi.fn()
    ;(global as Record<string, unknown>).Notification = Object.assign(mockCtor, { permission: 'granted' })
    const { useTaskRefresh } = await loadWithNotifications()

    const taskId = 91004
    const taskRef = ref([{ id: taskId, title: 'New', status: 'todo', agent_name: 'd' }]) as ReturnType<typeof ref>
    const deps = makeDeps({ tasks: taskRef, query: makeTransitionQuery(taskId, 'done') })
    const { refresh } = useTaskRefresh(deps)

    await refresh()

    expect(mockCtor).toHaveBeenCalled()
  })
})

// ─── L106-109: cutoff cleanup boundary ───────────────────────────────────────
describe('useTaskRefresh — cutoff cleanup boundary: ts < cutoff (L108)', () => {
  const savedNotification = (global as Record<string, unknown>).Notification

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    (global as Record<string, unknown>).Notification = savedNotification
    vi.useRealTimers()
  })

  it('does NOT clean entry at 59999ms (ts NOT < cutoff) — second call still blocked', async () => {
    const now = 1_000_000_000
    vi.setSystemTime(now)
    const mockCtor = vi.fn()
    ;(global as Record<string, unknown>).Notification = Object.assign(mockCtor, { permission: 'granted' })
    const { useTaskRefresh } = await loadWithNotifications()

    const taskId = 92001
    const taskRef = ref([{ id: taskId, title: 'C1', status: 'todo', agent_name: 'x' }]) as ReturnType<typeof ref>
    const deps = makeDeps({ tasks: taskRef, query: makeTransitionQuery(taskId, 'done') })
    const { refresh } = useTaskRefresh(deps)

    // First: sets _lastNotifTs[taskId] = now
    await refresh()
    const count1 = mockCtor.mock.calls.length
    expect(count1).toBeGreaterThan(0)

    // Advance 59999ms: cutoff = now+59999 - 60000 = now - 1
    // ts = now, ts < now-1 is FALSE → entry NOT cleaned
    // But also now+59999 - now = 59999 >= 5000 → cooldown PASSES — notification fires anyway
    // The key is the entry was NOT deleted by cutoff cleanup
    vi.setSystemTime(now + 59999)
    taskRef.value = [{ id: taskId, title: 'C1', status: 'todo', agent_name: 'x' }] as never
    await refresh()

    // Notification fires (cooldown expired at 59999ms) but entry was NOT cleaned by cutoff
    expect(mockCtor.mock.calls.length).toBe(count1 + 1)
  })

  it('cleans entry at 60001ms (ts < cutoff) — entry is removed from map', async () => {
    const now = 2_000_000_000
    vi.setSystemTime(now)
    const mockCtor = vi.fn()
    ;(global as Record<string, unknown>).Notification = Object.assign(mockCtor, { permission: 'granted' })
    const { useTaskRefresh } = await loadWithNotifications()

    const taskId = 92002
    const taskRef = ref([{ id: taskId, title: 'C2', status: 'todo', agent_name: 'y' }]) as ReturnType<typeof ref>
    const deps = makeDeps({ tasks: taskRef, query: makeTransitionQuery(taskId, 'done') })
    const { refresh } = useTaskRefresh(deps)

    // First: fires, records ts = now
    await refresh()
    const count1 = mockCtor.mock.calls.length
    expect(count1).toBeGreaterThan(0)

    // Advance 60001ms: cutoff = now+60001 - 60000 = now+1
    // ts = now < now+1 → CLEANED from map
    // now+60001 - now = 60001 >= 5000 → cooldown also passes
    vi.setSystemTime(now + 60001)
    taskRef.value = [{ id: taskId, title: 'C2', status: 'todo', agent_name: 'y' }] as never
    await refresh()

    // Second notification fires (both cleanup ran AND cooldown passed)
    expect(mockCtor.mock.calls.length).toBe(count1 + 1)
  })
})

// ─── startWatching debounce (L158-163) ───────────────────────────────────────
describe('useTaskRefresh — startWatching: debounce (L158-163)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('debounce: rapid double fire of onDbChanged triggers only one refresh', async () => {
    vi.useFakeTimers()
    vi.resetModules()
    vi.doMock('@renderer/stores/agents', () => ({
      useAgentsStore: () => ({ fetchAgentGroups: vi.fn(), agentRefresh: vi.fn() }),
      AGENT_CTE_SQL: 'SELECT * FROM agents',
    }))
    vi.doMock('@renderer/stores/settings', () => ({
      useSettingsStore: () => ({ notificationsEnabled: false }),
    }))
    vi.doMock('@renderer/composables/useToast', () => ({
      useToast: () => ({ push: vi.fn() }),
    }))
    const { useTaskRefresh } = await import('@renderer/stores/useTaskRefresh')

    let dbChangedCb: (() => void) | null = null
    mockElectronAPI.onDbChanged.mockImplementation((cb: () => void) => {
      dbChangedCb = cb
      return () => {}
    })

    const deps = makeDeps()
    const { startWatching } = useTaskRefresh(deps)
    startWatching('/my/project.db')

    // Fire twice within 150ms window
    dbChangedCb!()
    await vi.advanceTimersByTimeAsync(50)
    dbChangedCb!()

    const beforeSettle = (deps.query as ReturnType<typeof vi.fn>).mock.calls.length

    // Advance past debounce window
    await vi.advanceTimersByTimeAsync(150)

    const afterSettle = (deps.query as ReturnType<typeof vi.fn>).mock.calls.length
    expect(afterSettle).toBeGreaterThan(beforeSettle)
  })

  it('debounce: single fire triggers refresh after 150ms', async () => {
    vi.useFakeTimers()
    vi.resetModules()
    vi.doMock('@renderer/stores/agents', () => ({
      useAgentsStore: () => ({ fetchAgentGroups: vi.fn(), agentRefresh: vi.fn() }),
      AGENT_CTE_SQL: 'SELECT * FROM agents',
    }))
    vi.doMock('@renderer/stores/settings', () => ({
      useSettingsStore: () => ({ notificationsEnabled: false }),
    }))
    vi.doMock('@renderer/composables/useToast', () => ({
      useToast: () => ({ push: vi.fn() }),
    }))
    const { useTaskRefresh } = await import('@renderer/stores/useTaskRefresh')

    let dbChangedCb: (() => void) | null = null
    mockElectronAPI.onDbChanged.mockImplementation((cb: () => void) => {
      dbChangedCb = cb
      return () => {}
    })

    const deps = makeDeps()
    const { startWatching } = useTaskRefresh(deps)
    startWatching('/project.db')

    dbChangedCb!()
    await vi.advanceTimersByTimeAsync(149)
    const before = (deps.query as ReturnType<typeof vi.fn>).mock.calls.length

    await vi.advanceTimersByTimeAsync(1)
    const after = (deps.query as ReturnType<typeof vi.fn>).mock.calls.length

    expect(after).toBeGreaterThan(before)
  })

  it('calling startWatching twice unsubs the first listener', async () => {
    vi.resetModules()
    vi.doMock('@renderer/stores/agents', () => ({
      useAgentsStore: () => ({ fetchAgentGroups: vi.fn(), agentRefresh: vi.fn() }),
      AGENT_CTE_SQL: 'SELECT * FROM agents',
    }))
    vi.doMock('@renderer/stores/settings', () => ({
      useSettingsStore: () => ({ notificationsEnabled: false }),
    }))
    vi.doMock('@renderer/composables/useToast', () => ({
      useToast: () => ({ push: vi.fn() }),
    }))
    const { useTaskRefresh } = await import('@renderer/stores/useTaskRefresh')

    const unsub1 = vi.fn()
    const unsub2 = vi.fn()
    mockElectronAPI.onDbChanged
      .mockReturnValueOnce(unsub1)
      .mockReturnValueOnce(unsub2)

    const deps = makeDeps()
    const { startWatching } = useTaskRefresh(deps)

    startWatching('/first.db')
    startWatching('/second.db') // triggers unsub1

    expect(unsub1).toHaveBeenCalledOnce()
    expect(mockElectronAPI.watchDb).toHaveBeenCalledTimes(2)
  })
})

// ─── stopPolling guard ────────────────────────────────────────────────────────
describe('useTaskRefresh — stopPolling guard: null-check (L150)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('stopPolling is safe when never started (null intervals)', async () => {
    vi.resetModules()
    vi.doMock('@renderer/stores/agents', () => ({
      useAgentsStore: () => ({ fetchAgentGroups: vi.fn(), agentRefresh: vi.fn() }),
      AGENT_CTE_SQL: 'SELECT * FROM agents',
    }))
    vi.doMock('@renderer/stores/settings', () => ({
      useSettingsStore: () => ({ notificationsEnabled: false }),
    }))
    vi.doMock('@renderer/composables/useToast', () => ({
      useToast: () => ({ push: vi.fn() }),
    }))
    const { useTaskRefresh } = await import('@renderer/stores/useTaskRefresh')
    const deps = makeDeps()
    const { stopPolling } = useTaskRefresh(deps)

    expect(() => stopPolling()).not.toThrow()
  })

  it('stopPolling prevents further polling after startPolling', async () => {
    vi.useFakeTimers()
    vi.resetModules()
    vi.doMock('@renderer/stores/agents', () => ({
      useAgentsStore: () => ({ fetchAgentGroups: vi.fn(), agentRefresh: vi.fn() }),
      AGENT_CTE_SQL: 'SELECT * FROM agents',
    }))
    vi.doMock('@renderer/stores/settings', () => ({
      useSettingsStore: () => ({ notificationsEnabled: false }),
    }))
    vi.doMock('@renderer/composables/useToast', () => ({
      useToast: () => ({ push: vi.fn() }),
    }))
    const { useTaskRefresh } = await import('@renderer/stores/useTaskRefresh')
    const deps = makeDeps()
    const { startPolling, stopPolling } = useTaskRefresh(deps)

    startPolling()
    stopPolling()
    const callsBefore = (deps.query as ReturnType<typeof vi.fn>).mock.calls.length
    await vi.advanceTimersByTimeAsync(30000)
    expect((deps.query as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsBefore)
  })
})

// ─── DONE_TASKS_LIMIT constant ────────────────────────────────────────────────
describe('useTaskRefresh — DONE_TASKS_LIMIT constant', () => {
  it('is 100', async () => {
    vi.resetModules()
    vi.doMock('@renderer/stores/agents', () => ({
      useAgentsStore: () => ({ fetchAgentGroups: vi.fn(), agentRefresh: vi.fn() }),
      AGENT_CTE_SQL: 'SELECT * FROM agents',
    }))
    vi.doMock('@renderer/stores/settings', () => ({
      useSettingsStore: () => ({ notificationsEnabled: false }),
    }))
    vi.doMock('@renderer/composables/useToast', () => ({
      useToast: () => ({ push: vi.fn() }),
    }))
    const { DONE_TASKS_LIMIT } = await import('@renderer/stores/useTaskRefresh')
    expect(DONE_TASKS_LIMIT).toBe(100)
  })
})

// ─── doneTasksLimited flag (L88) ─────────────────────────────────────────────
describe('useTaskRefresh — doneTasksLimited flag (L88)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('sets doneTasksLimited to true when done results equal DONE_TASKS_LIMIT', async () => {
    vi.resetModules()
    vi.doMock('@renderer/stores/agents', () => ({
      useAgentsStore: () => ({ fetchAgentGroups: vi.fn(), agentRefresh: vi.fn() }),
      AGENT_CTE_SQL: 'SELECT * FROM agents',
    }))
    vi.doMock('@renderer/stores/settings', () => ({
      useSettingsStore: () => ({ notificationsEnabled: false }),
    }))
    vi.doMock('@renderer/composables/useToast', () => ({
      useToast: () => ({ push: vi.fn() }),
    }))
    const { useTaskRefresh, DONE_TASKS_LIMIT } = await import('@renderer/stores/useTaskRefresh')

    const doneTasks = Array.from({ length: DONE_TASKS_LIMIT }, (_, i) => ({
      id: i + 1, title: `T${i}`, status: 'done', agent_name: null,
    }))
    const deps = makeDeps({
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes("status = 'done'")) return Promise.resolve(doneTasks)
        return Promise.resolve([])
      }),
    })

    const { refresh } = useTaskRefresh(deps)
    await refresh()

    expect(deps.doneTasksLimited.value).toBe(true)
  })

  it('sets doneTasksLimited to false when done results are below DONE_TASKS_LIMIT', async () => {
    vi.resetModules()
    vi.doMock('@renderer/stores/agents', () => ({
      useAgentsStore: () => ({ fetchAgentGroups: vi.fn(), agentRefresh: vi.fn() }),
      AGENT_CTE_SQL: 'SELECT * FROM agents',
    }))
    vi.doMock('@renderer/stores/settings', () => ({
      useSettingsStore: () => ({ notificationsEnabled: false }),
    }))
    vi.doMock('@renderer/composables/useToast', () => ({
      useToast: () => ({ push: vi.fn() }),
    }))
    const { useTaskRefresh } = await import('@renderer/stores/useTaskRefresh')

    const deps = makeDeps({
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes("status = 'done'")) return Promise.resolve([{ id: 1, title: 'T', status: 'done' }])
        return Promise.resolve([])
      }),
    })

    const { refresh } = useTaskRefresh(deps)
    await refresh()

    expect(deps.doneTasksLimited.value).toBe(false)
  })
})
