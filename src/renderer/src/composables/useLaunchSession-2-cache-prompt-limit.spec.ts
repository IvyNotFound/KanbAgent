import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useLaunchSession, MAX_AGENT_SESSIONS } from './useLaunchSession'
import { useTabsStore } from '@renderer/stores/tabs'
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
      const settingsStore = useSettingsStore()
      settingsStore.setMaxFileLinesEnabled(false)
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
      const settingsStore = useSettingsStore()
      settingsStore.setMaxFileLinesEnabled(false)
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
      const settingsStore = useSettingsStore()
      settingsStore.setMaxFileLinesEnabled(false)
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
})
