/**
 * T1345: Kill surviving ConditionalExpression mutations in useAutoLaunch
 *
 * Split: REVIEW_COOLDOWN_MS boundary (line 103) + dbPath guard (line 103)
 *   - cooldown NOT expired (4min59s): handler does NOT launch review
 *   - cooldown exactly expired (300s + 1ms): handler DOES launch review
 *   - dbPath === null: watch handler returns early
 *   - dbPath becomes non-null: watch handler proceeds
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { ref, nextTick } from 'vue'
import { useAutoLaunch } from './useAutoLaunch'
import { useTabsStore } from '@renderer/stores/tabs'
import { useTasksStore } from '@renderer/stores/tasks'
import { useSettingsStore } from '@renderer/stores/settings'
import type { Task, Agent } from '@renderer/types'
import { api, makeTask, makeAgent, incrementTestIndex } from './__helpers__/useAutoLaunch-t1345.helpers'

describe('useAutoLaunch T1345: REVIEW_COOLDOWN_MS boundary (line 103)', () => {
  let tasks: ReturnType<typeof ref<Task[]>>
  let agents: ReturnType<typeof ref<Agent[]>>
  let dbPath: ReturnType<typeof ref<string | null>>

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
    vi.useFakeTimers()
    const idx = incrementTestIndex()
    vi.setSystemTime(new Date(2026, 8, 3, 0, idx * 10, 0))

    api.queryDb.mockResolvedValue([{ id: 1 }])

    tasks = ref<Task[]>([])
    agents = ref<Agent[]>([])
    dbPath = ref<string | null>('/test/db')

    const tasksStore = useTasksStore()
    ;(tasksStore as unknown as { dbPath: string | null }).dbPath = '/test/db'
  })

  afterEach(() => { vi.useRealTimers() })

  function makeDoneTasks(count: number): Task[] {
    return Array.from({ length: count }, (_, i) =>
      makeTask({ id: i + 1, status: 'done', agent_assigned_id: 10 })
    )
  }

  it('cooldown NOT expired (4min59s): handler does NOT launch review', async () => {
    // Kill ConditionalExpression: if(false) on `Date.now() - lastReviewLaunchedAt < REVIEW_COOLDOWN_MS`
    const reviewAgent = makeAgent({ id: 99, name: 'review-master', type: 'review' })
    const devAgent = makeAgent({ id: 10, name: 'dev-front-vuejs' })
    agents.value = [devAgent, reviewAgent]

    const settingsStore = useSettingsStore()
    settingsStore.setAutoReviewThreshold(3)

    useAutoLaunch({ tasks, agents, dbPath })

    // First launch: seed
    tasks.value = []
    await nextTick()

    tasks.value = makeDoneTasks(5)
    await nextTick()

    const tabsStore = useTabsStore()
    await vi.waitFor(() => {
      expect(tabsStore.tabs.some(t => t.agentName === 'review-master')).toBe(true)
    })

    // Close the review tab
    const reviewTab = tabsStore.tabs.find(t => t.agentName === 'review-master')!
    tabsStore.closeTab(reviewTab.id)

    // Advance 4min59s (299s) -- still within REVIEW_COOLDOWN_MS (300s)
    vi.advanceTimersByTime(299 * 1000)

    // Another batch triggers checkReviewThreshold
    tasks.value = [...makeDoneTasks(5)]
    await nextTick()
    await nextTick()

    // Cooldown not expired -> review NOT launched
    expect(tabsStore.tabs.some(t => t.agentName === 'review-master')).toBe(false)
  })

  it('cooldown exactly expired (300s + 1ms): handler DOES launch review', async () => {
    // Kill ConditionalExpression: if(true) on `Date.now() - lastReviewLaunchedAt < REVIEW_COOLDOWN_MS`
    const reviewAgent = makeAgent({ id: 99, name: 'review-master', type: 'review' })
    const devAgent = makeAgent({ id: 10, name: 'dev-front-vuejs' })
    agents.value = [devAgent, reviewAgent]

    const settingsStore = useSettingsStore()
    settingsStore.setAutoReviewThreshold(3)

    useAutoLaunch({ tasks, agents, dbPath })

    // First launch
    tasks.value = []
    await nextTick()

    tasks.value = makeDoneTasks(5)
    await nextTick()

    const tabsStore = useTabsStore()
    await vi.waitFor(() => {
      expect(tabsStore.tabs.some(t => t.agentName === 'review-master')).toBe(true)
    })

    // Close the review tab
    const reviewTab = tabsStore.tabs.find(t => t.agentName === 'review-master')!
    tabsStore.closeTab(reviewTab.id)

    // Advance 300s + 1ms = REVIEW_COOLDOWN_MS + 1ms (expired)
    vi.advanceTimersByTime(300 * 1000 + 1)

    tasks.value = [...makeDoneTasks(5)]
    await nextTick()

    await vi.waitFor(() => {
      expect(tabsStore.tabs.some(t => t.agentName === 'review-master')).toBe(true)
    })
  })
})

describe('useAutoLaunch T1345: dbPath guard (line 103)', () => {
  let tasks: ReturnType<typeof ref<Task[]>>
  let agents: ReturnType<typeof ref<Agent[]>>
  let dbPath: ReturnType<typeof ref<string | null>>

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 8, 4, 12, 0, 0))

    api.queryDb.mockResolvedValue([])

    tasks = ref<Task[]>([])
    agents = ref<Agent[]>([makeAgent()])
    dbPath = ref<string | null>(null) // null initially

    const tasksStore = useTasksStore()
    ;(tasksStore as unknown as { dbPath: string | null }).dbPath = null
  })

  afterEach(() => { vi.useRealTimers() })

  it('dbPath === null: watch handler returns early, no scheduleClose or debounce', async () => {
    // Kill ConditionalExpression: if(false) on `if (!dbPath.value) return` line 103
    useAutoLaunch({ tasks, agents, dbPath })

    // Seed phase with null dbPath (initialized = false first)
    tasks.value = []
    await nextTick()

    // Add terminal
    const tabsStore = useTabsStore()
    tabsStore.addTerminal('dev-front-vuejs', 'Ubuntu-24.04')
    const termTab = tabsStore.tabs.find(t => t.type === 'terminal')!
    termTab.taskId = 1
    termTab.streamId = 'stream-null-db'

    // Try to trigger a done transition with dbPath = null
    tasks.value = [makeTask({ id: 1, status: 'done', agent_assigned_id: 10 })]
    await nextTick()
    await vi.advanceTimersByTimeAsync(200)

    // No agentKill: the early return on null dbPath prevents scheduleClose
    expect(api.agentKill).not.toHaveBeenCalled()
    expect(tabsStore.tabs.filter(t => t.type === 'terminal')).toHaveLength(1)
  })

  it('dbPath becomes non-null: watch handler proceeds and schedules close', async () => {
    // Contrast test: when dbPath is set, the handler does NOT return early
    dbPath.value = '/test/db'
    const tasksStore = useTasksStore()
    ;(tasksStore as unknown as { dbPath: string | null }).dbPath = '/test/db'

    api.queryDb.mockResolvedValue([{ id: 1 }])

    useAutoLaunch({ tasks, agents, dbPath })

    tasks.value = [makeTask({ id: 1, status: 'in_progress', agent_assigned_id: 10 })]
    await nextTick()

    const tabsStore = useTabsStore()
    tabsStore.addTerminal('dev-front-vuejs', 'Ubuntu-24.04')
    const termTab = tabsStore.tabs.find(t => t.type === 'terminal')!
    termTab.taskId = 1
    termTab.streamId = 'stream-valid-db'

    tasks.value = [makeTask({ id: 1, status: 'done', agent_assigned_id: 10 })]
    await nextTick()
    await vi.advanceTimersByTimeAsync(200)

    // dbPath is set -> no early return -> scheduleClose fires
    expect(api.agentKill).toHaveBeenCalledWith('stream-valid-db')
  })
})
