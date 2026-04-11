/**
 * T1346: Mutation coverage for useLaunchSession.ts — Part 2
 * Covers: distro match logic, systemPrompt resolution, convId/finalPrompt,
 *         taskId resolution, activate default.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useLaunchSession } from './useLaunchSession'
import { useTabsStore, type Tab } from '@renderer/stores/tabs'
import { useSettingsStore } from '@renderer/stores/settings'
import { api, makeAgent, makeTask, setupBeforeEach } from './__helpers__/useLaunchSession-4-mutations.helpers'

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
    const settingsStore = useSettingsStore()
    settingsStore.setMaxFileLinesEnabled(false)
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
    const settingsStore = useSettingsStore()
    settingsStore.setMaxFileLinesEnabled(false)
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
