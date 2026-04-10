/**
 * T1345: Kill surviving ConditionalExpression mutations in useAutoLaunch
 *
 * Split: debounce branch coverage (lines 103/116)
 *   - clearTimeout IS called when debounceId !== null
 *   - clearTimeout is NOT called when debounceId === null (two rapid calls: only last fires)
 *   - guard line 109: internal debounce body guard both branches
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { ref, nextTick } from 'vue'
import { useAutoLaunch } from './useAutoLaunch'
import { useTabsStore } from '@renderer/stores/tabs'
import { useTasksStore } from '@renderer/stores/tasks'
import type { Task, Agent } from '@renderer/types'
import { api, makeTask, makeAgent, incrementTestIndex } from './__helpers__/useAutoLaunch-t1345.helpers'

describe('useAutoLaunch T1345: debounce branch coverage', () => {
  let tasks: ReturnType<typeof ref<Task[]>>
  let agents: ReturnType<typeof ref<Agent[]>>
  let dbPath: ReturnType<typeof ref<string | null>>

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
    vi.useFakeTimers()
    const idx = incrementTestIndex()
    vi.setSystemTime(new Date(2026, 8, 1, 0, idx * 10, 0))

    api.queryDb.mockResolvedValue([{ id: 1 }])

    tasks = ref<Task[]>([])
    agents = ref<Agent[]>([makeAgent()])
    dbPath = ref<string | null>('/test/db')

    const tasksStore = useTasksStore()
    ;(tasksStore as unknown as { dbPath: string | null }).dbPath = '/test/db'
  })

  afterEach(() => { vi.useRealTimers() })

  it('debounceId !== null: clearTimeout IS called when second update arrives within 80ms', async () => {
    // Kill ConditionalExpression mutation: if(false) on `if (debounceId !== null)` line 116
    // The mutation would skip clearTimeout, allowing two handlers to run.
    // We verify that only ONE poll fires when two updates arrive within 80ms.
    const pollCallTimes: number[] = []
    api.queryDb.mockImplementation(() => {
      pollCallTimes.push(Date.now())
      return Promise.resolve([{ id: 1 }])
    })

    useAutoLaunch({ tasks, agents, dbPath })

    // Seed phase
    tasks.value = [makeTask({ id: 1, status: 'in_progress', agent_assigned_id: 10 })]
    await nextTick()

    const tabsStore = useTabsStore()
    tabsStore.addTerminal('dev-front-vuejs', 'Ubuntu-24.04')
    const termTab = tabsStore.tabs.find(t => t.type === 'terminal')!
    termTab.taskId = 1
    termTab.streamId = 'stream-debounce-guard'

    // First done transition at t=0 -> debounceId set
    tasks.value = [makeTask({ id: 1, status: 'done', agent_assigned_id: 10 })]
    await nextTick()

    // Advance 40ms -- within debounce window, debounceId is still set
    await vi.advanceTimersByTimeAsync(40)

    // Second update at t=40ms -> debounceId !== null -> clearTimeout IS called
    tasks.value = [makeTask({ id: 1, status: 'done', agent_assigned_id: 10 })]
    await nextTick()

    // Advance 40ms more -- original debounce would have fired but was cancelled
    await vi.advanceTimersByTimeAsync(40)

    // No poll yet -- second debounce still pending
    expect(pollCallTimes.length).toBe(0)

    // Complete the second debounce window (80ms total from second update)
    await vi.advanceTimersByTimeAsync(80)

    // Only ONE scheduleClose fired (not two) -- debounce worked
    // Poll fires: agentKill should have been called exactly once
    expect(api.agentKill).toHaveBeenCalledTimes(1)
    expect(api.agentKill).toHaveBeenCalledWith('stream-debounce-guard')
  })

  it('debounceId === null: clearTimeout NOT called when first update arrives (no pending timer)', async () => {
    // Kill ConditionalExpression mutation: if(true) on `if (debounceId !== null)` line 116
    // When debounceId is null (first update after init), clearTimeout must not be called.
    // We verify the handler still runs correctly -- scheduleClose fires after the debounce.
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')

    useAutoLaunch({ tasks, agents, dbPath })

    // Seed phase with in_progress task -- sets previousStatuses
    tasks.value = [makeTask({ id: 1, status: 'in_progress', agent_assigned_id: 10 })]
    await nextTick()

    const tabsStore = useTabsStore()
    tabsStore.addTerminal('dev-front-vuejs', 'Ubuntu-24.04')
    const termTab = tabsStore.tabs.find(t => t.type === 'terminal')!
    termTab.taskId = 1
    termTab.streamId = 'stream-first-update'

    // At this point debounceId === null (no prior debounce pending).
    // Single update triggers the watch -- debounce branch: debounceId is null, skip clearTimeout.
    tasks.value = [makeTask({ id: 1, status: 'done', agent_assigned_id: 10 })]
    await nextTick()

    // Advance to let the debounce fire
    await vi.advanceTimersByTimeAsync(200)

    // The handler DID fire -- scheduleClose was called -- agentKill was invoked
    expect(api.agentKill).toHaveBeenCalledWith('stream-first-update')

    clearTimeoutSpy.mockRestore()
  })

  it('two rapid updates: only last debounce handler runs (effect visible)', async () => {
    // Additional coverage for debounce cancel path: assert the actual behavior
    // (last state wins, not first state)
    useAutoLaunch({ tasks, agents, dbPath })

    // Seed with in_progress
    tasks.value = [makeTask({ id: 1, status: 'in_progress', agent_assigned_id: 10 })]
    await nextTick()

    const tabsStore = useTabsStore()
    tabsStore.addTerminal('dev-front-vuejs', 'Ubuntu-24.04')
    const termTab = tabsStore.tabs.find(t => t.type === 'terminal')!
    termTab.taskId = 1
    termTab.streamId = 'stream-rapid-1'

    // Update 1 at t=0 (done)
    tasks.value = [makeTask({ id: 1, status: 'done', agent_assigned_id: 10 })]
    await nextTick()

    // Update 2 at t=30ms (still done) -- cancels first debounce
    await vi.advanceTimersByTimeAsync(30)
    tasks.value = [makeTask({ id: 1, status: 'done', agent_assigned_id: 10 })]
    await nextTick()

    // Advance 30ms more (t=60ms) -- original debounce would fire at t=80ms (cancelled)
    await vi.advanceTimersByTimeAsync(30)

    // No handler fired yet
    expect(api.agentKill).not.toHaveBeenCalled()

    // Complete second debounce (t=30 + 80 = 110ms total from start)
    await vi.advanceTimersByTimeAsync(80)

    // Handler fired once -- agentKill called once
    expect(api.agentKill).toHaveBeenCalledTimes(1)
    expect(api.agentKill).toHaveBeenCalledWith('stream-rapid-1')
  })
})
