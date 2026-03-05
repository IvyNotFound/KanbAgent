import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { ref, nextTick } from 'vue'
import { useAutoLaunch } from './useAutoLaunch'
import { useTabsStore } from '@renderer/stores/tabs'
import { useSettingsStore } from '@renderer/stores/settings'
import { useTasksStore } from '@renderer/stores/tasks'
import type { Task, Agent } from '@renderer/types'

// Mock window.electronAPI
const api = {
  getClaudeInstances: vi.fn().mockResolvedValue([
    { distro: 'Ubuntu-24.04', version: '2.1.58', isDefault: true, profiles: ['claude'] }
  ]),
  getAgentSystemPrompt: vi.fn().mockResolvedValue({
    success: true, systemPrompt: 'You are dev-front', systemPromptSuffix: null, thinkingMode: 'auto'
  }),
  buildAgentPrompt: vi.fn().mockResolvedValue('final prompt'),
  terminalWrite: vi.fn().mockResolvedValue(undefined),
  terminalKill: vi.fn().mockResolvedValue(undefined),
  // queryDb: returns a completed session by default (used by scheduleClose poller)
  queryDb: vi.fn().mockResolvedValue([{ id: 1 }]),
}

Object.defineProperty(window, 'electronAPI', { value: api, writable: true })

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 1, titre: 'Test task', description: null, statut: 'todo',
    agent_assigne_id: 10, agent_createur_id: null, agent_valideur_id: null,
    agent_name: 'dev-front-vuejs', agent_createur_name: null, agent_perimetre: null,
    parent_task_id: null, session_id: null, perimetre: 'front-vuejs',
    effort: 2, priority: 'normal', created_at: '', updated_at: '',
    started_at: null, completed_at: null, validated_at: null,
    ...overrides
  } as Task
}

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 10, name: 'dev-front-vuejs', type: 'dev', perimetre: 'front-vuejs',
    system_prompt: null, system_prompt_suffix: null, thinking_mode: 'auto',
    allowed_tools: null, auto_launch: 1, created_at: '',
    ...overrides
  } as Agent
}

describe('composables/useAutoLaunch', () => {
  let tasks: ReturnType<typeof ref<Task[]>>
  let agents: ReturnType<typeof ref<Agent[]>>
  let dbPath: ReturnType<typeof ref<string | null>>

  // Counter to ensure each test gets a unique time far enough apart to expire
  // the module-level getCachedClaudeInstances cache (TTL = 5min)
  let testIndex = 0

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
    vi.useFakeTimers()
    testIndex++
    vi.setSystemTime(new Date(2026, 0, 1, 0, testIndex * 10, 0))

    // Default: queryDb returns a completed session (agent is done, safe to close)
    api.queryDb.mockResolvedValue([{ id: 1 }])

    tasks = ref<Task[]>([])
    agents = ref<Agent[]>([makeAgent()])
    dbPath = ref<string | null>('/test/db')

    // Set dbPath on tasks store so useLaunchSession can access it
    const tasksStore = useTasksStore()
    ;(tasksStore as unknown as { dbPath: string | null }).dbPath = '/test/db'
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should not launch on initial load (seeding phase)', async () => {
    tasks.value = [makeTask()]
    useAutoLaunch({ tasks, agents, dbPath })
    await nextTick()

    const tabsStore = useTabsStore()
    expect(tabsStore.tabs.filter(t => t.type === 'terminal')).toHaveLength(0)
  })

  it('T900: should launch review on initial load when done count >= threshold', async () => {
    const reviewAgent = makeAgent({ id: 99, name: 'review-master', type: 'review' })
    agents.value = [makeAgent(), reviewAgent]

    const settingsStore = useSettingsStore()
    settingsStore.setAutoReviewThreshold(3)

    useAutoLaunch({ tasks, agents, dbPath })

    // First watch trigger = init phase: 5 done tasks already present at startup
    tasks.value = Array.from({ length: 5 }, (_, i) =>
      makeTask({ id: i + 1, statut: 'done', agent_assigne_id: 10 })
    )
    await nextTick()

    await vi.waitFor(() => {
      const tabsStore = useTabsStore()
      expect(tabsStore.tabs.some(t => t.type === 'terminal' && t.agentName === 'review-master')).toBe(true)
    })
  })

  it('T900: should NOT launch review on initial load when done count < threshold', async () => {
    const reviewAgent = makeAgent({ id: 99, name: 'review-master', type: 'review' })
    agents.value = [makeAgent(), reviewAgent]

    const settingsStore = useSettingsStore()
    settingsStore.setAutoReviewThreshold(10)

    useAutoLaunch({ tasks, agents, dbPath })

    // First watch trigger = init phase: only 3 done tasks, below threshold of 10
    tasks.value = Array.from({ length: 3 }, (_, i) =>
      makeTask({ id: i + 1, statut: 'done', agent_assigne_id: 10 })
    )
    await nextTick()
    await nextTick()

    const tabsStore = useTabsStore()
    expect(tabsStore.tabs.some(t => t.agentName === 'review-master')).toBe(false)
  })

  it('should NOT auto-launch terminal when new task appears (T345: removed)', async () => {
    useAutoLaunch({ tasks, agents, dbPath })

    // Seed phase
    tasks.value = []
    await nextTick()

    // New task appears — auto-launch was removed in T345
    tasks.value = [makeTask({ id: 1, statut: 'todo', agent_assigne_id: 10 })]
    await nextTick()
    await nextTick()

    const tabsStore = useTabsStore()
    expect(tabsStore.tabs.filter(t => t.type === 'terminal')).toHaveLength(0)
  })

  it('should schedule close when task transitions to done (polls DB for completed)', async () => {
    useAutoLaunch({ tasks, agents, dbPath })

    // Seed with in_progress task
    tasks.value = [makeTask({ id: 1, statut: 'in_progress', agent_assigne_id: 10 })]
    await nextTick()

    // Simulate an existing terminal for this agent
    const tabsStore = useTabsStore()
    tabsStore.addTerminal('dev-front-vuejs', 'Ubuntu-24.04')
    const termTab = tabsStore.tabs.find(t => t.type === 'terminal')!
    termTab.ptyId = 'pty-123'

    // Task transitions to done
    tasks.value = [makeTask({ id: 1, statut: 'done', agent_assigne_id: 10 })]
    await nextTick()

    // Terminal should still exist (immediate poll is async — not yet resolved)
    expect(tabsStore.tabs.filter(t => t.type === 'terminal')).toHaveLength(1)

    // Advance past the 80ms debounce + immediate 0ms poll, flush promises
    await vi.advanceTimersByTimeAsync(81)

    // Ctrl+C should have been sent (completed session found in DB)
    expect(api.terminalWrite).toHaveBeenCalledWith('pty-123', '\x03')

    // Advance past kill delay (2s)
    await vi.advanceTimersByTimeAsync(2000)

    expect(api.terminalKill).toHaveBeenCalledWith('pty-123')
  })

  it('should wait for completed before closing (no early close when session still active)', async () => {
    // queryDb returns no completed session (agent still running)
    api.queryDb.mockResolvedValue([])

    useAutoLaunch({ tasks, agents, dbPath })

    // Seed
    tasks.value = [makeTask({ id: 1, statut: 'in_progress', agent_assigne_id: 10 })]
    await nextTick()

    const tabsStore = useTabsStore()
    tabsStore.addTerminal('dev-front-vuejs', 'Ubuntu-24.04')
    const termTab = tabsStore.tabs.find(t => t.type === 'terminal')!
    termTab.ptyId = 'pty-waiting'

    // Task transitions to done
    tasks.value = [makeTask({ id: 1, statut: 'done', agent_assigne_id: 10 })]
    await nextTick()

    // Poll fires — but no completed session yet
    await vi.advanceTimersByTimeAsync(1)
    expect(api.terminalWrite).not.toHaveBeenCalled()

    // More polls fire — still no completed
    await vi.advanceTimersByTimeAsync(5_000)
    expect(api.terminalWrite).not.toHaveBeenCalled()

    // Session becomes completed
    api.queryDb.mockResolvedValue([{ id: 42 }])
    await vi.advanceTimersByTimeAsync(5_000)

    expect(api.terminalWrite).toHaveBeenCalledWith('pty-waiting', '\x03')
  })

  it('should force-close after fallback timeout even if session never completes', async () => {
    // Session never becomes completed
    api.queryDb.mockResolvedValue([])

    useAutoLaunch({ tasks, agents, dbPath })

    // Seed
    tasks.value = [makeTask({ id: 1, statut: 'in_progress', agent_assigne_id: 10 })]
    await nextTick()

    const tabsStore = useTabsStore()
    tabsStore.addTerminal('dev-front-vuejs', 'Ubuntu-24.04')
    const termTab = tabsStore.tabs.find(t => t.type === 'terminal')!
    termTab.ptyId = 'pty-fallback'

    // Task transitions to done
    tasks.value = [makeTask({ id: 1, statut: 'done', agent_assigne_id: 10 })]
    await nextTick()

    // Advance 5 minutes + 80ms debounce (fallback timeout starts after debounce fires)
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 80)

    // Force-close should have happened
    expect(api.terminalWrite).toHaveBeenCalledWith('pty-fallback', '\x03')
  })

  it('should reset tracking when dbPath changes', async () => {
    useAutoLaunch({ tasks, agents, dbPath })

    // Seed
    tasks.value = [makeTask({ id: 1 })]
    await nextTick()

    // Switch project
    dbPath.value = '/other/db'
    await nextTick()

    // Same task ID 1 should not trigger launch (it's a different project, re-seeded)
    tasks.value = [makeTask({ id: 1 })]
    await nextTick()

    const tabsStore = useTabsStore()
    expect(tabsStore.tabs.filter(t => t.type === 'terminal')).toHaveLength(0)
  })

  describe('settings store', () => {
    it('autoLaunchAgentSessions defaults to true', () => {
      const settingsStore = useSettingsStore()
      expect(settingsStore.autoLaunchAgentSessions).toBe(true)
    })

    it('persists autoLaunchAgentSessions to localStorage', () => {
      const settingsStore = useSettingsStore()
      settingsStore.setAutoLaunchAgentSessions(false)
      expect(localStorage.getItem('autoLaunchAgentSessions')).toBe('false')
    })

    it('autoReviewEnabled defaults to true', () => {
      const settingsStore = useSettingsStore()
      expect(settingsStore.autoReviewEnabled).toBe(true)
    })

    it('autoReviewThreshold defaults to 10', () => {
      const settingsStore = useSettingsStore()
      expect(settingsStore.autoReviewThreshold).toBe(10)
    })

    it('clamps autoReviewThreshold to minimum 3', () => {
      const settingsStore = useSettingsStore()
      settingsStore.setAutoReviewThreshold(1)
      expect(settingsStore.autoReviewThreshold).toBe(3)
    })
  })

  describe('T341: auto-review', () => {
    function makeDoneTasks(count: number): Task[] {
      return Array.from({ length: count }, (_, i) =>
        makeTask({ id: i + 1, statut: 'done', agent_assigne_id: 10 })
      )
    }

    it('should launch review when done tasks reach threshold', async () => {
      const reviewAgent = makeAgent({ id: 99, name: 'review-master', type: 'review' })
      agents.value = [makeAgent(), reviewAgent]
      useAutoLaunch({ tasks, agents, dbPath })

      // Seed phase
      tasks.value = []
      await nextTick()

      // 10 done tasks appear
      tasks.value = makeDoneTasks(10)
      await nextTick()

      await vi.waitFor(() => {
        const tabsStore = useTabsStore()
        expect(tabsStore.tabs.some(t => t.type === 'terminal' && t.agentName === 'review-master')).toBe(true)
      })
    })

    it('should NOT launch review below threshold', async () => {
      const reviewAgent = makeAgent({ id: 99, name: 'review-master', type: 'review' })
      agents.value = [makeAgent(), reviewAgent]
      useAutoLaunch({ tasks, agents, dbPath })

      tasks.value = []
      await nextTick()

      tasks.value = makeDoneTasks(5)
      await nextTick()
      await nextTick()

      const tabsStore = useTabsStore()
      expect(tabsStore.tabs.some(t => t.type === 'terminal' && t.agentName === 'review-master')).toBe(false)
    })

    it('should NOT re-launch review within cooldown (5min)', async () => {
      const reviewAgent = makeAgent({ id: 99, name: 'review-master', type: 'review' })
      agents.value = [makeAgent(), reviewAgent]
      useAutoLaunch({ tasks, agents, dbPath })

      tasks.value = []
      await nextTick()

      // First batch: triggers review
      tasks.value = makeDoneTasks(10)
      await nextTick()

      await vi.waitFor(() => {
        const tabsStore = useTabsStore()
        expect(tabsStore.tabs.some(t => t.agentName === 'review-master')).toBe(true)
      })

      // Close the review terminal
      const tabsStore = useTabsStore()
      const reviewTab = tabsStore.tabs.find(t => t.agentName === 'review-master')!
      tabsStore.closeTab(reviewTab.id)

      // Advance 1 minute (still in cooldown)
      vi.advanceTimersByTime(60_000)

      // Another refresh with 10 done tasks — should NOT re-launch
      tasks.value = [...makeDoneTasks(10)]
      await nextTick()
      await nextTick()

      expect(tabsStore.tabs.some(t => t.agentName === 'review-master')).toBe(false)
    })

    it('should NOT launch review when autoReviewEnabled is false', async () => {
      const settingsStore = useSettingsStore()
      settingsStore.setAutoReviewEnabled(false)

      const reviewAgent = makeAgent({ id: 99, name: 'review-master', type: 'review' })
      agents.value = [makeAgent(), reviewAgent]
      useAutoLaunch({ tasks, agents, dbPath })

      tasks.value = []
      await nextTick()

      tasks.value = makeDoneTasks(10)
      await nextTick()
      await nextTick()

      const tabsStore = useTabsStore()
      expect(tabsStore.tabs.some(t => t.agentName === 'review-master')).toBe(false)
    })

    it('should NOT launch review if review terminal already exists', async () => {
      const reviewAgent = makeAgent({ id: 99, name: 'review-master', type: 'review' })
      agents.value = [makeAgent(), reviewAgent]

      const tabsStore = useTabsStore()
      tabsStore.addTerminal('review-master', 'Ubuntu-24.04')

      useAutoLaunch({ tasks, agents, dbPath })

      tasks.value = []
      await nextTick()

      tasks.value = makeDoneTasks(10)
      await nextTick()
      await nextTick()

      // Still only the manually added one
      expect(tabsStore.tabs.filter(t => t.agentName === 'review-master')).toHaveLength(1)
    })

    it('should respect custom threshold from settings', async () => {
      const settingsStore = useSettingsStore()
      settingsStore.setAutoReviewThreshold(5)

      const reviewAgent = makeAgent({ id: 99, name: 'review-master', type: 'review' })
      agents.value = [makeAgent(), reviewAgent]
      useAutoLaunch({ tasks, agents, dbPath })

      tasks.value = []
      await nextTick()

      // 5 done tasks should trigger with threshold=5
      tasks.value = makeDoneTasks(5)
      await nextTick()

      await vi.waitFor(() => {
        const tabsStore = useTabsStore()
        expect(tabsStore.tabs.some(t => t.agentName === 'review-master')).toBe(true)
      })
    })
  })

  describe('T646 regression: no-task agent auto-close', () => {
    it('should NOT close terminal immediately when queryDb returns no post-schedule session', async () => {
      // Regression: T646 fix caused no-task agents (task-creator, review…) to close
      // immediately after launch if a previous session completed within 10 minutes.
      // Fix: use notBefore = scheduleClose time so only sessions completing AFTER
      // the scheduling window are considered.
      api.queryDb.mockResolvedValue([]) // no session completed after notBefore

      const noTaskAgent = makeAgent({ id: 20, name: 'task-creator' })
      agents.value = [noTaskAgent]
      useAutoLaunch({ tasks, agents, dbPath })

      // Seed: no tasks
      tasks.value = []
      await nextTick()

      const tabsStore = useTabsStore()
      tabsStore.addTerminal('task-creator', 'Ubuntu-24.04')
      const termTab = tabsStore.tabs.find(t => t.type === 'terminal')!
      termTab.ptyId = 'pty-task-creator-notask'

      // Trigger tasks watch (task for a different agent)
      tasks.value = [makeTask({ id: 1, statut: 'done', agent_assigne_id: 999 })]
      await nextTick()

      // Past debounce + immediate poll
      await vi.advanceTimersByTimeAsync(200)

      // Terminal must still be open — old session must not trigger close
      expect(api.terminalWrite).not.toHaveBeenCalled()
      expect(tabsStore.tabs.filter(t => t.type === 'terminal')).toHaveLength(1)
    })

    it('should close no-task agent terminal after its own session completes post-scheduling', async () => {
      api.queryDb.mockResolvedValue([]) // initially no completed session

      const noTaskAgent = makeAgent({ id: 20, name: 'task-creator' })
      agents.value = [noTaskAgent]
      useAutoLaunch({ tasks, agents, dbPath })

      tasks.value = []
      await nextTick()

      const tabsStore = useTabsStore()
      tabsStore.addTerminal('task-creator', 'Ubuntu-24.04')
      const termTab = tabsStore.tabs.find(t => t.type === 'terminal')!
      termTab.ptyId = 'pty-task-creator-close'

      // Trigger no-task check
      tasks.value = [makeTask({ id: 1, statut: 'done', agent_assigne_id: 999 })]
      await nextTick()
      await vi.advanceTimersByTimeAsync(200) // debounce + immediate poll → no close

      expect(api.terminalWrite).not.toHaveBeenCalled()

      // Session completes → next poll detects it
      api.queryDb.mockResolvedValue([{ id: 99 }])
      await vi.advanceTimersByTimeAsync(5_000 + 100) // POLL_INTERVAL_MS = 5_000

      expect(api.terminalWrite).toHaveBeenCalledWith('pty-task-creator-close', '\x03')
    })

    it('should pass a notBefore ISO timestamp as 2nd queryDb param (with 5min lookback)', async () => {
      const capturedParams: unknown[][] = []
      api.queryDb.mockImplementation((_path, _query, params) => {
        capturedParams.push(params as unknown[])
        return Promise.resolve([])
      })

      const noTaskAgent = makeAgent({ id: 20, name: 'task-creator' })
      agents.value = [noTaskAgent]
      useAutoLaunch({ tasks, agents, dbPath })

      tasks.value = []
      await nextTick()

      const tabsStore = useTabsStore()
      tabsStore.addTerminal('task-creator', 'Ubuntu-24.04')

      const beforeSchedule = new Date().toISOString()
      tasks.value = [makeTask({ id: 1, statut: 'done', agent_assigne_id: 999 })]
      await nextTick()
      await vi.advanceTimersByTimeAsync(200)

      expect(capturedParams.length).toBeGreaterThan(0)
      const [agentIdParam, notBeforeParam] = capturedParams[0] as [number, string]
      expect(agentIdParam).toBe(20)
      // T906: notBefore must use SQLite datetime format "YYYY-MM-DD HH:MM:SS" (space, no T/Z)
      // because SQLite CURRENT_TIMESTAMP stores ended_at in that format. ISO strings would
      // compare GREATER than SQLite timestamps (space ASCII 32 < T ASCII 84), making
      // ended_at >= notBefore always false and the poll never finding completed sessions.
      expect(typeof notBeforeParam).toBe('string')
      expect(notBeforeParam).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
      const LOOKBACK_MS = 5 * 60 * 1000
      const notBeforeTime = new Date(notBeforeParam.replace(' ', 'T') + 'Z').getTime()
      const scheduleTime = new Date(beforeSchedule).getTime()
      // notBefore = now - 5min: within the lookback window
      expect(notBeforeTime).toBeLessThanOrEqual(scheduleTime + 100)
      expect(notBeforeTime).toBeGreaterThanOrEqual(scheduleTime - LOOKBACK_MS - 200)
    })

    it('T835: should close terminal when session completed BEFORE scheduleClose was called (race condition)', async () => {
      // Session was already completed before the renderer detected the done transition
      api.queryDb.mockResolvedValue([{ id: 77 }])

      useAutoLaunch({ tasks, agents, dbPath })

      tasks.value = [makeTask({ id: 1, statut: 'in_progress', agent_assigne_id: 10 })]
      await nextTick()

      const tabsStore = useTabsStore()
      tabsStore.addTerminal('dev-front-vuejs', 'Ubuntu-24.04')
      const termTab = tabsStore.tabs.find(t => t.type === 'terminal')!
      termTab.ptyId = 'pty-race'

      // Task transitions to done — agent session was already completed (race condition)
      tasks.value = [makeTask({ id: 1, statut: 'done', agent_assigne_id: 10 })]
      await nextTick()

      // Past debounce + immediate poll → lookback window covers the completed session
      await vi.advanceTimersByTimeAsync(150)

      expect(api.terminalWrite).toHaveBeenCalledWith('pty-race', '\x03')
    })
  })

  // NOTE: launchAgentTerminal failure tests moved to useLaunchSession.spec.ts
  // (T345 removed auto-launch from useAutoLaunch — those were false-greens)

  describe('launchReviewSession failure', () => {
    function makeDoneTasks(count: number): Task[] {
      return Array.from({ length: count }, (_, i) =>
        makeTask({ id: i + 1, statut: 'done', agent_assigne_id: 10 })
      )
    }

    it('should not crash when getClaudeInstances rejects for review', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      const reviewAgent = makeAgent({ id: 99, name: 'review-master', type: 'review' })
      agents.value = [makeAgent(), reviewAgent]

      api.getClaudeInstances.mockRejectedValue(new Error('review IPC error'))

      useAutoLaunch({ tasks, agents, dbPath })

      tasks.value = []
      await nextTick()

      tasks.value = makeDoneTasks(10)
      await nextTick()
      await vi.advanceTimersByTimeAsync(0)

      // No review terminal should be added
      const tabsStore = useTabsStore()
      expect(tabsStore.tabs.some(t => t.agentName === 'review-master')).toBe(false)
      vi.mocked(console.warn).mockRestore()
    })

    it('should not launch review when getClaudeInstances returns []', async () => {
      const reviewAgent = makeAgent({ id: 99, name: 'review-master', type: 'review' })
      agents.value = [makeAgent(), reviewAgent]
      api.getClaudeInstances.mockResolvedValue([])

      useAutoLaunch({ tasks, agents, dbPath })

      tasks.value = []
      await nextTick()

      tasks.value = makeDoneTasks(10)
      await nextTick()
      await nextTick()

      const tabsStore = useTabsStore()
      expect(tabsStore.tabs.some(t => t.agentName === 'review-master')).toBe(false)
    })
  })

  describe('T411: auto_launch per-agent flag', () => {
    it('should NOT schedule close when agent.auto_launch is 0', async () => {
      const noAutoLaunchAgent = makeAgent({ id: 10, name: 'dev-front-vuejs', auto_launch: 0 })
      agents.value = [noAutoLaunchAgent]
      useAutoLaunch({ tasks, agents, dbPath })

      // Seed with in_progress task
      tasks.value = [makeTask({ id: 1, statut: 'in_progress', agent_assigne_id: 10 })]
      await nextTick()

      const tabsStore = useTabsStore()
      tabsStore.addTerminal('dev-front-vuejs', 'Ubuntu-24.04')
      const termTab = tabsStore.tabs.find(t => t.type === 'terminal')!
      termTab.ptyId = 'pty-no-auto'

      // Task transitions to done
      tasks.value = [makeTask({ id: 1, statut: 'done', agent_assigne_id: 10 })]
      await nextTick()

      // Advance past poll interval and fallback — no close should happen
      await vi.advanceTimersByTimeAsync(5000)
      await vi.advanceTimersByTimeAsync(2000)

      expect(api.terminalWrite).not.toHaveBeenCalled()
      expect(api.terminalKill).not.toHaveBeenCalled()
      expect(tabsStore.tabs.filter(t => t.type === 'terminal')).toHaveLength(1)
    })
  })

  describe('scheduleClose edge cases', () => {
    it('should closeTab directly when tab has no ptyId', async () => {
      useAutoLaunch({ tasks, agents, dbPath })

      // Seed with in_progress task
      tasks.value = [makeTask({ id: 1, statut: 'in_progress', agent_assigne_id: 10 })]
      await nextTick()

      // Add terminal WITHOUT setting ptyId
      const tabsStore = useTabsStore()
      tabsStore.addTerminal('dev-front-vuejs', 'Ubuntu-24.04')

      // Task transitions to done
      tasks.value = [makeTask({ id: 1, statut: 'done', agent_assigne_id: 10 })]
      await nextTick()

      // Advance past 80ms debounce + immediate 0ms poll, flush promises
      await vi.advanceTimersByTimeAsync(81)

      // Tab should be closed directly (no terminalWrite/Kill since no ptyId)
      expect(api.terminalWrite).not.toHaveBeenCalled()
      expect(api.terminalKill).not.toHaveBeenCalled()
      expect(tabsStore.tabs.filter(t => t.type === 'terminal')).toHaveLength(0)
    })

    it('should cancel previous timer when scheduleClose called twice for same agent', async () => {
      useAutoLaunch({ tasks, agents, dbPath })

      // Seed with in_progress task
      tasks.value = [makeTask({ id: 1, statut: 'in_progress', agent_assigne_id: 10 })]
      await nextTick()

      const tabsStore = useTabsStore()
      tabsStore.addTerminal('dev-front-vuejs', 'Ubuntu-24.04')
      const termTab = tabsStore.tabs.find(t => t.type === 'terminal')!
      termTab.ptyId = 'pty-456'

      // First done transition
      tasks.value = [makeTask({ id: 1, statut: 'done', agent_assigne_id: 10 })]
      await nextTick()

      // Advance 3s — immediate poll fires (0ms) + resolves: terminé found → doClose called
      await vi.advanceTimersByTimeAsync(3000)

      // Second done transition (same agent — pendingClose already cleared by doClose)
      tasks.value = [
        makeTask({ id: 1, statut: 'done', agent_assigne_id: 10 }),
        makeTask({ id: 2, statut: 'done', agent_assigne_id: 10 }),
      ]
      await nextTick()

      // Advance to fire any new immediate poll
      await vi.advanceTimersByTimeAsync(5000)

      // The key assertion: terminalWrite should have been called at most once
      // (first doClose found the terminal; subsequent polls find no terminal)
      expect(api.terminalWrite).toHaveBeenCalledTimes(1)
    })
  })
})
