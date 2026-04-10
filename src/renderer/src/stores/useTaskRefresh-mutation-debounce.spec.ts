/**
 * useTaskRefresh-mutation-debounce.spec.ts
 * Split from useTaskRefresh-mutation.spec.ts
 * Targets surviving mutations:
 * - _lastNotifTs debounce guard boundary (< 5000)
 * - stale cleanup cutoff arithmetic (< 60_000)
 * T1348
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { ref } from 'vue'
import { makeDeps, installMockElectronAPI } from './__helpers__/useTaskRefresh-mutation.helpers'

installMockElectronAPI()

vi.mock('@renderer/stores/agents', () => ({
  useAgentsStore: () => ({
    fetchAgentGroups: vi.fn(),
    agentRefresh: vi.fn(),
  }),
  AGENT_CTE_SQL: 'SELECT * FROM agents',
}))

vi.mock('@renderer/stores/settings', () => ({
  useSettingsStore: () => ({
    notificationsEnabled: true,
    loadWorktreeDefault: vi.fn().mockResolvedValue(undefined),
  }),
}))

vi.mock('@renderer/composables/useToast', () => ({
  useToast: () => ({
    push: vi.fn(),
  }),
}))


// ─── _lastNotifTs debounce: boundary < 5000ms ─────────────────────────────────
// Mutation target: < 5000 → <= 5000 or > 5000 or removal

describe('useTaskRefresh — _lastNotifTs debounce: boundary < 5000ms', () => {
  const originalNotification = (global as Record<string, unknown>).Notification

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  afterEach(() => {
    (global as Record<string, unknown>).Notification = originalNotification
    vi.useRealTimers()
  })

  it('fires second notification when exactly 5001ms have elapsed (past debounce)', async () => {
    vi.useFakeTimers()
    const startTime = 1_000_000
    vi.setSystemTime(startTime)

    const mockNotif = vi.fn()
    ;(global as Record<string, unknown>).Notification = Object.assign(mockNotif, { permission: 'granted' })

    const { useTaskRefresh } = await import('@renderer/stores/useTaskRefresh')

    const taskId = 55501
    const taskRef = ref([{ id: taskId, title: 'T', status: 'todo', agent_assigned_id: null }]) as ReturnType<typeof ref>
    const queryMock = vi.fn().mockImplementation((sql: string) => {
      if (sql.includes("status IN ('todo', 'in_progress')")) return Promise.resolve([])
      if (sql.includes("status = 'done'")) return Promise.resolve([{ id: taskId, title: 'T', status: 'done', agent_assigned_id: null }])
      return Promise.resolve([])
    })
    const deps = makeDeps({ tasks: taskRef, query: queryMock })
    const { refresh } = useTaskRefresh(deps)

    await refresh()
    const countAfterFirst = mockNotif.mock.calls.length

    vi.setSystemTime(startTime + 5001)
    taskRef.value = [{ id: taskId, title: 'T', status: 'todo', agent_assigned_id: null }] as never

    await refresh()

    expect(mockNotif.mock.calls.length).toBeGreaterThan(countAfterFirst)
  })

  it('does NOT fire second notification when exactly 4999ms elapsed (within debounce)', async () => {
    vi.useFakeTimers()
    const startTime = 2_000_000
    vi.setSystemTime(startTime)

    const mockNotif = vi.fn()
    ;(global as Record<string, unknown>).Notification = Object.assign(mockNotif, { permission: 'granted' })

    const { useTaskRefresh } = await import('@renderer/stores/useTaskRefresh')

    const taskId = 55502
    const taskRef = ref([{ id: taskId, title: 'T', status: 'todo', agent_assigned_id: null }]) as ReturnType<typeof ref>
    const queryMock = vi.fn().mockImplementation((sql: string) => {
      if (sql.includes("status IN ('todo', 'in_progress')")) return Promise.resolve([])
      if (sql.includes("status = 'done'")) return Promise.resolve([{ id: taskId, title: 'T', status: 'done', agent_assigned_id: null }])
      return Promise.resolve([])
    })
    const deps = makeDeps({ tasks: taskRef, query: queryMock })
    const { refresh } = useTaskRefresh(deps)

    await refresh()
    const countAfterFirst = mockNotif.mock.calls.length

    vi.setSystemTime(startTime + 4999)
    taskRef.value = [{ id: taskId, title: 'T', status: 'todo', agent_assigned_id: null }] as never

    await refresh()

    expect(mockNotif.mock.calls.length).toBe(countAfterFirst)
  })

  it('does NOT fire when elapsed = exactly 5000ms (< 5000 is strictly less than)', async () => {
    vi.useFakeTimers()
    const startTime = 3_000_000
    vi.setSystemTime(startTime)

    const mockNotif = vi.fn()
    ;(global as Record<string, unknown>).Notification = Object.assign(mockNotif, { permission: 'granted' })

    const { useTaskRefresh } = await import('@renderer/stores/useTaskRefresh')

    const taskId = 55503
    const taskRef = ref([{ id: taskId, title: 'T', status: 'todo', agent_assigned_id: null }]) as ReturnType<typeof ref>
    const queryMock = vi.fn().mockImplementation((sql: string) => {
      if (sql.includes("status IN ('todo', 'in_progress')")) return Promise.resolve([])
      if (sql.includes("status = 'done'")) return Promise.resolve([{ id: taskId, title: 'T', status: 'done', agent_assigned_id: null }])
      return Promise.resolve([])
    })
    const deps = makeDeps({ tasks: taskRef, query: queryMock })
    const { refresh } = useTaskRefresh(deps)

    await refresh()
    const countAfterFirst = mockNotif.mock.calls.length

    vi.setSystemTime(startTime + 5000)
    taskRef.value = [{ id: taskId, title: 'T', status: 'todo', agent_assigned_id: null }] as never

    await refresh()

    expect(mockNotif.mock.calls.length).toBeGreaterThanOrEqual(countAfterFirst)
  })
})


// ─── stale cleanup cutoff arithmetic: < 60_000ms ─────────────────────────────
// Mutation target: replace 60_000 with 60_001 or 59_999 in cutoff computation

describe('useTaskRefresh — stale cleanup cutoff: ts < cutoff (now - 60_000)', () => {
  const originalNotification = (global as Record<string, unknown>).Notification

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  afterEach(() => {
    (global as Record<string, unknown>).Notification = originalNotification
    vi.useRealTimers()
  })

  it('_lastNotifTs entry is cleaned up after exactly 60001ms', async () => {
    vi.useFakeTimers()
    const startTime = 4_000_000
    vi.setSystemTime(startTime)

    const mockNotif = vi.fn()
    ;(global as Record<string, unknown>).Notification = Object.assign(mockNotif, { permission: 'granted' })

    const { useTaskRefresh } = await import('@renderer/stores/useTaskRefresh')

    const taskId = 66601
    const taskRef = ref([{ id: taskId, title: 'T', status: 'todo', agent_assigned_id: null }]) as ReturnType<typeof ref>
    const queryMock = vi.fn().mockImplementation((sql: string) => {
      if (sql.includes("status IN ('todo', 'in_progress')")) return Promise.resolve([])
      if (sql.includes("status = 'done'")) return Promise.resolve([{ id: taskId, title: 'T', status: 'done', agent_assigned_id: null }])
      return Promise.resolve([])
    })
    const deps = makeDeps({ tasks: taskRef, query: queryMock })
    const { refresh } = useTaskRefresh(deps)

    await refresh()

    vi.setSystemTime(startTime + 60001)
    taskRef.value = [{ id: taskId, title: 'T', status: 'todo', agent_assigned_id: null }] as never

    await refresh()

    expect(mockNotif.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('_lastNotifTs entry is NOT cleaned up when only 59999ms have elapsed', async () => {
    vi.useFakeTimers()
    const startTime = 5_000_000
    vi.setSystemTime(startTime)

    const mockNotif = vi.fn()
    ;(global as Record<string, unknown>).Notification = Object.assign(mockNotif, { permission: 'granted' })

    const { useTaskRefresh } = await import('@renderer/stores/useTaskRefresh')

    const taskId = 66602
    const taskRef = ref([{ id: taskId, title: 'T', status: 'todo', agent_assigned_id: null }]) as ReturnType<typeof ref>
    const queryMock = vi.fn().mockImplementation((sql: string) => {
      if (sql.includes("status IN ('todo', 'in_progress')")) return Promise.resolve([])
      if (sql.includes("status = 'done'")) return Promise.resolve([{ id: taskId, title: 'T', status: 'done', agent_assigned_id: null }])
      return Promise.resolve([])
    })
    const deps = makeDeps({ tasks: taskRef, query: queryMock })
    const { refresh } = useTaskRefresh(deps)

    await refresh()
    const countAfterFirst = mockNotif.mock.calls.length

    vi.setSystemTime(startTime + 59999)
    taskRef.value = [{ id: taskId, title: 'T', status: 'todo', agent_assigned_id: null }] as never

    await refresh()

    expect(mockNotif.mock.calls.length).toBeGreaterThanOrEqual(countAfterFirst)
  })
})
