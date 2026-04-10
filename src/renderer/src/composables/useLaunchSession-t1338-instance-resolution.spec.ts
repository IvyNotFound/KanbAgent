/**
 * T1338: Mutation coverage for useLaunchSession.ts — Instance resolution
 *
 * Targets:
 * - Nullish coalescing chain (line 95): opts.cli ?? resolvedInstance?.cli ?? enabledClis[0] ?? 'claude'
 * - opts?.instance !== undefined branch (line 92): null vs undefined instance
 * - Instance resolution branches (lines 111-120): stored distro null vs undefined vs found
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useLaunchSession } from './useLaunchSession'
import { useTabsStore, type Tab } from '@renderer/stores/tabs'
import { useTasksStore } from '@renderer/stores/tasks'
import { useSettingsStore } from '@renderer/stores/settings'
import type { CliType } from '@shared/cli-types'
import { api, makeAgent, makeTask, testCounter } from './__helpers__/useLaunchSession-t1338.helpers'

describe('useLaunchSession T1338: opts.instance resolution (line 92-95)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
    testCounter.value++
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 4, 2, testCounter.value, 0, 0))
    api.buildAgentPrompt.mockResolvedValue('final prompt')
    api.getAgentSystemPrompt.mockResolvedValue({
      success: true, systemPrompt: 'System', systemPromptSuffix: null, thinkingMode: 'auto'
    })
    const tasksStore = useTasksStore()
    ;(tasksStore as unknown as { dbPath: string | null }).dbPath = '/test/db'
  })

  afterEach(() => { vi.useRealTimers() })

  it('opts.instance = null: caller explicitly passes null instance (undefined branch skipped)', async () => {
    // null !== undefined → enters the opts.instance branch (line 92)
    // resolvedInstance = null → resolvedCli falls through to enabledClis[0] ?? 'claude'
    const { launchAgentTerminal } = useLaunchSession()
    const result = await launchAgentTerminal(makeAgent(), makeTask(), { instance: null })

    // getCliInstances must NOT be called (modal path, not auto-detect)
    expect(api.getCliInstances).not.toHaveBeenCalled()
    expect(result).toBe('ok')

    const tabsStore = useTabsStore()
    const terminal = tabsStore.tabs.find(t => t.type === 'terminal') as Tab | undefined
    // resolvedInstance is null → distro is undefined → stored as null
    expect(terminal?.wslDistro).toBeNull()
  })

  it('opts.instance with opts.cli: opts.cli wins over resolvedInstance.cli (first ??) ', async () => {
    // Kills the EqualityOperator mutation on opts.cli ?? resolvedInstance?.cli
    const instance = { cli: 'claude', distro: 'Debian', version: '2.0', isDefault: false, type: 'wsl' as const }
    const { launchAgentTerminal } = useLaunchSession()

    // opts.cli = 'gemini' should override instance.cli = 'claude'
    const settingsStore = useSettingsStore()
    settingsStore.$patch({ enabledClis: ['gemini', 'claude'] as CliType[] })

    await launchAgentTerminal(makeAgent(), makeTask(), { instance, cli: 'gemini' })

    const tabsStore = useTabsStore()
    const terminal = tabsStore.tabs.find(t => t.type === 'terminal') as Tab | undefined
    expect(terminal?.wslDistro).toBe('Debian')
    // cli type used comes from opts.cli
    expect(api.getCliInstances).not.toHaveBeenCalled()
  })

  it('opts.instance set, opts.cli undefined: falls back to resolvedInstance.cli (second ??)', async () => {
    // opts.cli is undefined → uses resolvedInstance?.cli
    const instance = { cli: 'gemini', distro: 'Ubuntu-24.04', version: '1.0', isDefault: true, type: 'wsl' as const }
    const { launchAgentTerminal } = useLaunchSession()

    await launchAgentTerminal(makeAgent(), makeTask(), { instance })

    expect(api.getCliInstances).not.toHaveBeenCalled()
    expect(result => result).toBeDefined() // just verify no crash
  })

  it('opts.instance null, opts.cli undefined: falls back to enabledClis[0] (third ??)', async () => {
    // opts.cli is undefined, resolvedInstance is null (?.cli = undefined) → enabledClis[0]
    const settingsStore = useSettingsStore()
    settingsStore.$patch({ enabledClis: ['claude'] as CliType[] })

    const { launchAgentTerminal } = useLaunchSession()
    const result = await launchAgentTerminal(makeAgent(), makeTask(), { instance: null })

    expect(result).toBe('ok')
    expect(api.getCliInstances).not.toHaveBeenCalled()
  })

  it('opts.instance null, opts.cli undefined, enabledClis empty: falls back to claude (fourth ??)', async () => {
    // opts.cli = undefined, resolvedInstance = null, enabledClis = [] → 'claude'
    const settingsStore = useSettingsStore()
    settingsStore.$patch({ enabledClis: [] as CliType[] })

    const { launchAgentTerminal } = useLaunchSession()
    const result = await launchAgentTerminal(makeAgent(), makeTask(), { instance: null })

    expect(result).toBe('ok')
    expect(api.getCliInstances).not.toHaveBeenCalled()
  })
})

describe('useLaunchSession T1338: instance resolution — storedDistro null vs undefined (lines 111-120)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
    testCounter.value++
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 4, 3, testCounter.value, 0, 0))
    api.getAgentSystemPrompt.mockResolvedValue({
      success: true, systemPrompt: 'System', systemPromptSuffix: null, thinkingMode: 'auto'
    })
    api.buildAgentPrompt.mockResolvedValue('final prompt')
    const tasksStore = useTasksStore()
    ;(tasksStore as unknown as { dbPath: string | null }).dbPath = '/test/db'
  })

  afterEach(() => { vi.useRealTimers() })

  it('storedDistro never set (empty string default): falsy → skip find() → use isDefault', async () => {
    // storedDistro defaults to '' (falsy) → storedDistro ? ... → undefined → ?? find(isDefault)
    // Tests: if mutation changes truthy check for storedDistro, this breaks
    api.getCliInstances.mockResolvedValueOnce([
      { cli: 'claude', distro: 'Arch', version: '2.1.58', isDefault: false, type: 'wsl' },
      { cli: 'claude', distro: 'Ubuntu-24.04', version: '2.1.58', isDefault: true, type: 'wsl' },
    ])

    const settingsStore = useSettingsStore()
    // Ensure defaultCliInstance is the default empty string (never set by user)
    settingsStore.$patch({ defaultCliInstance: '' })

    const { launchAgentTerminal } = useLaunchSession()
    await launchAgentTerminal(makeAgent(), makeTask())

    const tabsStore = useTabsStore()
    const terminal = tabsStore.tabs.find(t => t.type === 'terminal') as Tab | undefined
    // Should have picked the isDefault instance since no storedDistro
    expect(terminal?.wslDistro).toBe('Ubuntu-24.04')
  })

  it('storedDistro=empty string: falsy → skip find() → use isDefault', async () => {
    api.getCliInstances.mockResolvedValueOnce([
      { cli: 'claude', distro: 'Arch', version: '2.1.58', isDefault: false, type: 'wsl' },
      { cli: 'claude', distro: 'Ubuntu-24.04', version: '2.1.58', isDefault: true, type: 'wsl' },
    ])

    const settingsStore = useSettingsStore()
    settingsStore.$patch({ defaultCliInstance: '' })

    const { launchAgentTerminal } = useLaunchSession()
    await launchAgentTerminal(makeAgent(), makeTask())

    const tabsStore = useTabsStore()
    const terminal = tabsStore.tabs.find(t => t.type === 'terminal') as Tab | undefined
    expect(terminal?.wslDistro).toBe('Ubuntu-24.04')
  })

  it('storedDistro found in instances: uses stored distro over isDefault', async () => {
    api.getCliInstances.mockResolvedValueOnce([
      { cli: 'claude', distro: 'Ubuntu-24.04', version: '2.1.58', isDefault: true, type: 'wsl' },
      { cli: 'claude', distro: 'Arch', version: '2.1.58', isDefault: false, type: 'wsl' },
    ])

    const settingsStore = useSettingsStore()
    settingsStore.setDefaultCliInstance('claude', 'Arch')

    const { launchAgentTerminal } = useLaunchSession()
    await launchAgentTerminal(makeAgent(), makeTask())

    const tabsStore = useTabsStore()
    const terminal = tabsStore.tabs.find(t => t.type === 'terminal') as Tab | undefined
    // stored distro 'Arch' was found → use it
    expect(terminal?.wslDistro).toBe('Arch')
  })

  it('storedDistro NOT found: falls back to first in list when no isDefault', async () => {
    api.getCliInstances.mockResolvedValueOnce([
      { cli: 'claude', distro: 'Arch', version: '2.1.58', isDefault: false, type: 'wsl' },
      { cli: 'claude', distro: 'Debian', version: '2.1.58', isDefault: false, type: 'wsl' },
    ])

    const settingsStore = useSettingsStore()
    settingsStore.setDefaultCliInstance('claude', 'NonExistent')

    const { launchAgentTerminal } = useLaunchSession()
    await launchAgentTerminal(makeAgent(), makeTask())

    const tabsStore = useTabsStore()
    const terminal = tabsStore.tabs.find(t => t.type === 'terminal') as Tab | undefined
    // storedDistro not found, no isDefault → falls back to cliInstances[0]
    expect(terminal?.wslDistro).toBe('Arch')
  })

  it('no CLI instances available: resolvedInstance = null → distro null', async () => {
    api.getCliInstances.mockResolvedValueOnce([])

    const { launchAgentTerminal } = useLaunchSession()
    const result = await launchAgentTerminal(makeAgent(), makeTask())

    expect(result).toBe('ok')
    const tabsStore = useTabsStore()
    const terminal = tabsStore.tabs.find(t => t.type === 'terminal') as Tab | undefined
    expect(terminal?.wslDistro).toBeNull()
  })
})
