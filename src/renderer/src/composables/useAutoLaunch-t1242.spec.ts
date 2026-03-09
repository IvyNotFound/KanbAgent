/**
 * T1242: Fix intempestive agent tab closures in useAutoLaunch
 *
 * Three regression tests:
 * 1. Pending close is cancelled when agent receives active tasks (Fix 1 — T1241 fix)
 * 2. Tab IS still closed once session completes for a no-task agent (existing flow regression)
 * 3. No false positive from old completed session when opening a new terminal (Fix 3 — lookbackMs=0)
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
  queryDb: vi.fn().mockResolvedValue([]),
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

describe('useAutoLaunch T1242: Fix 1 — cancel pending close when agent gets active tasks', () => {
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
    vi.setSystemTime(new Date(2026, 5, 1, 0, testIndex * 10, 0))

    // Default: no completed session found
    api.queryDb.mockResolvedValue([])

    tasks = ref<Task[]>([])
    agents = ref<Agent[]>([])
    dbPath = ref<string | null>('/test/db')

    const tasksStore = useTasksStore()
    ;(tasksStore as unknown as { dbPath: string | null }).dbPath = '/test/db'
  })

  afterEach(() => { vi.useRealTimers() })

  it('should cancel pending close when agent receives a new in_progress task', async () => {
    const agent = makeAgent({ id: 20, name: 'test-agent-cancel' })
    agents.value = [agent]
    useAutoLaunch({ tasks, agents, dbPath })

    tasks.value = []
    await nextTick()

    const tabsStore = useTabsStore()
    tabsStore.addTerminal('test-agent-cancel', 'Ubuntu-24.04')
    const termTab = tabsStore.tabs.find(t => t.type === 'terminal')!
    termTab.streamId = 'stream-cancel-test'

    // No active tasks for agent 20 → no-task path schedules close
    tasks.value = [makeTask({ id: 1, status: 'done', agent_assigned_id: 999 })]
    await nextTick()
    await vi.advanceTimersByTimeAsync(100) // debounce fires, scheduleClose called

    // Now agent receives an in_progress task → pending close must be cancelled
    tasks.value = [makeTask({ id: 2, status: 'in_progress', agent_assigned_id: 20 })]
    await nextTick()
    await vi.advanceTimersByTimeAsync(100) // debounce fires again, cancel logic runs

    // Advance well past the 5-minute fallback — tab must NOT be closed
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 2000)

    expect(api.agentKill).not.toHaveBeenCalled()
    expect(tabsStore.tabs.filter(t => t.type === 'terminal')).toHaveLength(1)
  })

  it('should cancel pending close when agent receives a todo task', async () => {
    const agent = makeAgent({ id: 20, name: 'test-agent-todo' })
    agents.value = [agent]
    useAutoLaunch({ tasks, agents, dbPath })

    tasks.value = []
    await nextTick()

    const tabsStore = useTabsStore()
    tabsStore.addTerminal('test-agent-todo', 'Ubuntu-24.04')
    const termTab = tabsStore.tabs.find(t => t.type === 'terminal')!
    termTab.streamId = 'stream-cancel-todo'

    // No active tasks → close scheduled
    tasks.value = [makeTask({ id: 1, status: 'done', agent_assigned_id: 999 })]
    await nextTick()
    await vi.advanceTimersByTimeAsync(100)

    // Agent gets a todo task → cancel close
    tasks.value = [makeTask({ id: 2, status: 'todo', agent_assigned_id: 20 })]
    await nextTick()
    await vi.advanceTimersByTimeAsync(100)

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 2000)

    expect(api.agentKill).not.toHaveBeenCalled()
    expect(tabsStore.tabs.filter(t => t.type === 'terminal')).toHaveLength(1)
  })

  it('should still close tab when session completes after a cancelled+rescheduled close', async () => {
    // Regression: Fix 1 must not break the normal close flow when tasks go done again
    const agent = makeAgent({ id: 20, name: 'test-agent-reschedule' })
    agents.value = [agent]

    // Step 1 immediate poll: no session yet. Step 3 poll (task-done): session found.
    // Note: step 2 (task active) cancels the close → no poll is made at that point.
    api.queryDb
      .mockResolvedValueOnce([])        // step 1 no-task poll → no session
      .mockResolvedValue([{ id: 1 }])   // step 3 task-done poll → session found → close

    useAutoLaunch({ tasks, agents, dbPath })

    tasks.value = []
    await nextTick()

    const tabsStore = useTabsStore()
    tabsStore.addTerminal('test-agent-reschedule', 'Ubuntu-24.04')
    const termTab = tabsStore.tabs.find(t => t.type === 'terminal')!
    termTab.streamId = 'stream-reschedule'

    // Step 1: No active tasks → no-task close scheduled, immediate poll returns []
    tasks.value = [makeTask({ id: 1, status: 'done', agent_assigned_id: 999 })]
    await nextTick()
    await vi.advanceTimersByTimeAsync(100)

    // Step 2: Agent gets in_progress task → cancel close
    tasks.value = [makeTask({ id: 2, status: 'in_progress', agent_assigned_id: 20 })]
    await nextTick()
    await vi.advanceTimersByTimeAsync(100)

    // Step 3: Task transitions to done → task-done path re-schedules close; poll finds session
    tasks.value = [makeTask({ id: 2, status: 'done', agent_assigned_id: 20 })]
    await nextTick()
    // debounce (80ms) + immediate poll (0ms) + queryDb resolves + kill delay (2000ms)
    await vi.advanceTimersByTimeAsync(200 + 2000)

    expect(api.agentKill).toHaveBeenCalledWith('stream-reschedule')
    expect(tabsStore.tabs.filter(t => t.type === 'terminal')).toHaveLength(0)
  })
})

describe('useAutoLaunch T1242: Fix 3 — no-task path uses lookbackMs=0', () => {
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
    vi.setSystemTime(new Date(2026, 5, 2, 0, testIndex * 10, 0))

    api.queryDb.mockResolvedValue([])

    tasks = ref<Task[]>([])
    agents = ref<Agent[]>([])
    dbPath = ref<string | null>('/test/db')

    const tasksStore = useTasksStore()
    ;(tasksStore as unknown as { dbPath: string | null }).dbPath = '/test/db'
  })

  afterEach(() => { vi.useRealTimers() })

  it('should pass notBefore=now (no lookback) to queryDb for no-task path', async () => {
    const capturedParams: unknown[][] = []
    api.queryDb.mockImplementation((_path: string, _sql: string, params: unknown[]) => {
      capturedParams.push(params)
      return Promise.resolve([])
    })

    const now = new Date(2026, 5, 2, 12, 0, 0)
    vi.setSystemTime(now)

    const agent = makeAgent({ id: 20, name: 'test-agent-lookback' })
    agents.value = [agent]
    useAutoLaunch({ tasks, agents, dbPath })

    tasks.value = []
    await nextTick()

    const tabsStore = useTabsStore()
    tabsStore.addTerminal('test-agent-lookback', 'Ubuntu-24.04')

    // Trigger no-task path
    tasks.value = [makeTask({ id: 1, status: 'done', agent_assigned_id: 999 })]
    await nextTick()
    await vi.advanceTimersByTimeAsync(200) // debounce + immediate poll fires

    expect(capturedParams.length).toBeGreaterThan(0)

    // notBefore should be approximately now (lookbackMs=0), not 5 minutes ago
    const notBefore = capturedParams[0][1] as string
    const notBeforeDate = new Date(notBefore.replace(' ', 'T') + 'Z')
    const expectedMs = now.getTime()

    // Should be within 1 second of current time (not ~5 min ago)
    expect(Math.abs(notBeforeDate.getTime() - expectedMs)).toBeLessThan(1000)

    // Extra guard: confirm it is NOT 5 minutes in the past
    const fiveMinAgo = expectedMs - 5 * 60 * 1000
    expect(notBeforeDate.getTime()).toBeGreaterThan(fiveMinAgo + 60 * 1000)
  })

  it('should NOT trigger false close when agent had a session completed 3 min ago', async () => {
    // Simulate: queryDb returns a session only if notBefore <= 3 min ago
    // (i.e., the session was completed 3 min before the schedule was created)
    const sessionEndedAt = new Date(Date.now() - 3 * 60 * 1000)
      .toISOString().replace('T', ' ').slice(0, 19)

    api.queryDb.mockImplementation((_path: string, _sql: string, params: unknown[]) => {
      const notBefore = params[1] as string
      // Session is 3 min old; only return it if notBefore is also old (>= 3 min lookback)
      if (notBefore <= sessionEndedAt) {
        return Promise.resolve([{ id: 1 }]) // old behavior: false positive
      }
      return Promise.resolve([]) // correct behavior: no match
    })

    const agent = makeAgent({ id: 20, name: 'test-agent-nofp' })
    agents.value = [agent]
    useAutoLaunch({ tasks, agents, dbPath })

    tasks.value = []
    await nextTick()

    const tabsStore = useTabsStore()
    tabsStore.addTerminal('test-agent-nofp', 'Ubuntu-24.04')
    const termTab = tabsStore.tabs.find(t => t.type === 'terminal')!
    termTab.streamId = 'stream-no-false-positive'

    // Trigger no-task path for the agent
    tasks.value = [makeTask({ id: 1, status: 'done', agent_assigned_id: 999 })]
    await nextTick()
    await vi.advanceTimersByTimeAsync(200) // debounce + immediate poll

    // With lookbackMs=0: notBefore = now > sessionEndedAt → no match → no close ✓
    expect(api.agentKill).not.toHaveBeenCalled()
    expect(tabsStore.tabs.filter(t => t.type === 'terminal')).toHaveLength(1)
  })
})
