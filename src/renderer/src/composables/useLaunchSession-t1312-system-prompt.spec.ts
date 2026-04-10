/**
 * T1312: Mutation coverage gaps for useLaunchSession.ts — systemPrompt opts branches
 * Targets surviving mutants:
 * - L128-135: opts.systemPrompt false / string / undefined branches
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useLaunchSession } from './useLaunchSession'
import { useTabsStore } from '@renderer/stores/tabs'
import { api, makeAgent, makeTask, setupBeforeEach } from './__helpers__/useLaunchSession-t1312.helpers'

describe('useLaunchSession T1312: systemPrompt opts branches', () => {
  beforeEach(() => {
    setupBeforeEach(1)
    api.getAgentSystemPrompt.mockResolvedValue({
      success: true, systemPrompt: 'You are dev-front', systemPromptSuffix: null, thinkingMode: 'auto'
    })
  })

  afterEach(() => { vi.useRealTimers() })

  // L128-131: opts.systemPrompt === false → no systemPrompt, no IPC call
  it('opts.systemPrompt === false skips system prompt and does NOT call getAgentSystemPrompt', async () => {
    const { launchAgentTerminal } = useLaunchSession()
    const result = await launchAgentTerminal(makeAgent(), makeTask(), {
      systemPrompt: false,
    })

    expect(result).toBe('ok')
    expect(api.getAgentSystemPrompt).not.toHaveBeenCalled()
    const tabsStore = useTabsStore()
    const terminal = tabsStore.tabs.find(t => t.type === 'terminal')
    expect(terminal?.systemPrompt).toBeNull()
  })

  // L131: opts.systemPrompt === false with thinkingMode override applied
  it('opts.systemPrompt === false applies opts.thinkingMode', async () => {
    const { launchAgentTerminal } = useLaunchSession()
    await launchAgentTerminal(makeAgent(), makeTask(), {
      systemPrompt: false,
      thinkingMode: 'disabled',
    })

    const tabsStore = useTabsStore()
    const terminal = tabsStore.tabs.find(t => t.type === 'terminal')
    expect(terminal?.thinkingMode).toBe('disabled')
  })

  // L132-135: opts.systemPrompt is a non-empty string → used directly, no IPC call
  it('opts.systemPrompt string is used directly without IPC call', async () => {
    const { launchAgentTerminal } = useLaunchSession()
    await launchAgentTerminal(makeAgent(), makeTask(), {
      systemPrompt: 'Custom system prompt',
    })

    expect(api.getAgentSystemPrompt).not.toHaveBeenCalled()
    const tabsStore = useTabsStore()
    const terminal = tabsStore.tabs.find(t => t.type === 'terminal')
    expect(terminal?.systemPrompt).toBe('Custom system prompt')
  })

  // L134: opts.systemPrompt is empty string → falsy → stored as null
  it('opts.systemPrompt empty string resolves to null in terminal', async () => {
    const { launchAgentTerminal } = useLaunchSession()
    await launchAgentTerminal(makeAgent(), makeTask(), {
      systemPrompt: '',
    })

    expect(api.getAgentSystemPrompt).not.toHaveBeenCalled()
    const tabsStore = useTabsStore()
    const terminal = tabsStore.tabs.find(t => t.type === 'terminal')
    // opts.systemPrompt || undefined → undefined → addTerminal stores null
    expect(terminal?.systemPrompt).toBeNull()
  })

  // L135: opts.systemPrompt string with thinkingMode
  it('opts.systemPrompt string with thinkingMode disabled', async () => {
    const { launchAgentTerminal } = useLaunchSession()
    await launchAgentTerminal(makeAgent(), makeTask(), {
      systemPrompt: 'Custom prompt',
      thinkingMode: 'disabled',
    })

    const tabsStore = useTabsStore()
    const terminal = tabsStore.tabs.find(t => t.type === 'terminal')
    expect(terminal?.thinkingMode).toBe('disabled')
  })
})
