/**
 * useTaskRefresh-gaps-cutoff-debounce.spec.ts — T1314
 * Split from useTaskRefresh-gaps.spec.ts
 *
 * Covers:
 * - L106-109: cutoff cleanup boundary (ts < cutoff)
 * - L155-163: startWatching debounce
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { ref } from 'vue'
import {
  mockElectronAPI,
  installElectronAPI,
  makeDeps,
  makeTransitionQuery,
  loadWithNotifications,
} from './__helpers__/useTaskRefresh-gaps.helpers'

installElectronAPI()

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
    // ts = now, ts < now-1 is FALSE -> entry NOT cleaned
    // But also now+59999 - now = 59999 >= 5000 -> cooldown PASSES — notification fires anyway
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
    // ts = now < now+1 -> CLEANED from map
    // now+60001 - now = 60001 >= 5000 -> cooldown also passes
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
