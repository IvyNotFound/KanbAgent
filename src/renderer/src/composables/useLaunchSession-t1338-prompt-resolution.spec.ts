/**
 * T1338: Mutation coverage for useLaunchSession.ts — Prompt resolution branches
 *
 * Targets:
 * - systemPrompt resolution path (opts?.systemPrompt === false vs !== undefined)
 * - convId (resume mode) vs normal prompt
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useLaunchSession } from './useLaunchSession'
import { useTabsStore, type Tab } from '@renderer/stores/tabs'
import { useTasksStore } from '@renderer/stores/tasks'
import { api, makeAgent, makeTask, testCounter } from './__helpers__/useLaunchSession-t1338.helpers'

describe('useLaunchSession T1338: prompt resolution branches', () => {
  // Tests for the systemPrompt resolution path (opts?.systemPrompt === false vs !== undefined)
  // and convId (resume mode) vs normal prompt

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
    testCounter.value++
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 4, 5, testCounter.value, 0, 0))
    api.getCliInstances.mockResolvedValue([
      { cli: 'claude', distro: 'Ubuntu-24.04', version: '2.1.58', isDefault: true, type: 'wsl' }
    ])
    api.buildAgentPrompt.mockResolvedValue('auto prompt')
    const tasksStore = useTasksStore()
    ;(tasksStore as unknown as { dbPath: string | null }).dbPath = '/test/db'
  })

  afterEach(() => { vi.useRealTimers() })

  it('opts.systemPrompt = false: skips getAgentSystemPrompt and leaves systemPrompt undefined', async () => {
    const { launchAgentTerminal } = useLaunchSession()
    await launchAgentTerminal(makeAgent(), makeTask(), { systemPrompt: false })

    // With systemPrompt=false, getAgentSystemPrompt should NOT be called
    expect(api.getAgentSystemPrompt).not.toHaveBeenCalled()

    const tabsStore = useTabsStore()
    const terminal = tabsStore.tabs.find(t => t.type === 'terminal') as Tab | undefined
    expect(terminal?.systemPrompt).toBeNull()
  })

  it('opts.systemPrompt = string: uses provided string, skips getAgentSystemPrompt', async () => {
    const { launchAgentTerminal } = useLaunchSession()
    await launchAgentTerminal(makeAgent(), makeTask(), { systemPrompt: 'Custom system prompt' })

    expect(api.getAgentSystemPrompt).not.toHaveBeenCalled()

    const tabsStore = useTabsStore()
    const terminal = tabsStore.tabs.find(t => t.type === 'terminal') as Tab | undefined
    expect(terminal?.systemPrompt).toBe('Custom system prompt')
  })

  it('opts.systemPrompt = empty string: stores null (falsy → undefined → null)', async () => {
    // '' || undefined → undefined → addTerminal stores null
    const { launchAgentTerminal } = useLaunchSession()
    await launchAgentTerminal(makeAgent(), makeTask(), { systemPrompt: '' })

    expect(api.getAgentSystemPrompt).not.toHaveBeenCalled()

    const tabsStore = useTabsStore()
    const terminal = tabsStore.tabs.find(t => t.type === 'terminal') as Tab | undefined
    // '' is falsy → opts.systemPrompt || undefined → undefined → null in addTerminal
    expect(terminal?.systemPrompt).toBeNull()
  })

  it('opts.convId provided: skips buildAgentPrompt (resume mode → no initial prompt)', async () => {
    api.getAgentSystemPrompt.mockResolvedValueOnce({
      success: true, systemPrompt: 'System', systemPromptSuffix: null, thinkingMode: 'auto'
    })

    const { launchAgentTerminal } = useLaunchSession()
    await launchAgentTerminal(makeAgent(), makeTask(), { convId: 'conv-abc-123' })

    // In resume mode, buildAgentPrompt should NOT be called
    expect(api.buildAgentPrompt).not.toHaveBeenCalled()

    const tabsStore = useTabsStore()
    const terminal = tabsStore.tabs.find(t => t.type === 'terminal') as Tab | undefined
    // autoSend/finalPrompt should be undefined → stored as null
    expect(terminal?.autoSend).toBeNull()
    // convId should be stored
    expect(terminal?.convId).toBe('conv-abc-123')
  })

  it('opts.customPrompt: uses customPrompt instead of T{taskId}', async () => {
    api.getAgentSystemPrompt.mockResolvedValueOnce({
      success: true, systemPrompt: 'System', systemPromptSuffix: null, thinkingMode: 'auto'
    })

    const { launchAgentTerminal } = useLaunchSession()
    await launchAgentTerminal(makeAgent(), makeTask({ id: 42 }), { customPrompt: 'Custom task instructions' })

    expect(api.buildAgentPrompt).toHaveBeenCalledWith(
      'dev-front-vuejs',
      'Custom task instructions',
      '/test/db',
      10
    )
  })

  it('no task, no customPrompt: passes empty string to buildAgentPrompt', async () => {
    api.getAgentSystemPrompt.mockResolvedValueOnce({
      success: true, systemPrompt: 'System', systemPromptSuffix: null, thinkingMode: 'auto'
    })

    const { launchAgentTerminal } = useLaunchSession()
    await launchAgentTerminal(makeAgent(), undefined)

    expect(api.buildAgentPrompt).toHaveBeenCalledWith(
      'dev-front-vuejs',
      '',
      '/test/db',
      10
    )
  })

  it('opts.thinkingMode with systemPrompt=false: uses opts.thinkingMode (resume path)', async () => {
    const { launchAgentTerminal } = useLaunchSession()
    await launchAgentTerminal(makeAgent(), makeTask(), { systemPrompt: false, thinkingMode: 'disabled' })

    const tabsStore = useTabsStore()
    const terminal = tabsStore.tabs.find(t => t.type === 'terminal') as Tab | undefined
    expect(terminal?.thinkingMode).toBe('disabled')
  })

  it('opts.thinkingMode with opts.systemPrompt string: uses opts.thinkingMode', async () => {
    const { launchAgentTerminal } = useLaunchSession()
    await launchAgentTerminal(makeAgent(), makeTask(), {
      systemPrompt: 'Custom prompt',
      thinkingMode: 'disabled'
    })

    const tabsStore = useTabsStore()
    const terminal = tabsStore.tabs.find(t => t.type === 'terminal') as Tab | undefined
    expect(terminal?.thinkingMode).toBe('disabled')
  })
})
