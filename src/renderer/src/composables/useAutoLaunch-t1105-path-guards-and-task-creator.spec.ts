/**
 * T1105: no-task path guards + task-creator guard in Chemin 1
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { ref, nextTick } from 'vue'
import { useAutoLaunch } from './useAutoLaunch'
import { useTabsStore } from '@renderer/stores/tabs'
import { useTasksStore } from '@renderer/stores/tasks'
import type { Task, Agent } from '@renderer/types'
import { api, makeTask, makeAgent } from './__helpers__/useAutoLaunch-t1105.helpers'

describe('useAutoLaunch T1105: no-task path guards', () => {
  let tasks: ReturnType<typeof ref<Task[]>>
  let agents: ReturnType<typeof ref<Agent[]>>
  let dbPath: ReturnType<typeof ref<string | null>>
  let testIndex = 0

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
    vi.useFakeTimers()
    testIndex++
    vi.setSystemTime(new Date(2026, 2, 3, 0, testIndex * 10, 0))
    api.queryDb.mockResolvedValue([])
    tasks = ref<Task[]>([])
    agents = ref<Agent[]>([makeAgent()])
    dbPath = ref<string | null>('/test/db')
    const tasksStore = useTasksStore()
    ;(tasksStore as unknown as { dbPath: string | null }).dbPath = '/test/db'
  })

  afterEach(() => { vi.useRealTimers() })

  it('should skip no-task close when agent has no terminal open', async () => {
    useAutoLaunch({ tasks, agents, dbPath })

    tasks.value = []
    await nextTick()

    // No terminal for the agent
    tasks.value = [makeTask({ id: 1, status: 'done', agent_assigned_id: 999 })]
    await nextTick()
    await vi.advanceTimersByTimeAsync(200)

    expect(api.queryDb).not.toHaveBeenCalled()
  })

  it('should skip no-task close when pendingClose already scheduled for agent', async () => {
    useAutoLaunch({ tasks, agents, dbPath })

    tasks.value = [makeTask({ id: 1, status: 'in_progress', agent_assigned_id: 10 })]
    await nextTick()

    const tabsStore = useTabsStore()
    tabsStore.addTerminal('dev-front-vuejs', 'Ubuntu-24.04')
    const termTab = tabsStore.tabs.find(t => t.type === 'terminal')!
    termTab.streamId = 'stream-already-pending'

    // First: task-done transition schedules close (pendingCloses set)
    tasks.value = [makeTask({ id: 1, status: 'done', agent_assigned_id: 10 })]
    await nextTick()
    await vi.advanceTimersByTimeAsync(100)

    const firstCallCount = api.queryDb.mock.calls.length

    // Second watch: no-task path sees pendingCloses.has('dev-front-vuejs')=true -> skip
    tasks.value = [...tasks.value]
    await nextTick()
    await vi.advanceTimersByTimeAsync(100)

    // No additional queryDb call from no-task path (it was skipped)
    expect(api.queryDb.mock.calls.length).toBe(firstCallCount)
  })
})

describe('useAutoLaunch T1254: task-creator guard in Chemin 1', () => {
  let tasks: ReturnType<typeof ref<Task[]>>
  let agents: ReturnType<typeof ref<Agent[]>>
  let dbPath: ReturnType<typeof ref<string | null>>
  let testIndex = 0

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
    vi.useFakeTimers()
    testIndex++
    vi.setSystemTime(new Date(2026, 2, 5, 0, testIndex * 10, 0))
    api.queryDb.mockResolvedValue([])
    tasks = ref<Task[]>([])
    agents = ref<Agent[]>([])
    dbPath = ref<string | null>('/test/db')
    const tasksStore = useTasksStore()
    ;(tasksStore as unknown as { dbPath: string | null }).dbPath = '/test/db'
  })

  afterEach(() => { vi.useRealTimers() })

  it('should NOT close task-creator tab when its task transitions to done (Chemin 1)', async () => {
    const taskCreator = makeAgent({ id: 30, name: 'task-creator', type: 'planner', auto_launch: 1 })
    agents.value = [taskCreator]
    useAutoLaunch({ tasks, agents, dbPath })

    tasks.value = [makeTask({ id: 5, status: 'in_progress', agent_assigned_id: 30 })]
    await nextTick()

    const tabsStore = useTabsStore()
    // Open a terminal tab linked to task id=5 (taskId set)
    tabsStore.addTerminal('task-creator', 'Ubuntu-24.04', undefined, undefined, undefined, undefined, undefined, true, 5)
    const termTab = tabsStore.tabs.find(t => t.type === 'terminal' && t.agentName === 'task-creator')!
    termTab.streamId = 'stream-task-creator-chemin1'

    // Task transitions to done
    tasks.value = [makeTask({ id: 5, status: 'done', agent_assigned_id: 30 })]
    await nextTick()

    // Well past 1-minute fallback — tab must remain open
    await vi.advanceTimersByTimeAsync(80 + 70 * 1000)

    expect(api.agentKill).not.toHaveBeenCalled()
  })
})
