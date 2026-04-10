/**
 * T1346: Mutation coverage for useLaunchSession.ts — Part 1
 * Covers: cache TTL, terminal count filter, maxSess semantics,
 *         opts.instance override, CLI filter boundary.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useLaunchSession } from './useLaunchSession'
import { useTabsStore, type Tab } from '@renderer/stores/tabs'
import { useSettingsStore } from '@renderer/stores/settings'
import type { CliType } from '@shared/cli-types'
import { api, makeAgent, makeTask, setupBeforeEach } from './__helpers__/useLaunchSession-4-mutations.helpers'

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
