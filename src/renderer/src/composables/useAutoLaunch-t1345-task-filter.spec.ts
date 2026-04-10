/**
 * T1345: Kill surviving ConditionalExpression mutations in useAutoLaunch
 *
 * Split: task filter mutations (line 125)
 *   - task.status !== 'done' -> not selected
 *   - agent_assigned_id null -> not selected
 *   - task.status === 'done' AND agent_assigned_id present -> selected
 *   - prevStatus undefined (new task) -> not selected
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { ref, nextTick } from 'vue'
import { useAutoLaunch } from './useAutoLaunch'
import { useTabsStore } from '@renderer/stores/tabs'
import { useTasksStore } from '@renderer/stores/tasks'
import type { Task, Agent } from '@renderer/types'
import { api, makeTask, makeAgent, incrementTestIndex } from './__helpers__/useAutoLaunch-t1345.helpers'

describe('useAutoLaunch T1345: task filter mutations (line 125)', () => {
  let tasks: ReturnType<typeof ref<Task[]>>
  let agents: ReturnType<typeof ref<Agent[]>>
  let dbPath: ReturnType<typeof ref<string | null>>

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
    vi.useFakeTimers()
    const idx = incrementTestIndex()
    vi.setSystemTime(new Date(2026, 8, 2, 0, idx * 10, 0))

    api.queryDb.mockResolvedValue([{ id: 1 }])

    tasks = ref<Task[]>([])
    agents = ref<Agent[]>([])
    dbPath = ref<string | null>('/test/db')

    const tasksStore = useTasksStore()
    ;(tasksStore as unknown as { dbPath: string | null }).dbPath = '/test/db'
  })

  afterEach(() => { vi.useRealTimers() })

  it('task.status !== done: task is NOT selected for Chemin 1 close', async () => {
    // Kill mutation: flip task.status === 'done' -> always-true
    // An in_progress task must NOT trigger scheduleClose
    const agent = makeAgent({ id: 10, name: 'dev-front-vuejs' })
    agents.value = [agent]

    useAutoLaunch({ tasks, agents, dbPath })

    // Seed with in_progress
    tasks.value = [makeTask({ id: 1, status: 'in_progress', agent_assigned_id: 10 })]
    await nextTick()

    const tabsStore = useTabsStore()
    tabsStore.addTerminal('dev-front-vuejs', 'Ubuntu-24.04')
    const termTab = tabsStore.tabs.find(t => t.type === 'terminal')!
    termTab.taskId = 1
    termTab.streamId = 'stream-not-done'

    // Task stays in_progress (no done transition)
    tasks.value = [makeTask({ id: 1, status: 'in_progress', agent_assigned_id: 10 })]
    await nextTick()
    await vi.advanceTimersByTimeAsync(200)

    // Chemin 1 must NOT have triggered (status !== 'done')
    expect(api.agentKill).not.toHaveBeenCalledWith('stream-not-done')
  })

  it('agent_assigned_id === null: task NOT selected for Chemin 1 close', async () => {
    // Kill mutation: flip task.agent_assigned_id check -> always-true
    // A task without agent_assigned_id must NOT trigger scheduleClose
    const agent = makeAgent({ id: 10, name: 'dev-front-vuejs' })
    agents.value = [agent]

    useAutoLaunch({ tasks, agents, dbPath })

    // Seed
    tasks.value = [makeTask({ id: 1, status: 'in_progress', agent_assigned_id: null as unknown as number })]
    await nextTick()

    const tabsStore = useTabsStore()
    tabsStore.addTerminal('dev-front-vuejs', 'Ubuntu-24.04')
    const termTab = tabsStore.tabs.find(t => t.type === 'terminal')!
    termTab.taskId = 1
    termTab.streamId = 'stream-no-agent'

    // Task transitions to done but without agent_assigned_id
    tasks.value = [makeTask({ id: 1, status: 'done', agent_assigned_id: null as unknown as number })]
    await nextTick()
    await vi.advanceTimersByTimeAsync(200)

    // No Chemin 1 close -- agent_assigned_id is null
    expect(api.agentKill).not.toHaveBeenCalledWith('stream-no-agent')
  })

  it('agent_assigned_id === 0 (falsy): task NOT selected for Chemin 1 close', async () => {
    // 0 is falsy -- same guard behavior as null
    const agent = makeAgent({ id: 10, name: 'dev-front-vuejs' })
    agents.value = [agent]

    useAutoLaunch({ tasks, agents, dbPath })

    tasks.value = [makeTask({ id: 1, status: 'in_progress', agent_assigned_id: 0 })]
    await nextTick()

    const tabsStore = useTabsStore()
    tabsStore.addTerminal('dev-front-vuejs', 'Ubuntu-24.04')
    const termTab = tabsStore.tabs.find(t => t.type === 'terminal')!
    termTab.taskId = 1
    termTab.streamId = 'stream-zero-agent'

    tasks.value = [makeTask({ id: 1, status: 'done', agent_assigned_id: 0 })]
    await nextTick()
    await vi.advanceTimersByTimeAsync(200)

    expect(api.agentKill).not.toHaveBeenCalledWith('stream-zero-agent')
  })

  it('task.status === done AND agent_assigned_id present: task IS selected for Chemin 1 close', async () => {
    // Both conditions true -> scheduleClose fires
    const agent = makeAgent({ id: 10, name: 'dev-front-vuejs' })
    agents.value = [agent]

    useAutoLaunch({ tasks, agents, dbPath })

    tasks.value = [makeTask({ id: 1, status: 'in_progress', agent_assigned_id: 10 })]
    await nextTick()

    const tabsStore = useTabsStore()
    tabsStore.addTerminal('dev-front-vuejs', 'Ubuntu-24.04')
    const termTab = tabsStore.tabs.find(t => t.type === 'terminal')!
    termTab.taskId = 1
    termTab.streamId = 'stream-both-true'

    // Transition to done WITH agent_assigned_id -> must trigger Chemin 1
    tasks.value = [makeTask({ id: 1, status: 'done', agent_assigned_id: 10 })]
    await nextTick()
    await vi.advanceTimersByTimeAsync(200)

    expect(api.agentKill).toHaveBeenCalledWith('stream-both-true')
  })

  it('prevStatus undefined (new task): task NOT selected (prevStatus guard)', async () => {
    // Kill mutation: flip `prevStatus &&` to always-true
    // A brand-new task (no prevStatus) must NOT trigger scheduleClose even if done
    const agent = makeAgent({ id: 10, name: 'dev-front-vuejs' })
    agents.value = [agent]

    useAutoLaunch({ tasks, agents, dbPath })

    // Seed phase: empty tasks
    tasks.value = []
    await nextTick()

    const tabsStore = useTabsStore()
    tabsStore.addTerminal('dev-front-vuejs', 'Ubuntu-24.04')
    const termTab = tabsStore.tabs.find(t => t.type === 'terminal')!
    termTab.taskId = 99
    termTab.streamId = 'stream-new-task'

    // Task appears for the first time already done (no prev status)
    tasks.value = [makeTask({ id: 99, status: 'done', agent_assigned_id: 10 })]
    await nextTick()
    await vi.advanceTimersByTimeAsync(200)

    // prevStatus is undefined -> condition fails -> no Chemin 1 close
    // (no-task Chemin 2 also won't fire since tab has a taskId)
    expect(api.agentKill).not.toHaveBeenCalledWith('stream-new-task')
  })
})
