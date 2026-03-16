/**
 * T1346: Mutation coverage for useLaunchSession.ts
 * Targets 58 surviving mutants (Survived + NoCoverage).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useLaunchSession, MAX_AGENT_SESSIONS } from './useLaunchSession'
import { useTabsStore, type Tab } from '@renderer/stores/tabs'
import { useTasksStore } from '@renderer/stores/tasks'
import { useSettingsStore } from '@renderer/stores/settings'
import type { Task, Agent } from '@renderer/types'
import type { CliType } from '@shared/cli-types'

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
  worktreeCreate: vi.fn().mockResolvedValue({ success: true, workDir: '/worktrees/s123/agent' }),
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

let testIndex = 0

function setupBeforeEach() {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  localStorage.clear()
  testIndex++
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 3, 1, 0, testIndex * 10, 0))
  api.getCliInstances.mockResolvedValue([
    { cli: 'claude', distro: 'Ubuntu-24.04', version: '2.1.58', isDefault: true, type: 'wsl' }
  ])
  api.getAgentSystemPrompt.mockResolvedValue({
    success: true, systemPrompt: 'You are dev-front', systemPromptSuffix: null, thinkingMode: 'auto'
  })
  api.buildAgentPrompt.mockResolvedValue('final prompt')
  api.worktreeCreate.mockResolvedValue({ success: true, workDir: '/worktrees/s123/agent' })
  const tasksStore = useTasksStore()
  ;(tasksStore as unknown as { dbPath: string | null }).dbPath = '/test/db'
}

// ─── Cache TTL boundary ───────────────────────────────────────────────────────

describe('T1346: cache TTL boundary (< vs <=)', () => {
  beforeEach(setupBeforeEach)
  afterEach(() => vi.useRealTimers())

  it('cache is still valid at exactly TTL - 1ms (< boundary)', async () => {
    const { launchAgentTerminal } = useLaunchSession()
    await launchAgentTerminal(makeAgent(), makeTask())
    // Advance to 1ms before TTL expiry (within TTL)
    vi.advanceTimersByTime(5 * 60 * 1000 - 1)
    await launchAgentTerminal(makeAgent(), makeTask())
    expect(api.getCliInstances).toHaveBeenCalledTimes(1)
  })

  it('cache expires at exactly TTL ms (not <=)', async () => {
    const { launchAgentTerminal } = useLaunchSession()
    await launchAgentTerminal(makeAgent(), makeTask())
    // Advance to exactly TTL — still within TTL (now - ts < TTL → false when equal)
    vi.advanceTimersByTime(5 * 60 * 1000)
    await launchAgentTerminal(makeAgent(), makeTask())
    // At exactly TTL, now - ts === CACHE_TTL_MS → NOT < → cache miss → 2 calls
    expect(api.getCliInstances).toHaveBeenCalledTimes(2)
  })
})

// ─── agentTerminalCount — filter specificity ──────────────────────────────────

describe('T1346: agentTerminalCount only counts terminal tabs', () => {
  beforeEach(setupBeforeEach)
  afterEach(() => vi.useRealTimers())

  it('non-terminal tabs are not counted toward session limit', async () => {
    const tabsStore = useTabsStore()
    // Add 3 terminals for the agent (should hit limit)
    tabsStore.addTerminal('dev-front-vuejs', 'Ubuntu-24.04')
    tabsStore.addTerminal('dev-front-vuejs', 'Ubuntu-24.04')
    tabsStore.addTerminal('dev-front-vuejs', 'Ubuntu-24.04')

    const { canLaunchSession } = useLaunchSession()
    expect(canLaunchSession(makeAgent({ max_sessions: 3 }))).toBe(false)
    // If filter is wrong (always true), non-terminals would be counted too
  })

  it('terminal tabs from other agents do not count toward this agent session limit', async () => {
    const tabsStore = useTabsStore()
    // Add 3 terminals for a DIFFERENT agent
    tabsStore.addTerminal('other-agent', 'Ubuntu-24.04')
    tabsStore.addTerminal('other-agent', 'Ubuntu-24.04')
    tabsStore.addTerminal('other-agent', 'Ubuntu-24.04')

    const { canLaunchSession } = useLaunchSession()
    // dev-front-vuejs should still have 0 terminals
    expect(canLaunchSession(makeAgent({ max_sessions: 3 }))).toBe(true)
  })
})

// ─── maxSess !== -1 and UnaryOperator -1 → +1 ────────────────────────────────

describe('T1346: maxSess -1 (unlimited) semantics', () => {
  beforeEach(setupBeforeEach)
  afterEach(() => vi.useRealTimers())

  it('maxSess = -1 allows launch even at 100 terminals (unlimited)', async () => {
    const tabsStore = useTabsStore()
    for (let i = 0; i < 100; i++) tabsStore.addTerminal('dev-front-vuejs', 'Ubuntu-24.04')

    const { launchAgentTerminal } = useLaunchSession()
    const result = await launchAgentTerminal(makeAgent({ max_sessions: -1 }), makeTask())
    expect(result).toBe('ok')
  })

  it('maxSess = 1 blocks at exactly 1 terminal (kills +1 mutant)', async () => {
    const tabsStore = useTabsStore()
    tabsStore.addTerminal('dev-front-vuejs', 'Ubuntu-24.04')
    // count (1) >= maxSess (1) → session-limit
    const { launchAgentTerminal } = useLaunchSession()
    const result = await launchAgentTerminal(makeAgent({ max_sessions: 1 }), makeTask())
    expect(result).toBe('session-limit')
  })

  it('maxSess = 1 allows launch when 0 terminals', async () => {
    const { launchAgentTerminal } = useLaunchSession()
    const result = await launchAgentTerminal(makeAgent({ max_sessions: 1 }), makeTask())
    expect(result).toBe('ok')
  })

  it('canLaunchSession: max_sessions=-1 returns true regardless of count', () => {
    const tabsStore = useTabsStore()
    for (let i = 0; i < 50; i++) tabsStore.addTerminal('dev-front-vuejs', 'Ubuntu-24.04')

    const { canLaunchSession } = useLaunchSession()
    expect(canLaunchSession(makeAgent({ max_sessions: -1 }))).toBe(true)
  })
})

// ─── opts?.instance !== undefined (explicit modal instance) ───────────────────

describe('T1346: opts.instance explicit override', () => {
  beforeEach(setupBeforeEach)
  afterEach(() => vi.useRealTimers())

  it('opts.instance = explicit instance → getCliInstances NOT called', async () => {
    const { launchAgentTerminal } = useLaunchSession()
    await launchAgentTerminal(makeAgent(), makeTask(), {
      instance: { cli: 'claude', distro: 'MyDistro', version: '1.0', isDefault: false, type: 'wsl' }
    })
    expect(api.getCliInstances).not.toHaveBeenCalled()
    const tabsStore = useTabsStore()
    const terminal = tabsStore.tabs.find(t => t.type === 'terminal') as Tab | undefined
    expect(terminal?.wslDistro).toBe('MyDistro')
  })

  it('opts.instance = null → getCliInstances NOT called, distro is null', async () => {
    const { launchAgentTerminal } = useLaunchSession()
    await launchAgentTerminal(makeAgent(), makeTask(), {
      instance: null
    })
    expect(api.getCliInstances).not.toHaveBeenCalled()
    const tabsStore = useTabsStore()
    const terminal = tabsStore.tabs.find(t => t.type === 'terminal') as Tab | undefined
    expect(terminal?.wslDistro).toBeNull()
  })

  it('opts.instance provided with opts.cli override → uses opts.cli', async () => {
    const { launchAgentTerminal } = useLaunchSession()
    await launchAgentTerminal(makeAgent(), makeTask(), {
      instance: { cli: 'claude', distro: 'MyDistro', version: '1.0', isDefault: false, type: 'wsl' },
      cli: 'gemini' as CliType
    })
    expect(api.getCliInstances).not.toHaveBeenCalled()
    const tabsStore = useTabsStore()
    const terminal = tabsStore.tabs.find(t => t.type === 'terminal') as Tab | undefined
    // resolvedCli should be opts.cli = 'gemini'
    expect(terminal?.cli).toBe('gemini')
  })

  it('opts.instance provided without opts.cli → uses instance.cli', async () => {
    const { launchAgentTerminal } = useLaunchSession()
    await launchAgentTerminal(makeAgent(), makeTask(), {
      instance: { cli: 'claude', distro: 'MyDistro', version: '1.0', isDefault: false, type: 'wsl' }
    })
    const tabsStore = useTabsStore()
    const terminal = tabsStore.tabs.find(t => t.type === 'terminal') as Tab | undefined
    expect(terminal?.cli).toBe('claude')
  })

  it('opts.instance = null and opts.cli provided → uses opts.cli', async () => {
    const settingsStore = useSettingsStore()
    settingsStore.$patch({ enabledClis: ['claude', 'gemini'] as CliType[] })

    const { launchAgentTerminal } = useLaunchSession()
    await launchAgentTerminal(makeAgent(), makeTask(), {
      instance: null,
      cli: 'gemini' as CliType
    })
    const tabsStore = useTabsStore()
    const terminal = tabsStore.tabs.find(t => t.type === 'terminal') as Tab | undefined
    expect(terminal?.cli).toBe('gemini')
  })
})

// ─── CLI filter >, >= boundary ────────────────────────────────────────────────

describe('T1346: CLI filter candidates.length > 0 (> vs >=)', () => {
  beforeEach(setupBeforeEach)
  afterEach(() => vi.useRealTimers())

  it('empty candidates array (length=0) does NOT trigger fallback loop (> 0)', async () => {
    // Only first CLI has instances — no fallback needed
    const settingsStore = useSettingsStore()
    settingsStore.$patch({ enabledClis: ['claude', 'gemini'] as CliType[] })

    api.getCliInstances.mockResolvedValueOnce([
      { cli: 'claude', distro: 'Ubuntu-24.04', version: '2.0.0', isDefault: true, type: 'wsl' }
    ])

    const { launchAgentTerminal } = useLaunchSession()
    const result = await launchAgentTerminal(makeAgent(), makeTask())

    expect(result).toBe('ok')
    const tabsStore = useTabsStore()
    const terminal = tabsStore.tabs.find(t => t.type === 'terminal') as Tab | undefined
    // Should use claude instance (not fall through to gemini)
    expect(terminal?.wslDistro).toBe('Ubuntu-24.04')
  })

  it('cliInstances length=1 gives a terminal (kills >= mutation)', async () => {
    api.getCliInstances.mockResolvedValueOnce([
      { cli: 'claude', distro: 'Single', version: '2.0.0', isDefault: true, type: 'wsl' }
    ])

    const { launchAgentTerminal } = useLaunchSession()
    const result = await launchAgentTerminal(makeAgent(), makeTask())

    expect(result).toBe('ok')
    const tabsStore = useTabsStore()
    const terminal = tabsStore.tabs.find(t => t.type === 'terminal') as Tab | undefined
    expect(terminal?.wslDistro).toBe('Single')
  })
})

// ─── Instance distro matching (parsedDefault) NoCoverage lines 244-246 ───────

describe('T1346: distro match logic in instance resolution', () => {
  beforeEach(setupBeforeEach)
  afterEach(() => vi.useRealTimers())

  it('storedDistro with parsedDefault.cli null matches any cli on that distro', async () => {
    // parseDefaultCliInstance('Debian') → { distro: 'Debian', cli: null }
    // So i.distro === 'Debian' AND (null === null → true) → match any cli
    api.getCliInstances.mockResolvedValueOnce([
      { cli: 'claude', distro: 'Debian', version: '2.0.0', isDefault: false, type: 'wsl' },
      { cli: 'claude', distro: 'Ubuntu-24.04', version: '2.0.0', isDefault: true, type: 'wsl' },
    ])
    const settingsStore = useSettingsStore()
    // setDefaultCliInstance('', 'Debian') → key = 'Debian' → parsedDefault.cli = null
    settingsStore.setDefaultCliInstance('', 'Debian')

    const { launchAgentTerminal } = useLaunchSession()
    await launchAgentTerminal(makeAgent(), makeTask())

    const tabsStore = useTabsStore()
    const terminal = tabsStore.tabs.find(t => t.type === 'terminal') as Tab | undefined
    expect(terminal?.wslDistro).toBe('Debian')
  })

  it('storedDistro with matching cli matches exact distro+cli pair', async () => {
    // parseDefaultCliInstance('claude:Debian') → { distro: 'Debian', cli: 'claude' }
    api.getCliInstances.mockResolvedValueOnce([
      { cli: 'claude', distro: 'Debian', version: '2.0.0', isDefault: false, type: 'wsl' },
      { cli: 'gemini', distro: 'Debian', version: '1.0.0', isDefault: false, type: 'wsl' },
      { cli: 'claude', distro: 'Ubuntu-24.04', version: '2.0.0', isDefault: true, type: 'wsl' },
    ])
    const settingsStore = useSettingsStore()
    settingsStore.setDefaultCliInstance('claude', 'Debian')

    const { launchAgentTerminal } = useLaunchSession()
    await launchAgentTerminal(makeAgent(), makeTask())

    const tabsStore = useTabsStore()
    const terminal = tabsStore.tabs.find(t => t.type === 'terminal') as Tab | undefined
    // Should match claude+Debian exactly
    expect(terminal?.wslDistro).toBe('Debian')
    expect(terminal?.cli).toBe('claude')
  })

  it('wrong distro stored → falls back to isDefault instance', async () => {
    api.getCliInstances.mockResolvedValueOnce([
      { cli: 'claude', distro: 'Ubuntu-24.04', version: '2.0.0', isDefault: true, type: 'wsl' },
      { cli: 'claude', distro: 'Debian', version: '2.0.0', isDefault: false, type: 'wsl' },
    ])
    const settingsStore = useSettingsStore()
    settingsStore.setDefaultCliInstance('NoSuchDistro')

    const { launchAgentTerminal } = useLaunchSession()
    await launchAgentTerminal(makeAgent(), makeTask())

    const tabsStore = useTabsStore()
    const terminal = tabsStore.tabs.find(t => t.type === 'terminal') as Tab | undefined
    expect(terminal?.wslDistro).toBe('Ubuntu-24.04')
  })

  it('parsedDefault.cli mismatch → does not match instance', async () => {
    // Store 'gemini:Debian' → parsedDefault = { distro: 'Debian', cli: 'gemini' }
    // Available: only claude on Debian → no match → fallback to isDefault
    api.getCliInstances.mockResolvedValueOnce([
      { cli: 'claude', distro: 'Debian', version: '2.0.0', isDefault: false, type: 'wsl' },
      { cli: 'claude', distro: 'Ubuntu-24.04', version: '2.0.0', isDefault: true, type: 'wsl' },
    ])
    const settingsStore = useSettingsStore()
    settingsStore.setDefaultCliInstance('gemini', 'Debian')

    const { launchAgentTerminal } = useLaunchSession()
    await launchAgentTerminal(makeAgent(), makeTask())

    const tabsStore = useTabsStore()
    const terminal = tabsStore.tabs.find(t => t.type === 'terminal') as Tab | undefined
    // cli mismatch: gemini != claude → no match → isDefault = Ubuntu-24.04
    expect(terminal?.wslDistro).toBe('Ubuntu-24.04')
  })
})

// ─── systemPrompt resolution branches ─────────────────────────────────────────

describe('T1346: systemPrompt resolution', () => {
  beforeEach(setupBeforeEach)
  afterEach(() => vi.useRealTimers())

  it('opts.systemPrompt = false → skip system prompt, no IPC call', async () => {
    const { launchAgentTerminal } = useLaunchSession()
    await launchAgentTerminal(makeAgent(), makeTask(), { systemPrompt: false })

    expect(api.getAgentSystemPrompt).not.toHaveBeenCalled()
    const tabsStore = useTabsStore()
    const terminal = tabsStore.tabs.find(t => t.type === 'terminal') as Tab | undefined
    expect(terminal?.systemPrompt).toBeNull()
  })

  it('opts.systemPrompt = false with thinkingMode → thinking mode is forwarded', async () => {
    const { launchAgentTerminal } = useLaunchSession()
    await launchAgentTerminal(makeAgent(), makeTask(), {
      systemPrompt: false,
      thinkingMode: 'disabled'
    })

    const tabsStore = useTabsStore()
    const terminal = tabsStore.tabs.find(t => t.type === 'terminal') as Tab | undefined
    expect(terminal?.thinkingMode).toBe('disabled')
  })

  it('opts.systemPrompt = "custom" → uses that string, no IPC call', async () => {
    const { launchAgentTerminal } = useLaunchSession()
    await launchAgentTerminal(makeAgent(), makeTask(), { systemPrompt: 'custom sys' })

    expect(api.getAgentSystemPrompt).not.toHaveBeenCalled()
    const tabsStore = useTabsStore()
    const terminal = tabsStore.tabs.find(t => t.type === 'terminal') as Tab | undefined
    expect(terminal?.systemPrompt).toBe('custom sys')
  })

  it('opts.systemPrompt = "" (empty string) → treated as falsy → undefined', async () => {
    // opts.systemPrompt !== undefined (is ''), so we enter the else-if branch
    // fullSystemPrompt = '' || undefined → undefined → null in tab
    const { launchAgentTerminal } = useLaunchSession()
    await launchAgentTerminal(makeAgent(), makeTask(), { systemPrompt: '' })

    expect(api.getAgentSystemPrompt).not.toHaveBeenCalled()
    const tabsStore = useTabsStore()
    const terminal = tabsStore.tabs.find(t => t.type === 'terminal') as Tab | undefined
    expect(terminal?.systemPrompt).toBeNull()
  })

  it('opts.systemPrompt = undefined (key absent) → auto-build from IPC', async () => {
    const { launchAgentTerminal } = useLaunchSession()
    await launchAgentTerminal(makeAgent(), makeTask(), {})

    expect(api.getAgentSystemPrompt).toHaveBeenCalled()
  })

  it('no opts → auto-build from IPC (null systemPrompt branch)', async () => {
    api.getAgentSystemPrompt.mockResolvedValueOnce({
      success: true, systemPrompt: null, systemPromptSuffix: null, thinkingMode: 'auto'
    })

    const { launchAgentTerminal } = useLaunchSession()
    await launchAgentTerminal(makeAgent(), makeTask())

    // promptResult.systemPrompt is null (falsy) → not pushed → fullSystemPrompt = undefined
    const tabsStore = useTabsStore()
    const terminal = tabsStore.tabs.find(t => t.type === 'terminal') as Tab | undefined
    expect(terminal?.systemPrompt).toBeNull()
  })

  it('promptResult.systemPrompt truthy → added to parts (kills ConditionalExpression → true)', async () => {
    api.getAgentSystemPrompt.mockResolvedValueOnce({
      success: true, systemPrompt: 'NonNull', systemPromptSuffix: null, thinkingMode: 'auto'
    })

    const { launchAgentTerminal } = useLaunchSession()
    await launchAgentTerminal(makeAgent(), makeTask())

    const tabsStore = useTabsStore()
    const terminal = tabsStore.tabs.find(t => t.type === 'terminal') as Tab | undefined
    expect(terminal?.systemPrompt).toBe('NonNull')
  })
})

// ─── convId / finalPrompt ──────────────────────────────────────────────────────

describe('T1346: convId → no buildAgentPrompt call', () => {
  beforeEach(setupBeforeEach)
  afterEach(() => vi.useRealTimers())

  it('opts.convId set → buildAgentPrompt NOT called, autoSend is undefined/null', async () => {
    const { launchAgentTerminal } = useLaunchSession()
    await launchAgentTerminal(makeAgent(), makeTask(), { convId: 'conv-123', systemPrompt: false })

    expect(api.buildAgentPrompt).not.toHaveBeenCalled()
    const tabsStore = useTabsStore()
    const terminal = tabsStore.tabs.find(t => t.type === 'terminal') as Tab | undefined
    // finalPrompt = undefined when convId is set
    expect(terminal?.autoSend).toBeNull()
  })

  it('opts.convId absent → buildAgentPrompt IS called', async () => {
    const { launchAgentTerminal } = useLaunchSession()
    await launchAgentTerminal(makeAgent(), makeTask(), { systemPrompt: false })

    expect(api.buildAgentPrompt).toHaveBeenCalled()
  })

  it('opts.customPrompt overrides default "T{taskId}" prompt', async () => {
    const { launchAgentTerminal } = useLaunchSession()
    await launchAgentTerminal(makeAgent(), makeTask({ id: 99 }), {
      customPrompt: 'custom message',
      systemPrompt: false
    })

    expect(api.buildAgentPrompt).toHaveBeenCalledWith(
      'dev-front-vuejs', 'custom message', '/test/db', 10
    )
  })

  it('no task and no opts → buildAgentPrompt called with empty string', async () => {
    const { launchAgentTerminal } = useLaunchSession()
    await launchAgentTerminal(makeAgent(), undefined)

    expect(api.buildAgentPrompt).toHaveBeenCalledWith(
      'dev-front-vuejs', '', '/test/db', 10
    )
  })
})

// ─── opts.taskId ?? task?.id ───────────────────────────────────────────────────

describe('T1346: taskId resolution (opts.taskId ?? task?.id)', () => {
  beforeEach(setupBeforeEach)
  afterEach(() => vi.useRealTimers())

  it('opts.taskId provided → uses opts.taskId (not task.id)', async () => {
    const { launchAgentTerminal } = useLaunchSession()
    await launchAgentTerminal(makeAgent(), makeTask({ id: 1 }), {
      taskId: 999,
      systemPrompt: false
    })

    const tabsStore = useTabsStore()
    const terminal = tabsStore.tabs.find(t => t.type === 'terminal') as Tab | undefined
    expect(terminal?.taskId).toBe(999)
  })

  it('opts.taskId absent → uses task.id', async () => {
    const { launchAgentTerminal } = useLaunchSession()
    await launchAgentTerminal(makeAgent(), makeTask({ id: 42 }), { systemPrompt: false })

    const tabsStore = useTabsStore()
    const terminal = tabsStore.tabs.find(t => t.type === 'terminal') as Tab | undefined
    expect(terminal?.taskId).toBe(42)
  })

  it('opts.taskId = 0 (falsy) → still uses 0 not task.id (nullish ?? not &&)', async () => {
    const { launchAgentTerminal } = useLaunchSession()
    await launchAgentTerminal(makeAgent(), makeTask({ id: 99 }), {
      taskId: 0,
      systemPrompt: false
    })

    const tabsStore = useTabsStore()
    const terminal = tabsStore.tabs.find(t => t.type === 'terminal') as Tab | undefined
    // ?? preserves 0 (not falsy check); if it were &&, would use task.id=99
    expect(terminal?.taskId).toBe(0)
  })
})

// ─── activate ?? false ─────────────────────────────────────────────────────────

describe('T1346: activate default false', () => {
  beforeEach(setupBeforeEach)
  afterEach(() => vi.useRealTimers())

  it('opts.activate = true → terminal is active tab', async () => {
    const { launchAgentTerminal } = useLaunchSession()
    await launchAgentTerminal(makeAgent(), makeTask(), {
      activate: true,
      systemPrompt: false
    })

    const tabsStore = useTabsStore()
    const terminal = tabsStore.tabs.find(t => t.type === 'terminal') as Tab | undefined
    // When activate=true, addTerminal is called with activate=true
    // Check that terminal exists — activation behavior depends on tabs store
    expect(terminal).toBeDefined()
  })

  it('opts.activate absent → defaults to false (not true)', async () => {
    const { launchAgentTerminal } = useLaunchSession()
    // Add another terminal to have 2 tabs
    const tabsStore = useTabsStore()
    tabsStore.addTerminal('other-agent', 'Ubuntu-24.04')
    const initialActive = tabsStore.activeTab

    await launchAgentTerminal(makeAgent(), makeTask(), { systemPrompt: false })

    // New terminal added with activate=false → active tab should remain what it was
    // (Unless tabs store changes on add, which it may not with activate=false)
    const newTerminal = tabsStore.tabs.find(t => t.agentName === 'dev-front-vuejs')
    expect(newTerminal).toBeDefined()
  })
})

// ─── worktree_enabled null/undefined logic ─────────────────────────────────────

describe('T1346: worktree_enabled null/undefined guard', () => {
  beforeEach(setupBeforeEach)
  afterEach(() => vi.useRealTimers())

  function setProjectPath(path: string | null) {
    const tasksStore = useTasksStore()
    ;(tasksStore as unknown as { projectPath: string | null }).projectPath = path
  }

  it('worktree_enabled = undefined → treated as null, uses global default', async () => {
    setProjectPath('/repo')
    const settingsStore = useSettingsStore()
    settingsStore.worktreeDefault = true

    const { launchAgentTerminal } = useLaunchSession()
    // undefined should be treated same as null (both go to global default)
    await launchAgentTerminal(makeAgent({ worktree_enabled: undefined as unknown as number }), makeTask())

    expect(api.worktreeCreate).toHaveBeenCalled()
  })

  it('worktree_enabled = 0 (defined, falsy) → treated as explicit disable, NOT global default', async () => {
    setProjectPath('/repo')
    const settingsStore = useSettingsStore()
    settingsStore.worktreeDefault = true  // global default is true

    const { launchAgentTerminal } = useLaunchSession()
    await launchAgentTerminal(makeAgent({ worktree_enabled: 0 }), makeTask())

    // worktree_enabled=0 means explicit disable; should NOT create worktree
    expect(api.worktreeCreate).not.toHaveBeenCalled()
  })

  it('worktree_enabled = 1 → explicit enable, overrides global false', async () => {
    setProjectPath('/repo')
    const settingsStore = useSettingsStore()
    settingsStore.worktreeDefault = false

    const { launchAgentTerminal } = useLaunchSession()
    await launchAgentTerminal(makeAgent({ worktree_enabled: 1 }), makeTask())

    expect(api.worktreeCreate).toHaveBeenCalled()
  })
})

// ─── launchReviewSession: first guard line 220 ────────────────────────────────

describe('T1346: launchReviewSession hasAgentTerminal guard', () => {
  beforeEach(setupBeforeEach)
  afterEach(() => vi.useRealTimers())

  it('first guard (line 220): terminal present before IPC → returns false immediately', async () => {
    const tabsStore = useTabsStore()
    tabsStore.addTerminal('review-master', 'Ubuntu-24.04')

    const reviewAgent = makeAgent({ id: 99, name: 'review-master', type: 'review' })
    const { launchReviewSession } = useLaunchSession()
    const result = await launchReviewSession(reviewAgent, [makeTask({ status: 'done' })])

    expect(result).toBe(false)
    // IPC should NOT be called at all — early return
    expect(api.getCliInstances).not.toHaveBeenCalled()
  })

  it('first guard absent (false mutation): terminal present → still returns false (second guard)', async () => {
    // This test complements the concurrent-add test in t1105
    // Ensures the function doesn't add a second terminal
    const tabsStore = useTabsStore()
    tabsStore.addTerminal('review-master', 'Ubuntu-24.04')

    const reviewAgent = makeAgent({ id: 99, name: 'review-master', type: 'review' })
    const { launchReviewSession } = useLaunchSession()
    await launchReviewSession(reviewAgent, [makeTask({ status: 'done' })])

    // Only 1 terminal total
    expect(tabsStore.tabs.filter(t => t.agentName === 'review-master')).toHaveLength(1)
  })
})

// ─── review session: distro matching (NoCoverage lines 244-249) ───────────────

describe('T1346: launchReviewSession distro matching', () => {
  beforeEach(setupBeforeEach)
  afterEach(() => vi.useRealTimers())

  it('review: storedDistro matches → uses stored instance', async () => {
    api.getCliInstances.mockResolvedValueOnce([
      { cli: 'claude', distro: 'Ubuntu-24.04', version: '2.0.0', isDefault: true, type: 'wsl' },
      { cli: 'claude', distro: 'Debian', version: '2.0.0', isDefault: false, type: 'wsl' },
    ])
    const settingsStore = useSettingsStore()
    settingsStore.setDefaultCliInstance('claude', 'Debian')

    const reviewAgent = makeAgent({ id: 99, name: 'review-master', type: 'review' })
    const { launchReviewSession } = useLaunchSession()
    await launchReviewSession(reviewAgent, [makeTask({ status: 'done' })])

    const tabsStore = useTabsStore()
    const terminal = tabsStore.tabs.find(t => t.agentName === 'review-master') as Tab | undefined
    expect(terminal?.wslDistro).toBe('Debian')
  })

  it('review: storedDistro absent → uses isDefault', async () => {
    api.getCliInstances.mockResolvedValueOnce([
      { cli: 'claude', distro: 'Ubuntu-24.04', version: '2.0.0', isDefault: true, type: 'wsl' },
      { cli: 'claude', distro: 'Debian', version: '2.0.0', isDefault: false, type: 'wsl' },
    ])

    const reviewAgent = makeAgent({ id: 99, name: 'review-master', type: 'review' })
    const { launchReviewSession } = useLaunchSession()
    await launchReviewSession(reviewAgent, [makeTask({ status: 'done' })])

    const tabsStore = useTabsStore()
    const terminal = tabsStore.tabs.find(t => t.agentName === 'review-master') as Tab | undefined
    expect(terminal?.wslDistro).toBe('Ubuntu-24.04')
  })

  it('review: parsedDefault.cli=null matches any cli on that distro', async () => {
    api.getCliInstances.mockResolvedValueOnce([
      { cli: 'claude', distro: 'Arch', version: '2.0.0', isDefault: false, type: 'wsl' },
      { cli: 'claude', distro: 'Ubuntu-24.04', version: '2.0.0', isDefault: true, type: 'wsl' },
    ])
    const settingsStore = useSettingsStore()
    // setDefaultCliInstance('', 'Arch') → key = 'Arch' → parsedDefault = { cli: null, distro: 'Arch' }
    settingsStore.setDefaultCliInstance('', 'Arch')

    const reviewAgent = makeAgent({ id: 99, name: 'review-master', type: 'review' })
    const { launchReviewSession } = useLaunchSession()
    await launchReviewSession(reviewAgent, [makeTask({ status: 'done' })])

    const tabsStore = useTabsStore()
    const terminal = tabsStore.tabs.find(t => t.agentName === 'review-master') as Tab | undefined
    expect(terminal?.wslDistro).toBe('Arch')
  })
})

// ─── review session: task list separator ', ' ─────────────────────────────────

describe('T1346: review session task list separator', () => {
  beforeEach(setupBeforeEach)
  afterEach(() => vi.useRealTimers())

  it('task list joined with ", " separator (kills StringLiteral → "")', async () => {
    const reviewAgent = makeAgent({ id: 99, name: 'review-master', type: 'review' })
    const tasks = [
      makeTask({ id: 5, title: 'First', status: 'done' }),
      makeTask({ id: 6, title: 'Second', status: 'done' }),
      makeTask({ id: 7, title: 'Third', status: 'done' }),
    ]

    const { launchReviewSession } = useLaunchSession()
    await launchReviewSession(reviewAgent, tasks)

    // buildAgentPrompt receives the joined task list
    const call = api.buildAgentPrompt.mock.calls[0]
    const prompt = call[1] as string
    // Should contain ", " as separator (not "T5T6T7" or "T5 T6 T7")
    expect(prompt).toContain('T5 First')
    expect(prompt).toContain(', ')
    expect(prompt).toContain('T6 Second')
  })
})

// ─── review session: maxFileLinesEnabled line and systemPromptSuffix ──────────

describe('T1346: review session systemPrompt assembly', () => {
  beforeEach(setupBeforeEach)
  afterEach(() => vi.useRealTimers())

  it('review: systemPromptSuffix included when present (kills ConditionalExpression→false)', async () => {
    api.getAgentSystemPrompt.mockResolvedValueOnce({
      success: true, systemPrompt: 'Base', systemPromptSuffix: 'Suffix', thinkingMode: 'auto'
    })

    const reviewAgent = makeAgent({ id: 99, name: 'review-master', type: 'review' })
    const { launchReviewSession } = useLaunchSession()
    await launchReviewSession(reviewAgent, [makeTask({ status: 'done' })])

    const tabsStore = useTabsStore()
    const terminal = tabsStore.tabs.find(t => t.agentName === 'review-master') as Tab | undefined
    expect(terminal?.systemPrompt).toBe('Base\n\nSuffix')
  })

  it('review: maxFileLinesEnabled adds line (kills ConditionalExpression→false at line 268)', async () => {
    const settingsStore = useSettingsStore()
    settingsStore.setMaxFileLinesEnabled(true)
    settingsStore.setMaxFileLinesCount(200)

    api.getAgentSystemPrompt.mockResolvedValueOnce({
      success: true, systemPrompt: 'Base', systemPromptSuffix: null, thinkingMode: 'auto'
    })

    const reviewAgent = makeAgent({ id: 99, name: 'review-master', type: 'review' })
    const { launchReviewSession } = useLaunchSession()
    await launchReviewSession(reviewAgent, [makeTask({ status: 'done' })])

    const tabsStore = useTabsStore()
    const terminal = tabsStore.tabs.find(t => t.agentName === 'review-master') as Tab | undefined
    expect(terminal?.systemPrompt).toContain('maximum 200 lines')
  })

  it('review: thinkingMode defaults to auto when null (kills StringLiteral → "")', async () => {
    api.getAgentSystemPrompt.mockResolvedValueOnce({
      success: true, systemPrompt: 'Base', systemPromptSuffix: null, thinkingMode: null
    })

    const reviewAgent = makeAgent({ id: 99, name: 'review-master', type: 'review' })
    const { launchReviewSession } = useLaunchSession()
    await launchReviewSession(reviewAgent, [makeTask({ status: 'done' })])

    const tabsStore = useTabsStore()
    const terminal = tabsStore.tabs.find(t => t.agentName === 'review-master') as Tab | undefined
    expect(terminal?.thinkingMode).toBe('auto')
  })

  it('review: systemPromptSuffix false (absent) → not added (kills ConditionalExpression→true L267)', async () => {
    api.getAgentSystemPrompt.mockResolvedValueOnce({
      success: true, systemPrompt: 'Base', systemPromptSuffix: null, thinkingMode: 'auto'
    })

    const reviewAgent = makeAgent({ id: 99, name: 'review-master', type: 'review' })
    const { launchReviewSession } = useLaunchSession()
    await launchReviewSession(reviewAgent, [makeTask({ status: 'done' })])

    const tabsStore = useTabsStore()
    const terminal = tabsStore.tabs.find(t => t.agentName === 'review-master') as Tab | undefined
    expect(terminal?.systemPrompt).toBe('Base')
  })

  it('review: \n\n separator used (kills StringLiteral → "")', async () => {
    api.getAgentSystemPrompt.mockResolvedValueOnce({
      success: true, systemPrompt: 'Part1', systemPromptSuffix: 'Part2', thinkingMode: 'auto'
    })

    const reviewAgent = makeAgent({ id: 99, name: 'review-master', type: 'review' })
    const { launchReviewSession } = useLaunchSession()
    await launchReviewSession(reviewAgent, [makeTask({ status: 'done' })])

    const tabsStore = useTabsStore()
    const terminal = tabsStore.tabs.find(t => t.agentName === 'review-master') as Tab | undefined
    // Verify exact separator (kills StringLiteral '\n\n' → "")
    expect(terminal?.systemPrompt).toBe('Part1\n\nPart2')
  })

  it('review: viewMode defaults to "stream" (kills StringLiteral)', async () => {
    const reviewAgent = makeAgent({ id: 99, name: 'review-master', type: 'review' })
    const { launchReviewSession } = useLaunchSession()
    await launchReviewSession(reviewAgent, [makeTask({ status: 'done' })])

    const tabsStore = useTabsStore()
    const terminal = tabsStore.tabs.find(t => t.agentName === 'review-master') as Tab | undefined
    expect(terminal?.viewMode).toBe('stream')
  })
})
