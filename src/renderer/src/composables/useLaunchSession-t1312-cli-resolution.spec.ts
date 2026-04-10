/**
 * T1312: Mutation coverage gaps for useLaunchSession.ts — CLI resolution
 * Targets surviving mutants:
 * - L95: opts.cli ?? resolvedInstance?.cli ?? settingsStore.enabledClis[0] (CLI string literal)
 * - L104: candidates.length > 0 boundary
 * - L113-116: parsedDefault.cli === null branch (distro matching with null CLI)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useLaunchSession } from './useLaunchSession'
import { useTabsStore } from '@renderer/stores/tabs'
import { useSettingsStore } from '@renderer/stores/settings'
import type { CliType } from '@shared/cli-types'
import { api, makeAgent, makeTask, setupBeforeEach } from './__helpers__/useLaunchSession-t1312.helpers'

describe('useLaunchSession T1312: CLI resolution gaps', () => {
  beforeEach(() => { setupBeforeEach(0) })
  afterEach(() => { vi.useRealTimers() })

  // L95: opts.cli overrides resolvedInstance.cli when both are provided
  it('opts.cli overrides resolvedInstance.cli when both provided', async () => {
    const { launchAgentTerminal } = useLaunchSession()
    await launchAgentTerminal(makeAgent(), makeTask(), {
      instance: { cli: 'claude', distro: 'Ubuntu-24.04', isDefault: true, version: '2.0', type: 'wsl' },
      cli: 'gemini' as CliType,
    })

    const tabsStore = useTabsStore()
    const terminal = tabsStore.tabs.find(t => t.type === 'terminal')
    expect(terminal?.cli).toBe('gemini')
  })

  // L95: opts.cli is undefined → falls back to resolvedInstance.cli
  it('uses resolvedInstance.cli when opts.cli is undefined', async () => {
    const { launchAgentTerminal } = useLaunchSession()
    await launchAgentTerminal(makeAgent(), makeTask(), {
      instance: { cli: 'claude', distro: 'Ubuntu-24.04', isDefault: true, version: '2.0', type: 'wsl' },
      // no opts.cli
    })

    const tabsStore = useTabsStore()
    const terminal = tabsStore.tabs.find(t => t.type === 'terminal')
    expect(terminal?.cli).toBe('claude')
  })

  // L95: opts.instance is null → settingsStore.enabledClis[0] fallback
  it('falls back to settingsStore.enabledClis[0] when opts.instance is null', async () => {
    const settingsStore = useSettingsStore()
    settingsStore.$patch({ enabledClis: ['gemini'] as CliType[] })

    const { launchAgentTerminal } = useLaunchSession()
    await launchAgentTerminal(makeAgent(), makeTask(), {
      instance: null,
      // no opts.cli
    })

    const tabsStore = useTabsStore()
    const terminal = tabsStore.tabs.find(t => t.type === 'terminal')
    expect(terminal?.cli).toBe('gemini')
  })

  // L95: all absent → 'claude' hardcoded fallback
  it('falls back to claude when opts.cli, resolvedInstance, and enabledClis[0] are absent', async () => {
    const settingsStore = useSettingsStore()
    settingsStore.$patch({ enabledClis: [] as CliType[] })

    const { launchAgentTerminal } = useLaunchSession()
    await launchAgentTerminal(makeAgent(), makeTask(), {
      instance: null,
      // no opts.cli
    })

    const tabsStore = useTabsStore()
    const terminal = tabsStore.tabs.find(t => t.type === 'terminal')
    expect(terminal?.cli).toBe('claude')
  })

  // L104: candidates.length === 0 for all fallback CLIs → resolvedInstance = null
  it('all CLIs have no instances → resolvedInstance null, defaultCli stays first', async () => {
    const settingsStore = useSettingsStore()
    settingsStore.$patch({ enabledClis: ['claude', 'gemini'] as CliType[] })

    api.getCliInstances.mockResolvedValueOnce([])

    const { launchAgentTerminal } = useLaunchSession()
    const result = await launchAgentTerminal(makeAgent(), makeTask())

    expect(result).toBe('ok')
    const tabsStore = useTabsStore()
    const terminal = tabsStore.tabs.find(t => t.type === 'terminal')
    // resolvedInstance = null (no candidates), resolvedCli = 'claude'
    expect(terminal?.cli).toBe('claude')
    expect(terminal?.wslDistro).toBeNull()
  })

  // L104: candidates.length === 1 → enters inner loop, switches CLI
  it('candidates.length === 1 in fallback loop triggers CLI switch', async () => {
    const settingsStore = useSettingsStore()
    settingsStore.$patch({ enabledClis: ['claude', 'gemini'] as CliType[] })

    api.getCliInstances.mockResolvedValueOnce([
      { cli: 'gemini', distro: 'Arch', version: '1.0', isDefault: true, type: 'wsl' }
    ])

    const { launchAgentTerminal } = useLaunchSession()
    const result = await launchAgentTerminal(makeAgent(), makeTask())

    expect(result).toBe('ok')
    const tabsStore = useTabsStore()
    const terminal = tabsStore.tabs.find(t => t.type === 'terminal')
    // claude had 0 instances → fell back to gemini
    expect(terminal?.cli).toBe('gemini')
    expect(terminal?.wslDistro).toBe('Arch')
  })

  // L113-116: parsedDefault.cli === null (legacy distro-only format) — matches any CLI with that distro
  it('distro-only storedDefault (no CLI prefix) matches instance by distro regardless of CLI', async () => {
    // Simulate legacy format (no cli prefix) by patching the store directly
    const settingsStore = useSettingsStore()
    settingsStore.$patch({ defaultCliInstance: 'Debian' })

    api.getCliInstances.mockResolvedValueOnce([
      { cli: 'claude', distro: 'Ubuntu-24.04', version: '2.0', isDefault: false, type: 'wsl' },
      { cli: 'claude', distro: 'Debian', version: '2.0', isDefault: false, type: 'wsl' },
    ])

    const { launchAgentTerminal } = useLaunchSession()
    await launchAgentTerminal(makeAgent(), makeTask())

    const tabsStore = useTabsStore()
    const terminal = tabsStore.tabs.find(t => t.type === 'terminal')
    expect(terminal?.wslDistro).toBe('Debian')
  })
})
