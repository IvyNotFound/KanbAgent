/**
 * T1327: Mutation coverage for useAutoLaunch conditions L109, L125, L127
 * Split: cleanup (watcher stop, dbPath reset) and L125 combined condition branches
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { ref, nextTick } from 'vue'
import { useAutoLaunch } from './useAutoLaunch'
import { useTabsStore } from '@renderer/stores/tabs'
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

describe('useAutoLaunch T1327: cleanup — watcher stopped after Vue scope unmount', () => {
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
    vi.setSystemTime(new Date(2026, 3, 4, 0, testIndex * 10, 0))
    api.queryDb.mockResolvedValue([])
    tasks = ref<Task[]>([])
    agents = ref<Agent[]>([makeAgent()])
    dbPath = ref<string | null>('/test/db')
    const tasksStore = useTasksStore()
    ;(tasksStore as unknown as { dbPath: string | null }).dbPath = '/test/db'
  })

  afterEach(() => { vi.useRealTimers() })

  it('pendingCloses cleared on dbPath reset — no agentKill after project change', async () => {
    // After dbPath changes, all pendingCloses are cleared via the dbPath watcher.
    // Any task-done transition after this should not trigger old timers.
    api.queryDb.mockResolvedValue([{ id: 1 }])

    useAutoLaunch({ tasks, agents, dbPath })

    // Seed in_progress
    tasks.value = [makeTask({ id: 1, status: 'in_progress', agent_assigned_id: 10 })]
    await nextTick()

    const tabsStore = useTabsStore()
    tabsStore.addTerminal('dev-front-vuejs', 'Ubuntu-24.04')
    const termTab = tabsStore.tabs.find(t => t.type === 'terminal')!
    termTab.taskId = 1
    termTab.streamId = 'stream-cleanup-test'

    // Task goes done → starts debounce
    tasks.value = [makeTask({ id: 1, status: 'done', agent_assigned_id: 10 })]
    await nextTick()

    // Before debounce fires: reset via dbPath change
    dbPath.value = '/other/db'
    await nextTick()

    // Advance well past debounce + poll — should not fire (cleared by dbPath watch)
    await vi.advanceTimersByTimeAsync(200 + 2000)

    expect(api.agentKill).not.toHaveBeenCalled()
  })

  it('debounce timer reset on dbPath change — subsequent task update re-initializes', async () => {
    // When dbPath changes: initialized=false, previousStatuses cleared.
    // A subsequent task update triggers the init phase (seed), not the action phase.
    useAutoLaunch({ tasks, agents, dbPath })

    // First init
    tasks.value = [makeTask({ id: 1, status: 'in_progress', agent_assigned_id: 10 })]
    await nextTick()

    // Change project
    dbPath.value = '/project2/db'
    await nextTick()

    // New project's first task update → re-seed (no close triggered)
    const tabsStore = useTabsStore()
    tabsStore.addTerminal('dev-front-vuejs', 'Ubuntu-24.04')
    const termTab2 = tabsStore.tabs.find(t => t.type === 'terminal')!
    termTab2.taskId = 1
    termTab2.streamId = 'stream-reseed'

    // This is the re-seed (first watch trigger for new project): initialized=false → seed only
    tasks.value = [makeTask({ id: 1, status: 'done', agent_assigned_id: 10 })]
    await nextTick()
    await vi.advanceTimersByTimeAsync(200)

    // Seed phase: only previousStatuses updated, no scheduleClose
    expect(api.agentKill).not.toHaveBeenCalled()
  })
})

describe('useAutoLaunch T1327: L125 combined condition — all branches', () => {
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
    vi.setSystemTime(new Date(2026, 3, 5, 0, testIndex * 10, 0))
    api.queryDb.mockResolvedValue([{ id: 1 }])
    tasks = ref<Task[]>([])
    agents = ref<Agent[]>([makeAgent()])
    dbPath = ref<string | null>('/test/db')
    const tasksStore = useTasksStore()
    ;(tasksStore as unknown as { dbPath: string | null }).dbPath = '/test/db'
  })

  afterEach(() => { vi.useRealTimers() })

  it('should trigger close only on in_progress→done, not todo→done (prevStatus must be truthy non-done)', async () => {
    // Distinguish: prevStatus='todo' (truthy, not 'done') must trigger; prevStatus='done' must not.
    useAutoLaunch({ tasks, agents, dbPath })

    // Seed: task1 is todo (prevStatus = 'todo'), task2 is done (prevStatus = 'done')
    tasks.value = [
      makeTask({ id: 1, status: 'todo', agent_assigned_id: 10 }),
      makeTask({ id: 2, status: 'done', agent_assigned_id: 10 }),
    ]
    await nextTick()

    const tabsStore = useTabsStore()

    tabsStore.addTerminal('dev-front-vuejs', 'Ubuntu-24.04')
    const termTab1 = tabsStore.tabs.filter(t => t.type === 'terminal')[0]!
    termTab1.taskId = 1
    termTab1.streamId = 'stream-task1'

    tabsStore.addTerminal('dev-front-vuejs', 'Ubuntu-24.04')
    const termTab2 = tabsStore.tabs.filter(t => t.type === 'terminal')[1]!
    termTab2.taskId = 2
    termTab2.streamId = 'stream-task2'

    // task1: todo→done (prevStatus='todo', truthy, not 'done' → triggers close)
    // task2: done→done (prevStatus='done' → condition prevStatus !== 'done' is false → no close)
    tasks.value = [
      makeTask({ id: 1, status: 'done', agent_assigned_id: 10 }),
      makeTask({ id: 2, status: 'done', agent_assigned_id: 10 }),
    ]
    await nextTick()
    await vi.advanceTimersByTimeAsync(200)

    // Only task1 tab should get agentKill
    expect(api.agentKill).toHaveBeenCalledWith('stream-task1')
    expect(api.agentKill).not.toHaveBeenCalledWith('stream-task2')
  })

  it('should trigger close on in_progress→done and skip done→done in the same update', async () => {
    // L125: `prevStatus && prevStatus !== 'done' && task.status === 'done'`
    // task A: in_progress→done → ALL three conditions true → scheduleClose
    // task B: done→done → prevStatus !== 'done' is false → skip
    useAutoLaunch({ tasks, agents, dbPath })

    tasks.value = [
      makeTask({ id: 10, status: 'in_progress', agent_assigned_id: 10 }),
      makeTask({ id: 20, status: 'done', agent_assigned_id: 10 }),
    ]
    await nextTick()

    const tabsStore = useTabsStore()
    tabsStore.addTerminal('dev-front-vuejs', 'Ubuntu-24.04')
    const termA = tabsStore.tabs.filter(t => t.type === 'terminal')[0]!
    termA.taskId = 10
    termA.streamId = 'stream-A'

    tabsStore.addTerminal('dev-front-vuejs', 'Ubuntu-24.04')
    const termB = tabsStore.tabs.filter(t => t.type === 'terminal')[1]!
    termB.taskId = 20
    termB.streamId = 'stream-B'

    tasks.value = [
      makeTask({ id: 10, status: 'done', agent_assigned_id: 10 }),
      makeTask({ id: 20, status: 'done', agent_assigned_id: 10 }),
    ]
    await nextTick()
    await vi.advanceTimersByTimeAsync(200)

    expect(api.agentKill).toHaveBeenCalledWith('stream-A')
    expect(api.agentKill).not.toHaveBeenCalledWith('stream-B')
  })
})
