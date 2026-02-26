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

  it('should schedule close when task transitions to done', async () => {
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

    // Terminal should still exist (grace period not yet elapsed)
    expect(tabsStore.tabs.filter(t => t.type === 'terminal')).toHaveLength(1)

    // Advance past grace period (5s)
    vi.advanceTimersByTime(5000)

    // Ctrl+C should have been sent
    expect(api.terminalWrite).toHaveBeenCalledWith('pty-123', '\x03')

    // Advance past kill delay (2s)
    vi.advanceTimersByTime(2000)

    expect(api.terminalKill).toHaveBeenCalledWith('pty-123')
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

      // Advance past grace period — no close should happen
      vi.advanceTimersByTime(5000)
      vi.advanceTimersByTime(2000)

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

      // Advance past grace period
      vi.advanceTimersByTime(5000)

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

      // Advance 3s (not yet at 5s grace period)
      vi.advanceTimersByTime(3000)

      // Second done transition
      tasks.value = [
        makeTask({ id: 1, statut: 'done', agent_assigne_id: 10 }),
        makeTask({ id: 2, statut: 'done', agent_assigne_id: 10 }),
      ]
      await nextTick()

      // Advance remaining 5s from the second trigger
      vi.advanceTimersByTime(5000)

      // The key assertion: terminalWrite should have been called at most once
      expect(api.terminalWrite).toHaveBeenCalledTimes(1)
    })
  })
})
