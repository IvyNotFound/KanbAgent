/**
 * useTaskRefresh-gaps-polling-limit.spec.ts — T1314
 * Split from useTaskRefresh-gaps.spec.ts
 *
 * Covers:
 * - L150-152: stopPolling guard (null-check branches)
 * - DONE_TASKS_LIMIT constant
 * - L88: doneTasksLimited flag (=== DONE_TASKS_LIMIT)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import {
  installElectronAPI,
  makeDeps,
} from './__helpers__/useTaskRefresh-gaps.helpers'

installElectronAPI()

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
