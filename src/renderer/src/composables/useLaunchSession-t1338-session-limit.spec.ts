/**
 * T1338: Mutation coverage for useLaunchSession.ts — Session-limit logic
 *
 * Targets:
 * - LogicalOperator: maxSess !== -1 condition, agentTerminalCount >= maxSess
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useLaunchSession } from './useLaunchSession'
import { useTabsStore } from '@renderer/stores/tabs'
import { useTasksStore } from '@renderer/stores/tasks'
import { api, makeAgent, makeTask, testCounter } from './__helpers__/useLaunchSession-t1338.helpers'

describe('useLaunchSession T1338: session-limit logic (maxSess !== -1 AND >= maxSess)', () => {
  // These tests target LogicalOperator mutations on line 81:
  // `if (maxSess !== -1 && agentTerminalCount(agent.name) >= maxSess)`
  // Mutations: && → ||, !== -1 → === -1, !== -1 → true/false, >= → >, <=, ===

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
    testCounter.value++
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 4, 4, testCounter.value, 0, 0))
    api.getCliInstances.mockResolvedValue([
      { cli: 'claude', distro: 'Ubuntu-24.04', version: '2.1.58', isDefault: true, type: 'wsl' }
    ])
    api.getAgentSystemPrompt.mockResolvedValue({
      success: true, systemPrompt: 'System', systemPromptSuffix: null, thinkingMode: 'auto'
    })
    api.buildAgentPrompt.mockResolvedValue('final prompt')
    const tasksStore = useTasksStore()
    ;(tasksStore as unknown as { dbPath: string | null }).dbPath = '/test/db'
  })

  afterEach(() => { vi.useRealTimers() })

  it('exactly at max_sessions limit: returns session-limit (>= must be true at count == max)', async () => {
    const tabsStore = useTabsStore()
    // Add exactly max_sessions=2 terminals
    tabsStore.addTerminal('dev-front-vuejs', 'Ubuntu-24.04')
    tabsStore.addTerminal('dev-front-vuejs', 'Ubuntu-24.04')

    const { launchAgentTerminal } = useLaunchSession()
    const result = await launchAgentTerminal(makeAgent({ max_sessions: 2 }), makeTask())

    // count(2) >= max(2) → session-limit
    expect(result).toBe('session-limit')
  })

  it('one below max_sessions: returns ok (count < max)', async () => {
    const tabsStore = useTabsStore()
    tabsStore.addTerminal('dev-front-vuejs', 'Ubuntu-24.04')

    const { launchAgentTerminal } = useLaunchSession()
    const result = await launchAgentTerminal(makeAgent({ max_sessions: 2 }), makeTask())

    // count(1) < max(2) → ok
    expect(result).toBe('ok')
  })

  it('max_sessions=-1 with many terminals: never returns session-limit (unlimited)', async () => {
    const tabsStore = useTabsStore()
    for (let i = 0; i < 20; i++) tabsStore.addTerminal('dev-front-vuejs', 'Ubuntu-24.04')

    const { launchAgentTerminal } = useLaunchSession()
    const result = await launchAgentTerminal(makeAgent({ max_sessions: -1 }), makeTask())

    // maxSess === -1 → skip limit check → ok
    expect(result).toBe('ok')
  })

  it('max_sessions=0: immediately returns session-limit (count 0 >= max 0)', async () => {
    // No terminals open, but max_sessions=0 means even 0 >= 0 triggers limit
    const { launchAgentTerminal } = useLaunchSession()
    const result = await launchAgentTerminal(makeAgent({ max_sessions: 0 }), makeTask())

    expect(result).toBe('session-limit')
  })

  it('max_sessions=1 with 1 terminal: session-limit (boundary case for >=)', async () => {
    const tabsStore = useTabsStore()
    tabsStore.addTerminal('dev-front-vuejs', 'Ubuntu-24.04')

    const { launchAgentTerminal } = useLaunchSession()
    const result = await launchAgentTerminal(makeAgent({ max_sessions: 1 }), makeTask())

    expect(result).toBe('session-limit')
  })

  it('different agent not counted toward limit: terminals for other agents are ignored', async () => {
    const tabsStore = useTabsStore()
    // Add 10 terminals for a different agent
    for (let i = 0; i < 10; i++) tabsStore.addTerminal('other-agent', 'Ubuntu-24.04')

    const { launchAgentTerminal } = useLaunchSession()
    const result = await launchAgentTerminal(makeAgent({ max_sessions: 3 }), makeTask())

    // Count for 'dev-front-vuejs' is 0 → 0 >= 3 is false → ok
    expect(result).toBe('ok')
  })
})
