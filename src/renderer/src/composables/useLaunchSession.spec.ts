import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useLaunchSession, MAX_AGENT_SESSIONS } from './useLaunchSession'
import { useTabsStore, type Tab } from '@renderer/stores/tabs'
import { useTasksStore } from '@renderer/stores/tasks'
import { useSettingsStore } from '@renderer/stores/settings'
import type { Task, Agent } from '@renderer/types'

// Mock window.electronAPI
const api = {
  getCliInstances: vi.fn().mockResolvedValue([
    { cli: 'claude', distro: 'Ubuntu-24.04', version: '2.1.58', isDefault: true, type: 'wsl' }
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
    id: 1, title: 'Test task', description: null, status: 'todo',
    agent_assigned_id: 10, agent_creator_id: 1, agent_validator_id: null,
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
    api.getCliInstances.mockResolvedValue([
      { cli: 'claude', distro: 'Ubuntu-24.04', version: '2.1.58', isDefault: true, type: 'wsl' }
    ])
    api.getAgentSystemPrompt.mockResolvedValue({
      success: true, systemPrompt: 'You are dev-front', systemPromptSuffix: null, thinkingMode: 'auto'
    })
    api.buildAgentPrompt.mockResolvedValue('final prompt')

    // Set system time far enough apart between tests to expire the module-level
    // getCachedCliInstances cache (TTL = 5min)
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

    it('should return error when getCliInstances rejects', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      api.getCliInstances.mockRejectedValueOnce(new Error('IPC error'))

      const { launchAgentTerminal } = useLaunchSession()
      const result = await launchAgentTerminal(makeAgent(), makeTask())

      expect(result).toBe('error')
      const tabsStore = useTabsStore()
      expect(tabsStore.tabs.filter(t => t.type === 'terminal')).toHaveLength(0)
      vi.mocked(console.warn).mockRestore()
    })

    it('should launch with no distro when getCliInstances returns empty array', async () => {
      api.getCliInstances.mockResolvedValueOnce([])

      const { launchAgentTerminal } = useLaunchSession()
      const result = await launchAgentTerminal(makeAgent(), makeTask())

      expect(result).toBe('ok')
      const tabsStore = useTabsStore()
      const terminal = tabsStore.tabs.find(t => t.type === 'terminal')
      expect(terminal?.wslDistro).toBeNull()
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

    it('should use stored defaultCliInstance from settings (T879)', async () => {
      api.getCliInstances.mockResolvedValueOnce([
        { cli: 'claude', distro: 'Ubuntu-24.04', version: '2.1.58', isDefault: true, type: 'wsl' },
        { cli: 'claude', distro: 'Debian', version: '2.1.58', isDefault: false, type: 'wsl' },
      ])
      const settingsStore = useSettingsStore()
      settingsStore.setDefaultCliInstance('Debian')

      const { launchAgentTerminal } = useLaunchSession()
      await launchAgentTerminal(makeAgent(), makeTask())

      const tabsStore = useTabsStore()
      const terminal = tabsStore.tabs.find(t => t.type === 'terminal') as Tab | undefined
      expect(terminal?.wslDistro).toBe('Debian')
    })

    it('should fallback to isDefault instance when stored distro not found (T879)', async () => {
      api.getCliInstances.mockResolvedValueOnce([
        { cli: 'claude', distro: 'Ubuntu-24.04', version: '2.1.58', isDefault: true, type: 'wsl' },
      ])
      const settingsStore = useSettingsStore()
      settingsStore.setDefaultCliInstance('NonExistent')

      const { launchAgentTerminal } = useLaunchSession()
      await launchAgentTerminal(makeAgent(), makeTask())

      const tabsStore = useTabsStore()
      const terminal = tabsStore.tabs.find(t => t.type === 'terminal') as Tab | undefined
      expect(terminal?.wslDistro).toBe('Ubuntu-24.04')
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
      const doneTasks = [makeTask({ id: 1, status: 'done' })]

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
      const result = await launchReviewSession(reviewAgent, [makeTask({ status: 'done' })])

      expect(result).toBe(false)
    })

    it('should return false when getCliInstances rejects', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      api.getCliInstances.mockRejectedValueOnce(new Error('review IPC error'))

      const reviewAgent = makeAgent({ id: 99, name: 'review-master', type: 'review' })
      const { launchReviewSession } = useLaunchSession()
      const result = await launchReviewSession(reviewAgent, [makeTask({ status: 'done' })])

      expect(result).toBe(false)
      const tabsStore = useTabsStore()
      expect(tabsStore.tabs.some(t => t.agentName === 'review-master')).toBe(false)
      vi.mocked(console.warn).mockRestore()
    })

    it('should launch with no distro when getCliInstances returns empty array', async () => {
      api.getCliInstances.mockResolvedValueOnce([])

      const reviewAgent = makeAgent({ id: 99, name: 'review-master', type: 'review' })
      const { launchReviewSession } = useLaunchSession()
      const result = await launchReviewSession(reviewAgent, [makeTask({ status: 'done' })])

      expect(result).toBe(true)
    })

    it('should return false when dbPath is null', async () => {
      const tasksStore = useTasksStore()
      ;(tasksStore as unknown as { dbPath: string | null }).dbPath = null

      const reviewAgent = makeAgent({ id: 99, name: 'review-master', type: 'review' })
      const { launchReviewSession } = useLaunchSession()
      const result = await launchReviewSession(reviewAgent, [makeTask({ status: 'done' })])

      expect(result).toBe(false)
    })
  })

  describe('getCachedCliInstances — TTL cache', () => {
    it('should use cache on second call within TTL (no second IPC call)', async () => {
      const { launchAgentTerminal } = useLaunchSession()
      // First call: cache miss → IPC called
      await launchAgentTerminal(makeAgent(), makeTask())
      // Advance time by 4 minutes (still within 5min TTL)
      vi.advanceTimersByTime(4 * 60 * 1000)
      // Second call: cache hit → IPC should NOT be called again
      await launchAgentTerminal(makeAgent(), makeTask())

      expect(api.getCliInstances).toHaveBeenCalledTimes(1)
    })

    it('should call IPC again after TTL expires (> 5 minutes)', async () => {
      const { launchAgentTerminal } = useLaunchSession()
      // First call: populates cache
      await launchAgentTerminal(makeAgent(), makeTask())
      // Advance time past TTL (5min + 1ms)
      vi.advanceTimersByTime(5 * 60 * 1000 + 1)
      // Second call: cache expired → IPC called again
      await launchAgentTerminal(makeAgent(), makeTask())

      expect(api.getCliInstances).toHaveBeenCalledTimes(2)
    })

    it('should not cache when getCliInstances returns empty array', async () => {
      // Advance far past TTL to ensure prior test's cache is expired
      vi.advanceTimersByTime(10 * 60 * 1000)

      api.getCliInstances.mockResolvedValue([])
      const { launchAgentTerminal } = useLaunchSession()

      // First call with empty result: should NOT populate cache
      await launchAgentTerminal(makeAgent(), makeTask())
      // Advance by 1 min (well within TTL)
      vi.advanceTimersByTime(60 * 1000)
      // Second call: since empty was not cached, IPC called again
      await launchAgentTerminal(makeAgent(), makeTask())

      expect(api.getCliInstances).toHaveBeenCalledTimes(2)
    })
  })

  describe('prompt construction', () => {
    it('should include systemPromptSuffix in fullSystemPrompt when present', async () => {
      api.getAgentSystemPrompt.mockResolvedValueOnce({
        success: true,
        systemPrompt: 'Base prompt',
        systemPromptSuffix: 'Suffix prompt',
        thinkingMode: 'auto'
      })

      const { launchAgentTerminal } = useLaunchSession()
      await launchAgentTerminal(makeAgent(), makeTask())

      const tabsStore = useTabsStore()
      const terminal = tabsStore.tabs.find(t => t.type === 'terminal')
      expect(terminal?.systemPrompt).toBe('Base prompt\n\nSuffix prompt')
    })

    it('should add maxFileLines line to prompt when maxFileLinesEnabled', async () => {
      const settingsStore = useSettingsStore()
      settingsStore.setMaxFileLinesEnabled(true)
      settingsStore.setMaxFileLinesCount(300)

      api.getAgentSystemPrompt.mockResolvedValueOnce({
        success: true,
        systemPrompt: 'Base prompt',
        systemPromptSuffix: null,
        thinkingMode: 'auto'
      })

      const { launchAgentTerminal } = useLaunchSession()
      await launchAgentTerminal(makeAgent(), makeTask())

      const tabsStore = useTabsStore()
      const terminal = tabsStore.tabs.find(t => t.type === 'terminal')
      expect(terminal?.systemPrompt).toContain('maximum 300 lines')
    })

    it('should produce null systemPrompt when no parts (empty parts → undefined → null in tab)', async () => {
      api.getAgentSystemPrompt.mockResolvedValueOnce({
        success: true,
        systemPrompt: null,
        systemPromptSuffix: null,
        thinkingMode: 'auto'
      })

      const { launchAgentTerminal } = useLaunchSession()
      await launchAgentTerminal(makeAgent(), makeTask())

      const tabsStore = useTabsStore()
      const terminal = tabsStore.tabs.find(t => t.type === 'terminal')
      // parts.join('\n\n') || undefined → undefined → addTerminal stores null
      expect(terminal?.systemPrompt).toBeNull()
    })

    it('should join parts with double newline separator', async () => {
      api.getAgentSystemPrompt.mockResolvedValueOnce({
        success: true,
        systemPrompt: 'Part one',
        systemPromptSuffix: 'Part two',
        thinkingMode: 'auto'
      })

      const { launchAgentTerminal } = useLaunchSession()
      await launchAgentTerminal(makeAgent(), makeTask())

      const tabsStore = useTabsStore()
      const terminal = tabsStore.tabs.find(t => t.type === 'terminal')
      expect(terminal?.systemPrompt).toBe('Part one\n\nPart two')
    })
  })

  describe('session limit — MAX_AGENT_SESSIONS fallback', () => {
    it('should use MAX_AGENT_SESSIONS when agent.max_sessions is null', async () => {
      const tabsStore = useTabsStore()
      // Fill up MAX_AGENT_SESSIONS terminals
      for (let i = 0; i < MAX_AGENT_SESSIONS; i++) {
        tabsStore.addTerminal('dev-front-vuejs', 'Ubuntu-24.04')
      }

      const { launchAgentTerminal } = useLaunchSession()
      const result = await launchAgentTerminal(
        makeAgent({ max_sessions: null as unknown as number }),
        makeTask()
      )

      expect(result).toBe('session-limit')
    })

    it('should allow launch when count is below MAX_AGENT_SESSIONS with null max_sessions', async () => {
      const tabsStore = useTabsStore()
      // Add one less than MAX
      for (let i = 0; i < MAX_AGENT_SESSIONS - 1; i++) {
        tabsStore.addTerminal('dev-front-vuejs', 'Ubuntu-24.04')
      }

      const { launchAgentTerminal } = useLaunchSession()
      const result = await launchAgentTerminal(
        makeAgent({ max_sessions: null as unknown as number }),
        makeTask()
      )

      expect(result).toBe('ok')
    })
  })

  describe('WSL instance selection', () => {
    it('should use first instance when storedDistro not set and no isDefault', async () => {
      api.getCliInstances.mockResolvedValueOnce([
        { cli: 'claude', distro: 'Arch', version: '2.1.58', isDefault: false, type: 'wsl' },
        { cli: 'claude', distro: 'Debian', version: '2.1.58', isDefault: false, type: 'wsl' },
      ])

      const { launchAgentTerminal } = useLaunchSession()
      await launchAgentTerminal(makeAgent(), makeTask())

      const tabsStore = useTabsStore()
      const terminal = tabsStore.tabs.find(t => t.type === 'terminal')
      expect(terminal?.wslDistro).toBe('Arch')
    })

    it('should prefer storedDistro over isDefault when storedDistro is present', async () => {
      api.getCliInstances.mockResolvedValueOnce([
        { cli: 'claude', distro: 'Ubuntu-24.04', version: '2.1.58', isDefault: true, type: 'wsl' },
        { cli: 'claude', distro: 'Debian', version: '2.1.58', isDefault: false, type: 'wsl' },
      ])
      const settingsStore = useSettingsStore()
      settingsStore.setDefaultCliInstance('Debian')

      const { launchAgentTerminal } = useLaunchSession()
      await launchAgentTerminal(makeAgent(), makeTask())

      const tabsStore = useTabsStore()
      const terminal = tabsStore.tabs.find(t => t.type === 'terminal')
      expect(terminal?.wslDistro).toBe('Debian')
    })

    it('should fallback to isDefault when storedDistro is unknown', async () => {
      api.getCliInstances.mockResolvedValueOnce([
        { cli: 'claude', distro: 'Arch', version: '2.1.58', isDefault: false, type: 'wsl' },
        { cli: 'claude', distro: 'Ubuntu-24.04', version: '2.1.58', isDefault: true, type: 'wsl' },
      ])
      const settingsStore = useSettingsStore()
      settingsStore.setDefaultCliInstance('NonExistentDistro')

      const { launchAgentTerminal } = useLaunchSession()
      await launchAgentTerminal(makeAgent(), makeTask())

      const tabsStore = useTabsStore()
      const terminal = tabsStore.tabs.find(t => t.type === 'terminal')
      expect(terminal?.wslDistro).toBe('Ubuntu-24.04')
    })

    it('should use null distro when no CLI instances available', async () => {
      api.getCliInstances.mockResolvedValueOnce([])

      const { launchAgentTerminal } = useLaunchSession()
      await launchAgentTerminal(makeAgent(), makeTask())

      const tabsStore = useTabsStore()
      const terminal = tabsStore.tabs.find(t => t.type === 'terminal')
      expect(terminal?.wslDistro).toBeNull()
    })
  })

  describe('autoSend / prompt content', () => {
    it('should store final prompt as autoSend on the terminal tab', async () => {
      api.buildAgentPrompt.mockResolvedValueOnce('T42 prompt content')
      const { launchAgentTerminal } = useLaunchSession()
      await launchAgentTerminal(makeAgent(), makeTask({ id: 42 }))

      const tabsStore = useTabsStore()
      const terminal = tabsStore.tabs.find(t => t.type === 'terminal')
      // autoSend param receives the finalPrompt string (built from buildAgentPrompt)
      expect(terminal?.autoSend).toBe('T42 prompt content')
    })

    it('review session: autoSend contains task list prompt', async () => {
      api.buildAgentPrompt.mockResolvedValueOnce('Audit prompt for review')
      const reviewAgent = makeAgent({ id: 99, name: 'review-master', type: 'review' })

      const { launchReviewSession } = useLaunchSession()
      await launchReviewSession(reviewAgent, [makeTask({ id: 5, status: 'done', title: 'My task' })])

      const tabsStore = useTabsStore()
      const terminal = tabsStore.tabs.find(t => t.agentName === 'review-master')
      expect(terminal?.autoSend).toBe('Audit prompt for review')
    })

    it('review session: buildAgentPrompt receives task list string', async () => {
      const reviewAgent = makeAgent({ id: 99, name: 'review-master', type: 'review' })
      const tasks = [
        makeTask({ id: 5, title: 'First task', status: 'done' }),
        makeTask({ id: 6, title: 'Second task', status: 'done' }),
      ]

      const { launchReviewSession } = useLaunchSession()
      await launchReviewSession(reviewAgent, tasks)

      expect(api.buildAgentPrompt).toHaveBeenCalledWith(
        'review-master',
        expect.stringContaining('T5'),
        '/test/db',
        99
      )
      expect(api.buildAgentPrompt).toHaveBeenCalledWith(
        'review-master',
        expect.stringContaining('T6'),
        '/test/db',
        99
      )
    })
  })
})
