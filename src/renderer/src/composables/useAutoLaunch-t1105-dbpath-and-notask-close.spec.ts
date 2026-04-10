/**
 * T1105: dbPath guard + no-task close (no fallback) tests
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { ref, nextTick } from 'vue'
import { useAutoLaunch } from './useAutoLaunch'
import { useTabsStore } from '@renderer/stores/tabs'
import { useTasksStore } from '@renderer/stores/tasks'
import type { Task, Agent } from '@renderer/types'
import { api, makeTask, makeAgent } from './__helpers__/useAutoLaunch-t1105.helpers'

describe('useAutoLaunch T1105: dbPath guard', () => {
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
    vi.setSystemTime(new Date(2026, 2, 1, 0, testIndex * 10, 0))
    api.queryDb.mockResolvedValue([{ id: 1 }])
    tasks = ref<Task[]>([])
    agents = ref<Agent[]>([makeAgent()])
    dbPath = ref<string | null>('/test/db')
    const tasksStore = useTasksStore()
    ;(tasksStore as unknown as { dbPath: string | null }).dbPath = '/test/db'
  })

  afterEach(() => { vi.useRealTimers() })

  it('should not process tasks when dbPath is null at watch trigger', async () => {
    const localDbPath = ref<string | null>(null)
    useAutoLaunch({ tasks, agents, dbPath: localDbPath })

    tasks.value = [makeTask({ id: 1, status: 'in_progress', agent_assigned_id: 10 })]
    await nextTick()

    const tabsStore = useTabsStore()
    tabsStore.addTerminal('dev-front-vuejs', 'Ubuntu-24.04')
    const termTab = tabsStore.tabs.find(t => t.type === 'terminal')!
    termTab.streamId = 'stream-null-dbpath'

    tasks.value = [makeTask({ id: 1, status: 'done', agent_assigned_id: 10 })]
    await nextTick()
    await vi.advanceTimersByTimeAsync(200)

    expect(api.agentKill).not.toHaveBeenCalled()
  })

  it('should not close when dbPath becomes null before debounce fires', async () => {
    useAutoLaunch({ tasks, agents, dbPath })

    tasks.value = [makeTask({ id: 1, status: 'in_progress', agent_assigned_id: 10 })]
    await nextTick()

    const tabsStore = useTabsStore()
    tabsStore.addTerminal('dev-front-vuejs', 'Ubuntu-24.04')
    const termTab = tabsStore.tabs.find(t => t.type === 'terminal')!
    termTab.streamId = 'stream-mid-null'

    tasks.value = [makeTask({ id: 1, status: 'done', agent_assigned_id: 10 })]
    await nextTick()

    // dbPath becomes null -> reset fired (pendingCloses cleared)
    dbPath.value = null
    await nextTick()

    await vi.advanceTimersByTimeAsync(200)

    expect(api.agentKill).not.toHaveBeenCalled()
  })
})

describe('useAutoLaunch T1105: no-task close — no fallback (T1246)', () => {
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
    vi.setSystemTime(new Date(2026, 2, 2, 0, testIndex * 10, 0))
    api.queryDb.mockResolvedValue([])
    tasks = ref<Task[]>([])
    agents = ref<Agent[]>([])
    dbPath = ref<string | null>('/test/db')
    const tasksStore = useTasksStore()
    ;(tasksStore as unknown as { dbPath: string | null }).dbPath = '/test/db'
  })

  afterEach(() => { vi.useRealTimers() })

  it('should NOT force-close no-task agent after 1min (no fallback for no-task tabs — T1246)', async () => {
    const noTaskAgent = makeAgent({ id: 20, name: 'review-master', type: 'review' })
    agents.value = [noTaskAgent]
    useAutoLaunch({ tasks, agents, dbPath })

    tasks.value = []
    await nextTick()

    const tabsStore = useTabsStore()
    tabsStore.addTerminal('review-master', 'Ubuntu-24.04')
    const termTab = tabsStore.tabs.find(t => t.type === 'terminal')!
    termTab.streamId = 'stream-notask-1min'

    tasks.value = [makeTask({ id: 1, status: 'done', agent_assigned_id: 999 })]
    await nextTick()

    // 1 minute: no fallback for no-task tabs -> no kill
    await vi.advanceTimersByTimeAsync(60 * 1000 + 200)

    expect(api.agentKill).not.toHaveBeenCalled()
  })

  it('should NOT force-close no-task agent before 120s fallback (T1820)', async () => {
    // T1820: 120s safety fallback for no-task agents — tab stays open before that.
    // queryDb always returns [] -> session never found -> tab stays open until fallback.
    const noTaskAgent = makeAgent({ id: 20, name: 'review-master', type: 'review' })
    agents.value = [noTaskAgent]
    useAutoLaunch({ tasks, agents, dbPath })

    tasks.value = []
    await nextTick()

    const tabsStore = useTabsStore()
    tabsStore.addTerminal('review-master', 'Ubuntu-24.04')
    const termTab = tabsStore.tabs.find(t => t.type === 'terminal')!
    termTab.streamId = 'stream-notask-no-fallback'

    tasks.value = [makeTask({ id: 1, status: 'done', agent_assigned_id: 999 })]
    await nextTick()

    // 60s — before 120s fallback — tab must still be open
    await vi.advanceTimersByTimeAsync(80 + 60 * 1000)

    expect(api.agentKill).not.toHaveBeenCalled()
    expect(tabsStore.tabs.filter(t => t.type === 'terminal')).toHaveLength(1)
  })

  it('should NEVER auto-close task-creator (exempt from no-task close)', async () => {
    const taskCreator = makeAgent({ id: 20, name: 'task-creator' })
    agents.value = [taskCreator]
    useAutoLaunch({ tasks, agents, dbPath })

    tasks.value = []
    await nextTick()

    const tabsStore = useTabsStore()
    tabsStore.addTerminal('task-creator', 'Ubuntu-24.04')
    const termTab = tabsStore.tabs.find(t => t.type === 'terminal')!
    termTab.streamId = 'stream-task-creator-exempt'

    tasks.value = [makeTask({ id: 1, status: 'done', agent_assigned_id: 999 })]
    await nextTick()

    // Well past 5-minute fallback — task-creator must remain open
    await vi.advanceTimersByTimeAsync(80 + 10 * 60 * 1000)

    expect(api.agentKill).not.toHaveBeenCalled()
  })
})
