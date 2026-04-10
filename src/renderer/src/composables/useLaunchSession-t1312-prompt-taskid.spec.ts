/**
 * T1312: Mutation coverage gaps for useLaunchSession.ts — prompt + taskId resolution
 * Targets surviving mutants:
 * - L153-157: convId resume mode + customPrompt override
 * - L166: opts?.taskId ?? task?.id short-circuit
 * - L167: opts.activate
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useLaunchSession } from './useLaunchSession'
import { useTabsStore } from '@renderer/stores/tabs'
import { api, makeAgent, makeTask, setupBeforeEach } from './__helpers__/useLaunchSession-t1312.helpers'

describe('useLaunchSession T1312: prompt + taskId resolution', () => {
  beforeEach(() => {
    setupBeforeEach(2)
    api.getAgentSystemPrompt.mockResolvedValue({
      success: true, systemPrompt: 'prompt', systemPromptSuffix: null, thinkingMode: 'auto'
    })
    api.buildAgentPrompt.mockResolvedValue('built prompt')
  })

  afterEach(() => { vi.useRealTimers() })

  // L153-155: opts.convId → finalPrompt = undefined (resume mode)
  it('opts.convId skips prompt building and stores convId', async () => {
    const { launchAgentTerminal } = useLaunchSession()
    await launchAgentTerminal(makeAgent(), makeTask({ id: 7 }), {
      convId: 'conv-abc',
    })

    expect(api.buildAgentPrompt).not.toHaveBeenCalled()
    const tabsStore = useTabsStore()
    const terminal = tabsStore.tabs.find(t => t.type === 'terminal')
    expect(terminal?.autoSend).toBeNull()
    expect(terminal?.convId).toBe('conv-abc')
  })

  // L157: opts.customPrompt takes precedence over task-based prompt
  it('opts.customPrompt overrides default T{taskId} prompt', async () => {
    const { launchAgentTerminal } = useLaunchSession()
    await launchAgentTerminal(makeAgent(), makeTask({ id: 5 }), {
      customPrompt: 'Custom user text',
    })

    expect(api.buildAgentPrompt).toHaveBeenCalledWith(
      'dev-front-vuejs',
      'Custom user text',
      '/test/db',
      10
    )
  })

  // L157: no opts at all → uses task-based prompt T{task.id}
  it('no opts uses task-based T{id} prompt', async () => {
    const { launchAgentTerminal } = useLaunchSession()
    await launchAgentTerminal(makeAgent(), makeTask({ id: 77 }))

    expect(api.buildAgentPrompt).toHaveBeenCalledWith(
      'dev-front-vuejs',
      'T77',
      '/test/db',
      10
    )
  })

  // L157: no task and no customPrompt → empty string
  it('no task and no customPrompt sends empty string to buildAgentPrompt', async () => {
    const { launchAgentTerminal } = useLaunchSession()
    await launchAgentTerminal(makeAgent(), undefined)

    expect(api.buildAgentPrompt).toHaveBeenCalledWith(
      'dev-front-vuejs',
      '',
      '/test/db',
      10
    )
  })

  // L166: opts.taskId takes precedence over task.id
  it('opts.taskId overrides task.id for terminal association', async () => {
    const { launchAgentTerminal } = useLaunchSession()
    await launchAgentTerminal(makeAgent(), makeTask({ id: 1 }), {
      taskId: 999,
    })

    const tabsStore = useTabsStore()
    const terminal = tabsStore.tabs.find(t => t.type === 'terminal')
    expect(terminal?.taskId).toBe(999)
  })

  // L166: opts.taskId undefined falls back to task.id
  it('opts.taskId undefined falls back to task.id', async () => {
    const { launchAgentTerminal } = useLaunchSession()
    await launchAgentTerminal(makeAgent(), makeTask({ id: 42 }), {})

    const tabsStore = useTabsStore()
    const terminal = tabsStore.tabs.find(t => t.type === 'terminal')
    expect(terminal?.taskId).toBe(42)
  })

  // L166: no opts, no task → resolvedTaskId = undefined → stored as null
  it('no opts and no task → taskId is null on terminal', async () => {
    const { launchAgentTerminal } = useLaunchSession()
    await launchAgentTerminal(makeAgent(), undefined)

    const tabsStore = useTabsStore()
    const terminal = tabsStore.tabs.find(t => t.type === 'terminal')
    expect(terminal?.taskId).toBeNull()
  })

  // L167: activate defaults to false — terminal is not selected as active tab
  it('activate defaults to false — new terminal is not activeTab', async () => {
    const { launchAgentTerminal } = useLaunchSession()
    await launchAgentTerminal(makeAgent(), makeTask())

    const tabsStore = useTabsStore()
    const terminal = tabsStore.tabs.find(t => t.type === 'terminal')
    expect(terminal).toBeDefined()
    expect(tabsStore.activeTabId).not.toBe(terminal?.id)
  })

  // L167: opts.activate = true activates the tab
  it('opts.activate = true activates the new terminal tab', async () => {
    const { launchAgentTerminal } = useLaunchSession()
    await launchAgentTerminal(makeAgent(), makeTask(), { activate: true })

    const tabsStore = useTabsStore()
    const terminal = tabsStore.tabs.find(t => t.type === 'terminal')
    expect(tabsStore.activeTabId).toBe(terminal?.id)
  })
})
