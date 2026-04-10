/**
 * T1313: Guard mutations for useAutoLaunch.ts
 *
 * Targets:
 * - Status change guard (prevStatus === undefined -> no trigger)
 * - Agent null guard (!agent check) and auto_launch=0 guard
 * - agent_assigned_id null guard
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { nextTick } from 'vue'
import { useAutoLaunch } from './useAutoLaunch'
import { useTabsStore } from '@renderer/stores/tabs'
import { api, makeTask, makeAgent, setupTestEnv } from './__helpers__/useAutoLaunch-t1313.helpers'
import type { TestRefs } from './__helpers__/useAutoLaunch-t1313.helpers'

describe('useAutoLaunch T1313: status change guard — prevStatus undefined', () => {
  let refs: TestRefs

  beforeEach(() => {
    refs = setupTestEnv({ date: [2026, 8, 1], queryDbResult: [] })
  })

  afterEach(() => { vi.useRealTimers() })

  it('should NOT schedule close when prevStatus is undefined (new task appearing as done)', async () => {
    // prevStatus guard: prevStatus && prevStatus !== 'done'
    // A brand-new task that appears directly with status='done' has prevStatus=undefined.
    // The guard `prevStatus && ...` must reject it (prevent close on first appearance).
    api.queryDb.mockResolvedValue([])
    useAutoLaunch(refs)

    // Seed: no tasks
    refs.tasks.value = []
    await nextTick()

    const tabsStore = useTabsStore()
    tabsStore.addTerminal('dev-front-vuejs', 'Ubuntu-24.04')
    const termTab = tabsStore.tabs.find(t => t.type === 'terminal')!
    termTab.taskId = 99
    termTab.streamId = 'stream-new-done'

    // New task appears directly as done (prevStatus = undefined in previousStatuses)
    refs.tasks.value = [makeTask({ id: 99, status: 'done', agent_assigned_id: 10 })]
    await nextTick()
    await vi.advanceTimersByTimeAsync(200)

    // task-done path: prevStatus=undefined -> condition fails -> no scheduleClose from Chemin 1
    // (Chemin 2 / no-task path will try since tab has taskId=99 but that tab HAS a taskId,
    //  so Chemin 2 skips it via `if (tab.taskId) continue`)
    expect(api.agentKill).not.toHaveBeenCalled()
  })
})

describe('useAutoLaunch T1313: agent null guard — no agent found', () => {
  let refs: TestRefs

  beforeEach(() => {
    refs = setupTestEnv({ date: [2026, 8, 2], queryDbResult: [], agents: [] })
  })

  afterEach(() => { vi.useRealTimers() })

  it('should NOT schedule close when agent_assigned_id has no matching agent', async () => {
    // !agent guard: task references agent_assigned_id=999 which is not in agents list
    // agents.value.find() returns undefined -> `if (!agent || ...) continue` skips it
    useAutoLaunch(refs)

    // Seed: in_progress task with unknown agent
    refs.tasks.value = [makeTask({ id: 1, status: 'in_progress', agent_assigned_id: 999 })]
    await nextTick()

    // Task done: no agent in list -> no scheduleClose
    refs.tasks.value = [makeTask({ id: 1, status: 'done', agent_assigned_id: 999 })]
    await nextTick()
    await vi.advanceTimersByTimeAsync(200)

    expect(api.queryDb).not.toHaveBeenCalled()
    expect(api.agentKill).not.toHaveBeenCalled()
  })
})

describe('useAutoLaunch T1313: agent_assigned_id null guard', () => {
  let refs: TestRefs

  beforeEach(() => {
    refs = setupTestEnv({ date: [2026, 8, 7], queryDbResult: [] })
  })

  afterEach(() => { vi.useRealTimers() })

  it('should NOT trigger scheduleClose when task.agent_assigned_id is null', async () => {
    // Chemin 1 condition: `&& task.agent_assigned_id` — null stops the chain before agent lookup
    useAutoLaunch(refs)

    refs.tasks.value = [makeTask({ id: 1, status: 'in_progress', agent_assigned_id: null as unknown as number })]
    await nextTick()

    const tabsStore = useTabsStore()
    tabsStore.addTerminal('dev-front-vuejs', 'Ubuntu-24.04')
    const termTab = tabsStore.tabs.find(t => t.type === 'terminal')!
    termTab.taskId = 1
    termTab.streamId = 'stream-null-agent-id'

    refs.tasks.value = [makeTask({ id: 1, status: 'done', agent_assigned_id: null as unknown as number })]
    await nextTick()
    await vi.advanceTimersByTimeAsync(200)

    expect(api.agentKill).not.toHaveBeenCalled()
  })
})
