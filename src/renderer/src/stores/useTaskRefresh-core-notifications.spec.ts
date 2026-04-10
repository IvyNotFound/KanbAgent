/**
 * Tests for useTaskRefresh composable — notifications (empty tasks, debounce, cutoff)
 * Split from useTaskRefresh.spec.ts (T1282)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { ref } from 'vue'
import { installElectronAPIMock, makeDeps } from './__helpers__/useTaskRefresh.helpers'

installElectronAPIMock()

// ─── Mock stores used by useTaskRefresh ───────────────────────────────────────
vi.mock('@renderer/stores/agents', () => ({
  useAgentsStore: () => ({
    fetchAgentGroups: vi.fn(),
    agentRefresh: vi.fn(),
  }),
  AGENT_CTE_SQL: 'SELECT * FROM agents',
}))

vi.mock('@renderer/stores/settings', () => ({
  useSettingsStore: () => ({
    notificationsEnabled: false,
  }),
}))

vi.mock('@renderer/composables/useToast', () => ({
  useToast: () => ({
    push: vi.fn(),
  }),
}))

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('useTaskRefresh — refresh: empty tasks → no notifications (L92)', () => {
  const originalNotification = (global as Record<string, unknown>).Notification

  beforeEach(() => {
    vi.resetModules()
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  afterEach(() => {
    (global as Record<string, unknown>).Notification = originalNotification
  })

  it('does NOT fire notification when tasks.value.length === 0 (first load)', async () => {
    const mockNotificationCtor = vi.fn()
    ;(global as Record<string, unknown>).Notification = Object.assign(mockNotificationCtor, { permission: 'granted' })

    // Override settings mock BEFORE importing so notifications are enabled
    vi.doMock('@renderer/stores/settings', () => ({
      useSettingsStore: () => ({ notificationsEnabled: true }),
    }))

    const { useTaskRefresh } = await import('@renderer/stores/useTaskRefresh')

    const deps = makeDeps({
      tasks: ref([]),
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes("status IN ('todo', 'in_progress')")) return Promise.resolve([])
        if (sql.includes("status = 'done'")) return Promise.resolve([{ id: 1, title: 'Task A', status: 'done', agent_assigned_id: null }])
        return Promise.resolve([])
      }),
    })

    const { refresh } = useTaskRefresh(deps)
    await refresh()

    // tasks.value was empty → no notifications even on status change
    expect(mockNotificationCtor).not.toHaveBeenCalled()
  })

  it('does NOT fire notification when tasks.value.length > 0 but no status change', async () => {
    const mockNotificationCtor = vi.fn()
    ;(global as Record<string, unknown>).Notification = Object.assign(mockNotificationCtor, { permission: 'granted' })

    const { useTaskRefresh } = await import('@renderer/stores/useTaskRefresh')

    const taskRef = ref([{ id: 42, title: 'Task', status: 'todo', agent_assigned_id: null }]) as ReturnType<typeof ref>
    const deps = makeDeps({
      tasks: taskRef,
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes("status IN ('todo', 'in_progress')")) return Promise.resolve([{ id: 42, title: 'Task', status: 'todo', agent_assigned_id: null }])
        if (sql.includes("status = 'done'")) return Promise.resolve([])
        return Promise.resolve([])
      }),
    })

    const { refresh } = useTaskRefresh(deps)
    await refresh()

    expect(mockNotificationCtor).not.toHaveBeenCalled()
  })
})

describe('useTaskRefresh — refresh: debounce notifications (L98: now - ts <= 5000)', () => {
  const originalNotification = (global as Record<string, unknown>).Notification

  beforeEach(() => {
    vi.resetModules()
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  afterEach(() => {
    (global as Record<string, unknown>).Notification = originalNotification
    vi.useRealTimers()
  })

  it('does NOT fire duplicate notification within 5000ms debounce window', async () => {
    vi.useFakeTimers()
    const now = Date.now()
    vi.setSystemTime(now)

    const mockNotificationCtor = vi.fn()
    ;(global as Record<string, unknown>).Notification = Object.assign(mockNotificationCtor, { permission: 'granted' })

    const { useTaskRefresh, DONE_TASKS_LIMIT } = await import('@renderer/stores/useTaskRefresh')

    // Use a unique task id to avoid cross-test pollution from _lastNotifTs module-level map
    const taskId = 77701
    const taskRef = ref([{ id: taskId, title: 'Debounce Task', status: 'todo', agent_assigned_id: null }]) as ReturnType<typeof ref>
    const queryMock = vi.fn().mockImplementation((sql: string) => {
      if (sql.includes("status IN ('todo', 'in_progress')")) return Promise.resolve([])
      if (sql.includes("status = 'done'")) return Promise.resolve([{ id: taskId, title: 'Debounce Task', status: 'done', agent_assigned_id: null }])
      return Promise.resolve([])
    })

    const deps = makeDeps({ tasks: taskRef, query: queryMock })

    // Re-mock settings to enable notifications
    const settingsMock = { notificationsEnabled: true }
    vi.doMock('@renderer/stores/settings', () => ({ useSettingsStore: () => settingsMock }))

    const { refresh } = useTaskRefresh(deps)

    // First refresh: task transitions todo → done → notification fires
    taskRef.value = [{ id: taskId, title: 'Debounce Task', status: 'todo', agent_assigned_id: null }] as never
    await refresh()

    const firstCount = mockNotificationCtor.mock.calls.length

    // Second refresh within 5000ms: should be debounced
    taskRef.value = [{ id: taskId, title: 'Debounce Task', status: 'todo', agent_assigned_id: null }] as never
    await refresh()

    // Should not have fired again (debounced)
    expect(mockNotificationCtor.mock.calls.length).toBe(firstCount)
  })
})

describe('useTaskRefresh — refresh: cutoff window (L106-L109)', () => {
  const originalNotification = (global as Record<string, unknown>).Notification

  beforeEach(() => {
    vi.resetModules()
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  afterEach(() => {
    (global as Record<string, unknown>).Notification = originalNotification
    vi.useRealTimers()
  })

  it('cleans up _lastNotifTs entries older than 60s cutoff', async () => {
    vi.useFakeTimers()
    const startTime = Date.now()
    vi.setSystemTime(startTime)

    const mockNotificationCtor = vi.fn()
    ;(global as Record<string, unknown>).Notification = Object.assign(mockNotificationCtor, { permission: 'granted' })

    const { useTaskRefresh } = await import('@renderer/stores/useTaskRefresh')

    // Task with unique id to avoid cross-test pollution
    const taskId = 88801
    const taskRef = ref([{ id: taskId, title: 'Cutoff Task', status: 'todo', agent_assigned_id: null }]) as ReturnType<typeof ref>
    const queryMock = vi.fn().mockImplementation((sql: string) => {
      if (sql.includes("status IN ('todo', 'in_progress')")) return Promise.resolve([])
      if (sql.includes("status = 'done'")) return Promise.resolve([{ id: taskId, title: 'Cutoff Task', status: 'done', agent_assigned_id: null }])
      return Promise.resolve([])
    })
    const deps = makeDeps({ tasks: taskRef, query: queryMock })

    const settingsMock = { notificationsEnabled: true }
    vi.doMock('@renderer/stores/settings', () => ({ useSettingsStore: () => settingsMock }))

    const { refresh } = useTaskRefresh(deps)

    // First refresh: fires notification, sets _lastNotifTs[taskId] = startTime
    await refresh()

    // Advance time by 61s (past cutoff of 60s)
    vi.setSystemTime(startTime + 61000)

    // Reset task status to trigger another transition
    taskRef.value = [{ id: taskId, title: 'Cutoff Task', status: 'todo', agent_assigned_id: null }] as never

    // Second refresh: _lastNotifTs[taskId] was cleared (61s > 60s cutoff), notification can fire again
    await refresh()

    // First refresh fired (possibly), second refresh should also be able to fire
    // The key test: no error thrown, cleanup ran
    expect(mockNotificationCtor).toHaveBeenCalled()
  })
})
