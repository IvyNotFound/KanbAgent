/**
 * T1338: Mutation coverage for useAutoLaunch.ts — review threshold exact boundary
 * (doneCount < threshold) and review cooldown boundary (REVIEW_COOLDOWN_MS)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { ref, nextTick } from 'vue'
import { useAutoLaunch } from './useAutoLaunch'
import { useTabsStore } from '@renderer/stores/tabs'
import { useSettingsStore } from '@renderer/stores/settings'
import { useTasksStore } from '@renderer/stores/tasks'
import type { Task, Agent } from '@renderer/types'
import { api, makeTask, makeAgent, incrementTestIndex } from './__helpers__/useAutoLaunch-t1338.helpers'

describe('useAutoLaunch T1338: review threshold exact boundary (doneCount < threshold)', () => {
  let tasks: ReturnType<typeof ref<Task[]>>
  let agents: ReturnType<typeof ref<Agent[]>>
  let dbPath: ReturnType<typeof ref<string | null>>

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
    vi.useFakeTimers()
    const idx = incrementTestIndex()
    vi.setSystemTime(new Date(2026, 7, 3, idx, 0, 0))
    api.queryDb.mockResolvedValue([])
    tasks = ref<Task[]>([])
    agents = ref<Agent[]>([])
    dbPath = ref<string | null>('/test/db')
    const tasksStore = useTasksStore()
    ;(tasksStore as unknown as { dbPath: string | null }).dbPath = '/test/db'
  })

  afterEach(() => { vi.useRealTimers() })

  it('doneCount = threshold - 1: should NOT launch review (below threshold)', async () => {
    const reviewAgent = makeAgent({ id: 99, name: 'review-master', type: 'review' })
    agents.value = [makeAgent(), reviewAgent]

    const settingsStore = useSettingsStore()
    settingsStore.setAutoReviewThreshold(5)

    useAutoLaunch({ tasks, agents, dbPath })
    tasks.value = []
    await nextTick()

    const doneTasks = Array.from({ length: 4 }, (_, i) =>
      makeTask({ id: i + 1, status: 'done', agent_assigned_id: 10 })
    )
    tasks.value = doneTasks
    await nextTick()
    await vi.advanceTimersByTimeAsync(200)

    const tabsStore = useTabsStore()
    expect(tabsStore.tabs.some(t => t.agentName === 'review-master')).toBe(false)
  })

  it('doneCount = threshold: should launch review (exactly at threshold)', async () => {
    const reviewAgent = makeAgent({ id: 99, name: 'review-master', type: 'review' })
    agents.value = [makeAgent(), reviewAgent]

    const settingsStore = useSettingsStore()
    settingsStore.setAutoReviewThreshold(5)

    api.queryDb.mockResolvedValue([{ id: 1 }])
    useAutoLaunch({ tasks, agents, dbPath })
    tasks.value = []
    await nextTick()

    const doneTasks = Array.from({ length: 5 }, (_, i) =>
      makeTask({ id: i + 1, status: 'done', agent_assigned_id: 10 })
    )
    tasks.value = doneTasks
    await nextTick()

    await vi.waitFor(() => {
      const tabsStore = useTabsStore()
      expect(tabsStore.tabs.some(t => t.agentName === 'review-master')).toBe(true)
    })
  })

  it('doneCount = threshold + 1: should launch review (above threshold)', async () => {
    const reviewAgent = makeAgent({ id: 99, name: 'review-master', type: 'review' })
    agents.value = [makeAgent(), reviewAgent]

    const settingsStore = useSettingsStore()
    settingsStore.setAutoReviewThreshold(5)

    api.queryDb.mockResolvedValue([{ id: 1 }])
    useAutoLaunch({ tasks, agents, dbPath })
    tasks.value = []
    await nextTick()

    const doneTasks = Array.from({ length: 6 }, (_, i) =>
      makeTask({ id: i + 1, status: 'done', agent_assigned_id: 10 })
    )
    tasks.value = doneTasks
    await nextTick()

    await vi.waitFor(() => {
      const tabsStore = useTabsStore()
      expect(tabsStore.tabs.some(t => t.agentName === 'review-master')).toBe(true)
    })
  })

  it('mixed statuses: only done tasks count toward threshold', async () => {
    const reviewAgent = makeAgent({ id: 99, name: 'review-master', type: 'review' })
    agents.value = [makeAgent(), reviewAgent]

    const settingsStore = useSettingsStore()
    settingsStore.setAutoReviewThreshold(3)

    useAutoLaunch({ tasks, agents, dbPath })
    tasks.value = []
    await nextTick()

    tasks.value = [
      makeTask({ id: 1, status: 'done', agent_assigned_id: 10 }),
      makeTask({ id: 2, status: 'done', agent_assigned_id: 10 }),
      makeTask({ id: 3, status: 'in_progress', agent_assigned_id: 10 }),
      makeTask({ id: 4, status: 'in_progress', agent_assigned_id: 10 }),
      makeTask({ id: 5, status: 'todo', agent_assigned_id: 10 }),
      makeTask({ id: 6, status: 'archived', agent_assigned_id: 10 }),
      makeTask({ id: 7, status: 'todo', agent_assigned_id: 10 }),
    ]
    await nextTick()
    await vi.advanceTimersByTimeAsync(200)

    const tabsStore = useTabsStore()
    expect(tabsStore.tabs.some(t => t.agentName === 'review-master')).toBe(false)
  })
})

describe('useAutoLaunch T1338: review cooldown boundary', () => {
  let tasks: ReturnType<typeof ref<Task[]>>
  let agents: ReturnType<typeof ref<Agent[]>>
  let dbPath: ReturnType<typeof ref<string | null>>

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
    vi.useFakeTimers()
    const idx = incrementTestIndex()
    vi.setSystemTime(new Date(2026, 7, 4, idx, 0, 0))
    api.queryDb.mockResolvedValue([{ id: 1 }])
    tasks = ref<Task[]>([])
    agents = ref<Agent[]>([])
    dbPath = ref<string | null>('/test/db')
    const tasksStore = useTasksStore()
    ;(tasksStore as unknown as { dbPath: string | null }).dbPath = '/test/db'
  })

  afterEach(() => { vi.useRealTimers() })

  it('cooldown: re-launch blocked within 5min cooldown window', async () => {
    const reviewAgent = makeAgent({ id: 99, name: 'review-master', type: 'review' })
    agents.value = [makeAgent(), reviewAgent]

    useAutoLaunch({ tasks, agents, dbPath })
    tasks.value = []
    await nextTick()

    tasks.value = Array.from({ length: 10 }, (_, i) =>
      makeTask({ id: i + 1, status: 'done', agent_assigned_id: 10 })
    )
    await nextTick()

    await vi.waitFor(() => {
      const tabsStore = useTabsStore()
      expect(tabsStore.tabs.some(t => t.agentName === 'review-master')).toBe(true)
    })

    const tabsStore = useTabsStore()
    const reviewTab = tabsStore.tabs.find(t => t.agentName === 'review-master')!
    tabsStore.closeTab(reviewTab.id)

    vi.advanceTimersByTime(4 * 60 * 1000 + 59 * 1000)

    tasks.value = [...tasks.value.map(t => ({ ...t }))]
    await nextTick()
    await vi.advanceTimersByTimeAsync(200)

    expect(tabsStore.tabs.some(t => t.agentName === 'review-master')).toBe(false)
  })

  it('cooldown: re-launch allowed after exactly 5min cooldown passes', async () => {
    const reviewAgent = makeAgent({ id: 99, name: 'review-master', type: 'review' })
    agents.value = [makeAgent(), reviewAgent]

    useAutoLaunch({ tasks, agents, dbPath })
    tasks.value = []
    await nextTick()

    const doneTasks = Array.from({ length: 10 }, (_, i) =>
      makeTask({ id: i + 1, status: 'done', agent_assigned_id: 10 })
    )
    tasks.value = doneTasks
    await nextTick()

    await vi.waitFor(() => {
      const tabsStore = useTabsStore()
      expect(tabsStore.tabs.some(t => t.agentName === 'review-master')).toBe(true)
    })

    const tabsStore = useTabsStore()
    const reviewTab = tabsStore.tabs.find(t => t.agentName === 'review-master')!
    tabsStore.closeTab(reviewTab.id)

    vi.advanceTimersByTime(5 * 60 * 1000)

    tasks.value = [...doneTasks.map(t => ({ ...t }))]
    await nextTick()

    await vi.waitFor(() => {
      expect(tabsStore.tabs.some(t => t.agentName === 'review-master')).toBe(true)
    })
  })
})
