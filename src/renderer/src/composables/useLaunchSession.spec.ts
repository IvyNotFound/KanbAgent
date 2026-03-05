import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useLaunchSession } from './useLaunchSession'
import { useTabsStore } from '@renderer/stores/tabs'
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
  queryDb: vi.fn().mockResolvedValue([]),
  watchDb: vi.fn().mockResolvedValue(undefined),
  unwatchDb: vi.fn().mockResolvedValue(undefined),
  onDbChanged: vi.fn().mockReturnValue(() => {}),
  selectProjectDir: vi.fn().mockResolvedValue(null),
  showConfirmDialog: vi.fn().mockResolvedValue(true),
  migrateDb: vi.fn().mockResolvedValue({ success: true }),
  findProjectDb: vi.fn().mockResolvedValue(null),
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
    allowed_tools: null, created_at: '', auto_launch: 1, permission_mode: null, max_sessions: 3,
    ...overrides
  } as Agent
}

describe('composables/useLaunchSession', () => {
  // Counter to ensure each test gets a unique time far enough apart to expire the cache
  let testIndex = 0

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()

    // Reset mock implementations
    api.getClaudeInstances.mockResolvedValue([
      { distro: 'Ubuntu-24.04', version: '2.1.58', isDefault: true, profiles: ['claude'] }
    ])
    api.getAgentSystemPrompt.mockResolvedValue({
      success: true, systemPrompt: 'You are dev-front', systemPromptSuffix: null, thinkingMode: 'auto'
    })
    api.buildAgentPrompt.mockResolvedValue('final prompt')

    // Set system time far enough apart between tests to expire the module-level
    // getCachedClaudeInstances cache (TTL = 5min)
    testIndex++
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 0, 1, 0, testIndex * 10, 0))

    // Set dbPath on tasks store so useLaunchSession can access it
    const tasksStore = useTasksStore()
    ;(tasksStore as unknown as { dbPath: string | null }).dbPath = '/test/db'
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('launchAgentTerminal', () => {
    it('should return ok and add terminal on success', async () => {
      const { launchAgentTerminal } = useLaunchSession()
      const result = await launchAgentTerminal(makeAgent(), makeTask())

      expect(result).toBe('ok')
      const tabsStore = useTabsStore()
      expect(tabsStore.tabs.some(t => t.type === 'terminal' && t.agentName === 'dev-front-vuejs')).toBe(true)
    })

    it('should call buildAgentPrompt with only the task ID (no duplicated prefix)', async () => {
      const task = makeTask({ id: 42, statut: 'todo' })
      const agent = makeAgent({ name: 'dev-front-vuejs' })

      const { launchAgentTerminal } = useLaunchSession()
      await launchAgentTerminal(agent, task)

      expect(api.buildAgentPrompt).toHaveBeenCalledWith('dev-front-vuejs', 'T42', '/test/db', 10)
    })

    it('should return error when dbPath is null', async () => {
      const tasksStore = useTasksStore()
      ;(tasksStore as unknown as { dbPath: string | null }).dbPath = null

      const { launchAgentTerminal } = useLaunchSession()
      const result = await launchAgentTerminal(makeAgent(), makeTask())

      expect(result).toBe('error')
    })

    it('should return error when getClaudeInstances rejects', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      api.getClaudeInstances.mockRejectedValueOnce(new Error('IPC error'))

      const { launchAgentTerminal } = useLaunchSession()
      const result = await launchAgentTerminal(makeAgent(), makeTask())

      expect(result).toBe('error')
      const tabsStore = useTabsStore()
      expect(tabsStore.tabs.filter(t => t.type === 'terminal')).toHaveLength(0)
      vi.mocked(console.warn).mockRestore()
    })

    it('should return error when getClaudeInstances returns empty array', async () => {
      api.getClaudeInstances.mockResolvedValueOnce([])

      const { launchAgentTerminal } = useLaunchSession()
      const result = await launchAgentTerminal(makeAgent(), makeTask())

      expect(result).toBe('error')
      const tabsStore = useTabsStore()
      expect(tabsStore.tabs.filter(t => t.type === 'terminal')).toHaveLength(0)
    })

    it('should return error when getAgentSystemPrompt fails', async () => {
      api.getAgentSystemPrompt.mockResolvedValueOnce({ success: false })

      const { launchAgentTerminal } = useLaunchSession()
      const result = await launchAgentTerminal(makeAgent(), makeTask())

      expect(result).toBe('error')
      const tabsStore = useTabsStore()
      expect(tabsStore.tabs.filter(t => t.type === 'terminal')).toHaveLength(0)
    })

    it('should return session-limit when MAX_AGENT_SESSIONS reached', async () => {
      const tabsStore = useTabsStore()
      // Add 3 terminals for same agent (MAX_AGENT_SESSIONS = 3)
      tabsStore.addTerminal('dev-front-vuejs', 'Ubuntu-24.04')
      tabsStore.addTerminal('dev-front-vuejs', 'Ubuntu-24.04')
      tabsStore.addTerminal('dev-front-vuejs', 'Ubuntu-24.04')

      const { launchAgentTerminal } = useLaunchSession()
      const result = await launchAgentTerminal(makeAgent(), makeTask())

      expect(result).toBe('session-limit')
    })
  })

  describe('canLaunchSession', () => {
    it('should return true when agent has no terminals', () => {
      const { canLaunchSession } = useLaunchSession()
      expect(canLaunchSession(makeAgent())).toBe(true)
    })

    it('should return true when agent has fewer than max_sessions terminals', () => {
      const tabsStore = useTabsStore()
      tabsStore.addTerminal('dev-front-vuejs', 'Ubuntu-24.04')
      tabsStore.addTerminal('dev-front-vuejs', 'Ubuntu-24.04')

      const { canLaunchSession } = useLaunchSession()
      expect(canLaunchSession(makeAgent())).toBe(true)
    })

    it('should return false when agent has reached max_sessions terminals', () => {
      const tabsStore = useTabsStore()
      tabsStore.addTerminal('dev-front-vuejs', 'Ubuntu-24.04')
      tabsStore.addTerminal('dev-front-vuejs', 'Ubuntu-24.04')
      tabsStore.addTerminal('dev-front-vuejs', 'Ubuntu-24.04')

      const { canLaunchSession } = useLaunchSession()
      expect(canLaunchSession(makeAgent())).toBe(false)
    })

    it('should return true when agent has max_sessions = -1 (unlimited)', () => {
      const tabsStore = useTabsStore()
      for (let i = 0; i < 10; i++) tabsStore.addTerminal('dev-front-vuejs', 'Ubuntu-24.04')

      const { canLaunchSession } = useLaunchSession()
      expect(canLaunchSession(makeAgent({ max_sessions: -1 }))).toBe(true)
    })

    it('should respect custom max_sessions value', () => {
      const tabsStore = useTabsStore()
      tabsStore.addTerminal('dev-front-vuejs', 'Ubuntu-24.04')
      tabsStore.addTerminal('dev-front-vuejs', 'Ubuntu-24.04')

      const { canLaunchSession } = useLaunchSession()
      expect(canLaunchSession(makeAgent({ max_sessions: 2 }))).toBe(false)
    })

    it('should not affect other agents', () => {
      const tabsStore = useTabsStore()
      tabsStore.addTerminal('dev-front-vuejs', 'Ubuntu-24.04')
      tabsStore.addTerminal('dev-front-vuejs', 'Ubuntu-24.04')
      tabsStore.addTerminal('dev-front-vuejs', 'Ubuntu-24.04')

      const { canLaunchSession } = useLaunchSession()
      expect(canLaunchSession(makeAgent({ name: 'other-agent' }))).toBe(true)
    })
  })

  describe('launchReviewSession', () => {
    it('should return true and add terminal on success', async () => {
      const reviewAgent = makeAgent({ id: 99, name: 'review-master', type: 'review' })
      const doneTasks = [makeTask({ id: 1, statut: 'done' })]

      const { launchReviewSession } = useLaunchSession()
      const result = await launchReviewSession(reviewAgent, doneTasks)

      expect(result).toBe(true)
      const tabsStore = useTabsStore()
      expect(tabsStore.tabs.some(t => t.agentName === 'review-master')).toBe(true)
    })

    it('should return false when agent terminal already exists', async () => {
      const tabsStore = useTabsStore()
      tabsStore.addTerminal('review-master', 'Ubuntu-24.04')

      const reviewAgent = makeAgent({ id: 99, name: 'review-master', type: 'review' })
      const { launchReviewSession } = useLaunchSession()
      const result = await launchReviewSession(reviewAgent, [makeTask({ statut: 'done' })])

      expect(result).toBe(false)
    })

    it('should return false when getClaudeInstances rejects', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      api.getClaudeInstances.mockRejectedValueOnce(new Error('review IPC error'))

      const reviewAgent = makeAgent({ id: 99, name: 'review-master', type: 'review' })
      const { launchReviewSession } = useLaunchSession()
      const result = await launchReviewSession(reviewAgent, [makeTask({ statut: 'done' })])

      expect(result).toBe(false)
      const tabsStore = useTabsStore()
      expect(tabsStore.tabs.some(t => t.agentName === 'review-master')).toBe(false)
      vi.mocked(console.warn).mockRestore()
    })

    it('should return false when getClaudeInstances returns empty array', async () => {
      api.getClaudeInstances.mockResolvedValueOnce([])

      const reviewAgent = makeAgent({ id: 99, name: 'review-master', type: 'review' })
      const { launchReviewSession } = useLaunchSession()
      const result = await launchReviewSession(reviewAgent, [makeTask({ statut: 'done' })])

      expect(result).toBe(false)
    })

    it('should return false when dbPath is null', async () => {
      const tasksStore = useTasksStore()
      ;(tasksStore as unknown as { dbPath: string | null }).dbPath = null

      const reviewAgent = makeAgent({ id: 99, name: 'review-master', type: 'review' })
      const { launchReviewSession } = useLaunchSession()
      const result = await launchReviewSession(reviewAgent, [makeTask({ statut: 'done' })])

      expect(result).toBe(false)
    })
  })
})
