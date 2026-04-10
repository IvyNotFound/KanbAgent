/**
 * T1338: Mutation coverage for useAutoLaunch.ts — watcher initialization,
 * status tracking, and no-task path (Chemin 2) guards
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { ref, nextTick } from 'vue'
import { useAutoLaunch } from './useAutoLaunch'
import { useTabsStore } from '@renderer/stores/tabs'
import { useTasksStore } from '@renderer/stores/tasks'
import type { Task, Agent } from '@renderer/types'
import { api, makeTask, makeAgent, incrementTestIndex } from './__helpers__/useAutoLaunch-t1338.helpers'

describe('useAutoLaunch T1338: watcher initialization and status tracking', () => {
  let tasks: ReturnType<typeof ref<Task[]>>
  let agents: ReturnType<typeof ref<Agent[]>>
  let dbPath: ReturnType<typeof ref<string | null>>

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
    vi.useFakeTimers()
    const idx = incrementTestIndex()
    vi.setSystemTime(new Date(2026, 7, 5, idx, 0, 0))
    api.queryDb.mockResolvedValue([{ id: 1 }])
    tasks = ref<Task[]>([])
    agents = ref<Agent[]>([makeAgent()])
    dbPath = ref<string | null>('/test/db')
    const tasksStore = useTasksStore()
    ;(tasksStore as unknown as { dbPath: string | null }).dbPath = '/test/db'
  })

  afterEach(() => { vi.useRealTimers() })

  it('previousStatuses updated after debounce: second transition detected correctly', async () => {
    useAutoLaunch({ tasks, agents, dbPath })

    tasks.value = [makeTask({ id: 1, status: 'in_progress', agent_assigned_id: 10 })]
    await nextTick()

    const tabsStore = useTabsStore()

    tabsStore.addTerminal('dev-front-vuejs', 'Ubuntu-24.04')
    const tab1 = tabsStore.tabs.find(t => t.type === 'terminal')!
    tab1.taskId = 1
    tab1.streamId = 'stream-t1'

    tasks.value = [makeTask({ id: 1, status: 'done', agent_assigned_id: 10 })]
    await nextTick()
    await vi.advanceTimersByTimeAsync(100 + 2100)

    expect(api.agentKill).toHaveBeenCalledWith('stream-t1')
    expect(tabsStore.tabs.filter(t => t.type === 'terminal')).toHaveLength(0)

    tabsStore.addTerminal('dev-front-vuejs', 'Ubuntu-24.04')
    const tab2 = tabsStore.tabs.find(t => t.type === 'terminal')!
    tab2.taskId = 2
    tab2.streamId = 'stream-t2'

    tasks.value = [
      makeTask({ id: 1, status: 'done', agent_assigned_id: 10 }),
      makeTask({ id: 2, status: 'in_progress', agent_assigned_id: 10 }),
    ]
    await nextTick()
    await vi.advanceTimersByTimeAsync(100)

    tasks.value = [
      makeTask({ id: 1, status: 'done', agent_assigned_id: 10 }),
      makeTask({ id: 2, status: 'done', agent_assigned_id: 10 }),
    ]
    await nextTick()
    await vi.advanceTimersByTimeAsync(100 + 2100)

    expect(api.agentKill).toHaveBeenCalledWith('stream-t2')
  })

  it('multiple tasks in one batch: each task done transition schedules close independently', async () => {
    useAutoLaunch({ tasks, agents, dbPath })

    tasks.value = [
      makeTask({ id: 10, status: 'in_progress', agent_assigned_id: 10 }),
      makeTask({ id: 11, status: 'in_progress', agent_assigned_id: 10 }),
    ]
    await nextTick()

    const tabsStore = useTabsStore()
    tabsStore.addTerminal('dev-front-vuejs', 'Ubuntu-24.04')
    const tab10 = tabsStore.tabs.find(t => t.type === 'terminal')!
    tab10.taskId = 10
    tab10.streamId = 'stream-t10'

    tabsStore.addTerminal('dev-front-vuejs', 'Ubuntu-24.04')
    const tab11 = tabsStore.tabs.filter(t => t.type === 'terminal')[1]!
    tab11.taskId = 11
    tab11.streamId = 'stream-t11'

    tasks.value = [
      makeTask({ id: 10, status: 'done', agent_assigned_id: 10 }),
      makeTask({ id: 11, status: 'done', agent_assigned_id: 10 }),
    ]
    await nextTick()
    await vi.advanceTimersByTimeAsync(100 + 2100)

    expect(api.agentKill).toHaveBeenCalledWith('stream-t10')
    expect(api.agentKill).toHaveBeenCalledWith('stream-t11')
    expect(tabsStore.tabs.filter(t => t.type === 'terminal')).toHaveLength(0)
  })
})

describe('useAutoLaunch T1338: no-task path (Chemin 2) guards', () => {
  let tasks: ReturnType<typeof ref<Task[]>>
  let agents: ReturnType<typeof ref<Agent[]>>
  let dbPath: ReturnType<typeof ref<string | null>>

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
    vi.useFakeTimers()
    const idx = incrementTestIndex()
    vi.setSystemTime(new Date(2026, 7, 6, idx, 0, 0))
    api.queryDb.mockResolvedValue([])
    tasks = ref<Task[]>([])
    agents = ref<Agent[]>([])
    dbPath = ref<string | null>('/test/db')
    const tasksStore = useTasksStore()
    ;(tasksStore as unknown as { dbPath: string | null }).dbPath = '/test/db'
  })

  afterEach(() => { vi.useRealTimers() })

  it('tab with agentName = null: Chemin 2 skips this tab (!tab.agentName guard)', async () => {
    const agent = makeAgent({ id: 20, name: 'review-master', type: 'review' })
    agents.value = [agent]
    useAutoLaunch({ tasks, agents, dbPath })
    tasks.value = []
    await nextTick()

    const tabsStore = useTabsStore()
    tabsStore.addTerminal('review-master', 'Ubuntu-24.04')
    const termTab = tabsStore.tabs.find(t => t.type === 'terminal')!
    termTab.agentName = null as unknown as string
    termTab.streamId = 'stream-no-agentname'

    tasks.value = [makeTask({ id: 1, status: 'done', agent_assigned_id: 999 })]
    await nextTick()
    await vi.advanceTimersByTimeAsync(200)

    expect(api.agentKill).not.toHaveBeenCalled()
  })

  it('tab with taskId: Chemin 2 skips task-linked tabs (tab.taskId guard)', async () => {
    const agent = makeAgent({ id: 20, name: 'dev-front-vuejs' })
    agents.value = [agent]
    useAutoLaunch({ tasks, agents, dbPath })
    tasks.value = []
    await nextTick()

    const tabsStore = useTabsStore()
    tabsStore.addTerminal('dev-front-vuejs', 'Ubuntu-24.04')
    const termTab = tabsStore.tabs.find(t => t.type === 'terminal')!
    termTab.taskId = 42
    termTab.streamId = 'stream-task-linked'

    tasks.value = [makeTask({ id: 999, status: 'done', agent_assigned_id: 999 })]
    await nextTick()
    await vi.advanceTimersByTimeAsync(200)

    expect(api.queryDb).not.toHaveBeenCalled()
  })

  it('agent not found in agents list: Chemin 2 skips the tab', async () => {
    agents.value = []
    useAutoLaunch({ tasks, agents, dbPath })
    tasks.value = []
    await nextTick()

    const tabsStore = useTabsStore()
    tabsStore.addTerminal('unknown-agent', 'Ubuntu-24.04')
    const termTab = tabsStore.tabs.find(t => t.type === 'terminal')!
    termTab.streamId = 'stream-unknown-agent'

    tasks.value = [makeTask({ id: 1, status: 'done', agent_assigned_id: 999 })]
    await nextTick()
    await vi.advanceTimersByTimeAsync(200)

    expect(api.agentKill).not.toHaveBeenCalled()
  })

  it('agent.auto_launch = 0 in Chemin 2: tab not closed', async () => {
    const agent = makeAgent({ id: 20, name: 'review-master', auto_launch: 0 })
    agents.value = [agent]
    useAutoLaunch({ tasks, agents, dbPath })
    tasks.value = []
    await nextTick()

    const tabsStore = useTabsStore()
    tabsStore.addTerminal('review-master', 'Ubuntu-24.04')
    const termTab = tabsStore.tabs.find(t => t.type === 'terminal')!
    termTab.streamId = 'stream-no-auto-launch-notask'

    tasks.value = [makeTask({ id: 1, status: 'done', agent_assigned_id: 999 })]
    await nextTick()
    await vi.advanceTimersByTimeAsync(200)

    expect(api.agentKill).not.toHaveBeenCalled()
  })
})
