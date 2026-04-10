/**
 * T1313: Tab filter and dbPath watcher mutations for useAutoLaunch.ts
 *
 * Targets:
 * - Tab filter: task-linked tab must match taskId (not just agentName)
 * - Tab existence check: no tab for agent -> no scheduleClose
 * - dbPath watcher: pendingCloses cleared when non-empty (L175-177)
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { nextTick } from 'vue'
import { useAutoLaunch } from './useAutoLaunch'
import { useTabsStore } from '@renderer/stores/tabs'
import { api, makeTask, makeAgent, setupTestEnv } from './__helpers__/useAutoLaunch-t1313.helpers'
import type { TestRefs } from './__helpers__/useAutoLaunch-t1313.helpers'

describe('useAutoLaunch T1313: tab filter — taskId mismatch', () => {
  let refs: TestRefs

  beforeEach(() => {
    refs = setupTestEnv({ date: [2026, 8, 3], queryDbResult: [] })
  })

  afterEach(() => { vi.useRealTimers() })

  it('should NOT close a tab whose taskId does not match the done task', async () => {
    // t.taskId === task.id: tab is open for agent dev-front-vuejs but linked to task 2,
    // while task 1 transitions to done -> tab 2 must NOT be closed (wrong taskId).
    useAutoLaunch(refs)

    refs.tasks.value = [makeTask({ id: 1, status: 'in_progress', agent_assigned_id: 10 })]
    await nextTick()

    const tabsStore = useTabsStore()
    // Tab is linked to task 2, not task 1
    tabsStore.addTerminal('dev-front-vuejs', 'Ubuntu-24.04')
    const termTab = tabsStore.tabs.find(t => t.type === 'terminal')!
    termTab.taskId = 2
    termTab.streamId = 'stream-wrong-taskid'

    // Task 1 transitions to done (but the tab is for task 2)
    refs.tasks.value = [makeTask({ id: 1, status: 'done', agent_assigned_id: 10 })]
    await nextTick()
    await vi.advanceTimersByTimeAsync(200)

    // Chemin 1: find returns undefined (tab.taskId=2 != task.id=1) -> no close
    // Chemin 2: tab has taskId=2 -> `if (tab.taskId) continue` -> skipped
    expect(api.agentKill).not.toHaveBeenCalled()
    expect(tabsStore.tabs.filter(t => t.type === 'terminal')).toHaveLength(1)
  })

  it('should NOT close when no tab has agentName matching the done task agent', async () => {
    // tab.agentName === agent.name: open tab is for 'other-agent', not 'dev-front-vuejs'
    useAutoLaunch(refs)

    refs.tasks.value = [makeTask({ id: 1, status: 'in_progress', agent_assigned_id: 10 })]
    await nextTick()

    const tabsStore = useTabsStore()
    // Different agent in the terminal
    tabsStore.addTerminal('other-agent', 'Ubuntu-24.04')
    const termTab = tabsStore.tabs.find(t => t.type === 'terminal')!
    termTab.taskId = 1
    termTab.streamId = 'stream-wrong-agent'

    refs.tasks.value = [makeTask({ id: 1, status: 'done', agent_assigned_id: 10 })]
    await nextTick()
    await vi.advanceTimersByTimeAsync(200)

    // Chemin 1: find returns undefined (agentName mismatch) -> no scheduleClose
    expect(api.agentKill).not.toHaveBeenCalled()
    expect(tabsStore.tabs.filter(t => t.type === 'terminal')).toHaveLength(1)
  })
})

describe('useAutoLaunch T1313: dbPath watcher — clears non-empty pendingCloses (L175-177)', () => {
  let refs: TestRefs

  beforeEach(() => {
    refs = setupTestEnv({ date: [2026, 8, 4], queryDbResult: [] })
  })

  afterEach(() => { vi.useRealTimers() })

  it('should stop polling and clear pendingCloses when dbPath changes (L175-177)', async () => {
    // This exercises L175 (clearInterval) and L177 (pendingCloses.clear())
    // by ensuring pendingCloses is populated before the dbPath change.
    useAutoLaunch(refs)

    // Seed task in_progress
    refs.tasks.value = [makeTask({ id: 1, status: 'in_progress', agent_assigned_id: 10 })]
    await nextTick()

    // Add terminal linked to task 1 so Chemin 1 scheduleClose fires
    const tabsStore = useTabsStore()
    tabsStore.addTerminal('dev-front-vuejs', 'Ubuntu-24.04')
    const termTab = tabsStore.tabs.find(t => t.type === 'terminal')!
    termTab.taskId = 1
    termTab.streamId = 'stream-pending-close'

    // Task done -> scheduleClose fires (pendingCloses non-empty after debounce)
    refs.tasks.value = [makeTask({ id: 1, status: 'done', agent_assigned_id: 10 })]
    await nextTick()
    await vi.advanceTimersByTimeAsync(90) // past 80ms debounce -> scheduleClose called

    // Project changes: dbPath watcher fires -> L175 clearInterval + L177 pendingCloses.clear()
    refs.dbPath.value = '/new/project/db'
    await nextTick()

    // Advance well past poll interval + fallback — no close should happen
    await vi.advanceTimersByTimeAsync(70 * 1000)

    // Tab should NOT have been closed (close was cancelled by dbPath change)
    expect(api.agentKill).not.toHaveBeenCalled()
    expect(tabsStore.tabs.filter(t => t.type === 'terminal')).toHaveLength(1)
  })

  it('should clear fallback timer when dbPath changes mid-fallback (L177 with fallbackId set)', async () => {
    // Same as above but verifies the fallbackId branch is also exercised (L176)
    useAutoLaunch(refs)

    refs.tasks.value = [makeTask({ id: 1, status: 'in_progress', agent_assigned_id: 10 })]
    await nextTick()

    const tabsStore = useTabsStore()
    tabsStore.addTerminal('dev-front-vuejs', 'Ubuntu-24.04')
    const termTab = tabsStore.tabs.find(t => t.type === 'terminal')!
    termTab.taskId = 1
    termTab.streamId = 'stream-fallback-clear'

    refs.tasks.value = [makeTask({ id: 1, status: 'done', agent_assigned_id: 10 })]
    await nextTick()
    await vi.advanceTimersByTimeAsync(90) // debounce + scheduleClose (fallbackId set = 15s)

    // Project changes at 90ms — both interval AND fallback timer must be cleared
    refs.dbPath.value = '/another/db'
    await nextTick()

    // Advance past the 15s fallback — if fallback was not cleared, agentKill would fire
    await vi.advanceTimersByTimeAsync(20 * 1000)

    expect(api.agentKill).not.toHaveBeenCalled()
  })
})
