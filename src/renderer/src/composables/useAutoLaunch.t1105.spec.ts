/**
 * T1105: Additional mutation coverage for useAutoLaunch.ts
 * Tests targeting surviving mutants: dbPath guard, pendingImmediatePolls,
 * FALLBACK_CLOSE_NOTASK_MS, no-task path guards, autoReviewEnabled at init.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { ref, nextTick } from 'vue'
import { useAutoLaunch } from './useAutoLaunch'
import { useTabsStore } from '@renderer/stores/tabs'
import { useSettingsStore } from '@renderer/stores/settings'
import { useTasksStore } from '@renderer/stores/tasks'
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

    // dbPath becomes null → reset fired (pendingCloses cleared)
    dbPath.value = null
    await nextTick()

    await vi.advanceTimersByTimeAsync(200)

    expect(api.agentKill).not.toHaveBeenCalled()
  })
})

describe('useAutoLaunch T1105: FALLBACK_CLOSE_NOTASK_MS (5 minutes)', () => {
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

  it('should NOT force-close no-task agent after 1min (it uses 5min fallback)', async () => {
    const noTaskAgent = makeAgent({ id: 20, name: 'review-master', type: 'review' })
    agents.value = [noTaskAgent]
    useAutoLaunch({ tasks, agents, dbPath })

    tasks.value = []
    await nextTick()

    const tabsStore = useTabsStore()
    tabsStore.addTerminal('review-master', 'Ubuntu-24.04')
    const termTab = tabsStore.tabs.find(t => t.type === 'terminal')!
    termTab.streamId = 'stream-notask-5min'

    tasks.value = [makeTask({ id: 1, status: 'done', agent_assigned_id: 999 })]
    await nextTick()

    // 1 minute: regular task fallback would fire, but no-task uses 5min → no kill
    await vi.advanceTimersByTimeAsync(60 * 1000 + 200)

    expect(api.agentKill).not.toHaveBeenCalled()
  })

  it('should force-close no-task agent after 5 minutes (FALLBACK_CLOSE_NOTASK_MS)', async () => {
    const noTaskAgent = makeAgent({ id: 20, name: 'review-master', type: 'review' })
    agents.value = [noTaskAgent]
    useAutoLaunch({ tasks, agents, dbPath })

    tasks.value = []
    await nextTick()

    const tabsStore = useTabsStore()
    tabsStore.addTerminal('review-master', 'Ubuntu-24.04')
    const termTab = tabsStore.tabs.find(t => t.type === 'terminal')!
    termTab.streamId = 'stream-notask-5min-force'

    tasks.value = [makeTask({ id: 1, status: 'done', agent_assigned_id: 999 })]
    await nextTick()

    await vi.advanceTimersByTimeAsync(80 + 5 * 60 * 1000 + 1000)

    expect(api.agentKill).toHaveBeenCalledWith('stream-notask-5min-force')
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

    // Second watch: no-task path sees pendingCloses.has('dev-front-vuejs')=true → skip
    tasks.value = [...tasks.value]
    await nextTick()
    await vi.advanceTimersByTimeAsync(100)

    // No additional queryDb call from no-task path (it was skipped)
    expect(api.queryDb.mock.calls.length).toBe(firstCallCount)
  })
})

describe('useAutoLaunch T1105: autoReviewEnabled false skips review at init', () => {
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
    vi.setSystemTime(new Date(2026, 2, 4, 0, testIndex * 10, 0))
    api.queryDb.mockResolvedValue([{ id: 1 }])
    tasks = ref<Task[]>([])
    agents = ref<Agent[]>([makeAgent()])
    dbPath = ref<string | null>('/test/db')
    const tasksStore = useTasksStore()
    ;(tasksStore as unknown as { dbPath: string | null }).dbPath = '/test/db'
  })

  afterEach(() => { vi.useRealTimers() })

  it('should NOT launch review on initial load when autoReviewEnabled is false', async () => {
    const settingsStore = useSettingsStore()
    settingsStore.setAutoReviewEnabled(false)

    const reviewAgent = makeAgent({ id: 99, name: 'review-master', type: 'review' })
    agents.value = [makeAgent(), reviewAgent]

    useAutoLaunch({ tasks, agents, dbPath })

    tasks.value = Array.from({ length: 15 }, (_, i) =>
      makeTask({ id: i + 1, status: 'done', agent_assigned_id: 10 })
    )
    await nextTick()
    await nextTick()

    const tabsStore = useTabsStore()
    expect(tabsStore.tabs.some(t => t.agentName === 'review-master')).toBe(false)
  })

  it('should NOT process tasks when autoLaunchAgentSessions is false (task-done path)', async () => {
    const settingsStore = useSettingsStore()
    settingsStore.setAutoLaunchAgentSessions(false)

    useAutoLaunch({ tasks, agents, dbPath })

    tasks.value = [makeTask({ id: 1, status: 'in_progress', agent_assigned_id: 10 })]
    await nextTick()

    const tabsStore = useTabsStore()
    tabsStore.addTerminal('dev-front-vuejs', 'Ubuntu-24.04')
    const termTab = tabsStore.tabs.find(t => t.type === 'terminal')!
    termTab.streamId = 'stream-no-auto-launch'

    tasks.value = [makeTask({ id: 1, status: 'done', agent_assigned_id: 10 })]
    await nextTick()
    await vi.advanceTimersByTimeAsync(200)

    expect(api.agentKill).not.toHaveBeenCalled()
  })

  it('should NOT schedule no-task close when autoLaunchAgentSessions is false', async () => {
    const settingsStore = useSettingsStore()
    settingsStore.setAutoLaunchAgentSessions(false)

    const noTaskAgent = makeAgent({ id: 20, name: 'review-master', type: 'review' })
    agents.value = [noTaskAgent]
    useAutoLaunch({ tasks, agents, dbPath })

    tasks.value = []
    await nextTick()

    const tabsStore = useTabsStore()
    tabsStore.addTerminal('review-master', 'Ubuntu-24.04')
    const termTab = tabsStore.tabs.find(t => t.type === 'terminal')!
    termTab.streamId = 'stream-notask-disabled'

    tasks.value = [makeTask({ id: 1, status: 'done', agent_assigned_id: 999 })]
    await nextTick()
    await vi.advanceTimersByTimeAsync(200)

    expect(api.agentKill).not.toHaveBeenCalled()
  })
})
