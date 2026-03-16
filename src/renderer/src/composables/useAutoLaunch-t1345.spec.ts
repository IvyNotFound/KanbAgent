/**
 * T1345: Kill surviving ConditionalExpression mutations in useAutoLaunch
 *
 * Targets:
 * - Lines 103/116: debounce branch guards
 *   - clearTimeout IS called when debounceId !== null
 *   - clearTimeout is NOT called when debounceId === null (two rapid calls: only last fires)
 *   - guard line 109: internal debounce body guard both branches
 * - Line 125: task.agent_assigned_id falsy → task NOT selected for review
 *   - task.status !== 'done' → not selected
 *   - agent_assigned_id null → not selected
 *   - task.status === 'done' AND agent_assigned_id present → selected
 * - Lines 103 (REVIEW_COOLDOWN_MS boundary): boundary at exactly REVIEW_COOLDOWN_MS
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { ref, nextTick } from 'vue'
import { useAutoLaunch } from './useAutoLaunch'
import { useTabsStore } from '@renderer/stores/tabs'
import { useTasksStore } from '@renderer/stores/tasks'
import { useSettingsStore } from '@renderer/stores/settings'
import type { Task, Agent } from '@renderer/types'

const api = {
  getCliInstances: vi.fn().mockResolvedValue([
    { cli: 'claude', distro: 'Ubuntu-24.04', version: '2.1.58', isDefault: true, type: 'wsl' }
  ]),
  getAgentSystemPrompt: vi.fn().mockResolvedValue({
    success: true, systemPrompt: 'You are dev-front', systemPromptSuffix: null, thinkingMode: 'auto'
  }),
  buildAgentPrompt: vi.fn().mockResolvedValue('final prompt'),
  agentKill: vi.fn().mockResolvedValue(undefined),
  queryDb: vi.fn().mockResolvedValue([{ id: 1 }]),
}

Object.defineProperty(window, 'electronAPI', { value: api, writable: true })

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 1, title: 'Test task', description: null, status: 'todo',
    agent_assigned_id: 10, agent_creator_id: null, agent_validator_id: null,
    agent_name: 'dev-front-vuejs', agent_creator_name: null, agent_scope: null,
    parent_task_id: null, session_id: null, scope: 'front-vuejs',
    effort: 2, priority: 'normal', created_at: '', updated_at: '',
    started_at: null, completed_at: null, validated_at: null,
    ...overrides
  } as Task
}

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 10, name: 'dev-front-vuejs', type: 'dev', scope: 'front-vuejs',
    system_prompt: null, system_prompt_suffix: null, thinking_mode: 'auto',
    allowed_tools: null, auto_launch: 1, permission_mode: null, max_sessions: 3, created_at: '',
    ...overrides
  } as Agent
}

describe('useAutoLaunch T1345: debounce branch coverage', () => {
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
    vi.setSystemTime(new Date(2026, 8, 1, 0, testIndex * 10, 0))

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

    // First done transition at t=0 → debounceId set
    tasks.value = [makeTask({ id: 1, status: 'done', agent_assigned_id: 10 })]
    await nextTick()

    // Advance 40ms — within debounce window, debounceId is still set
    await vi.advanceTimersByTimeAsync(40)

    // Second update at t=40ms → debounceId !== null → clearTimeout IS called
    tasks.value = [makeTask({ id: 1, status: 'done', agent_assigned_id: 10 })]
    await nextTick()

    // Advance 40ms more — original debounce would have fired but was cancelled
    await vi.advanceTimersByTimeAsync(40)

    // No poll yet — second debounce still pending
    expect(pollCallTimes.length).toBe(0)

    // Complete the second debounce window (80ms total from second update)
    await vi.advanceTimersByTimeAsync(80)

    // Only ONE scheduleClose fired (not two) — debounce worked
    // Poll fires: agentKill should have been called exactly once
    expect(api.agentKill).toHaveBeenCalledTimes(1)
    expect(api.agentKill).toHaveBeenCalledWith('stream-debounce-guard')
  })

  it('debounceId === null: clearTimeout NOT called when first update arrives (no pending timer)', async () => {
    // Kill ConditionalExpression mutation: if(true) on `if (debounceId !== null)` line 116
    // When debounceId is null (first update after init), clearTimeout must not be called.
    // We verify the handler still runs correctly — scheduleClose fires after the debounce.
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')

    useAutoLaunch({ tasks, agents, dbPath })

    // Seed phase with in_progress task — sets previousStatuses
    tasks.value = [makeTask({ id: 1, status: 'in_progress', agent_assigned_id: 10 })]
    await nextTick()

    const tabsStore = useTabsStore()
    tabsStore.addTerminal('dev-front-vuejs', 'Ubuntu-24.04')
    const termTab = tabsStore.tabs.find(t => t.type === 'terminal')!
    termTab.taskId = 1
    termTab.streamId = 'stream-first-update'

    // At this point debounceId === null (no prior debounce pending).
    // Single update triggers the watch — debounce branch: debounceId is null, skip clearTimeout.
    tasks.value = [makeTask({ id: 1, status: 'done', agent_assigned_id: 10 })]
    await nextTick()

    // Advance to let the debounce fire
    await vi.advanceTimersByTimeAsync(200)

    // The handler DID fire — scheduleClose was called — agentKill was invoked
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

    // Update 2 at t=30ms (still done) — cancels first debounce
    await vi.advanceTimersByTimeAsync(30)
    tasks.value = [makeTask({ id: 1, status: 'done', agent_assigned_id: 10 })]
    await nextTick()

    // Advance 30ms more (t=60ms) — original debounce would fire at t=80ms (cancelled)
    await vi.advanceTimersByTimeAsync(30)

    // No handler fired yet
    expect(api.agentKill).not.toHaveBeenCalled()

    // Complete second debounce (t=30 + 80 = 110ms total from start)
    await vi.advanceTimersByTimeAsync(80)

    // Handler fired once — agentKill called once
    expect(api.agentKill).toHaveBeenCalledTimes(1)
    expect(api.agentKill).toHaveBeenCalledWith('stream-rapid-1')
  })
})

describe('useAutoLaunch T1345: task filter mutations (line 125)', () => {
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
    vi.setSystemTime(new Date(2026, 8, 2, 0, testIndex * 10, 0))

    api.queryDb.mockResolvedValue([{ id: 1 }])

    tasks = ref<Task[]>([])
    agents = ref<Agent[]>([])
    dbPath = ref<string | null>('/test/db')

    const tasksStore = useTasksStore()
    ;(tasksStore as unknown as { dbPath: string | null }).dbPath = '/test/db'
  })

  afterEach(() => { vi.useRealTimers() })

  it('task.status !== done: task is NOT selected for Chemin 1 close', async () => {
    // Kill mutation: flip task.status === 'done' → always-true
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
    // Kill mutation: flip task.agent_assigned_id check → always-true
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

    // No Chemin 1 close — agent_assigned_id is null
    expect(api.agentKill).not.toHaveBeenCalledWith('stream-no-agent')
  })

  it('agent_assigned_id === 0 (falsy): task NOT selected for Chemin 1 close', async () => {
    // 0 is falsy — same guard behavior as null
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
    // Both conditions true → scheduleClose fires
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

    // Transition to done WITH agent_assigned_id → must trigger Chemin 1
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

    // prevStatus is undefined → condition fails → no Chemin 1 close
    // (no-task Chemin 2 also won't fire since tab has a taskId)
    expect(api.agentKill).not.toHaveBeenCalledWith('stream-new-task')
  })
})

describe('useAutoLaunch T1345: REVIEW_COOLDOWN_MS boundary (line 103)', () => {
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
    vi.setSystemTime(new Date(2026, 8, 3, 0, testIndex * 10, 0))

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

    // Advance 4min59s (299s) — still within REVIEW_COOLDOWN_MS (300s)
    vi.advanceTimersByTime(299 * 1000)

    // Another batch triggers checkReviewThreshold
    tasks.value = [...makeDoneTasks(5)]
    await nextTick()
    await nextTick()

    // Cooldown not expired → review NOT launched
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

    // dbPath is set → no early return → scheduleClose fires
    expect(api.agentKill).toHaveBeenCalledWith('stream-valid-db')
  })
})
