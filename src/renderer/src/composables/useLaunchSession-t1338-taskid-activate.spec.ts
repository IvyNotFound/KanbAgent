/**
 * T1338: Mutation coverage for useLaunchSession.ts — taskId and activate overrides
 *
 * Targets:
 * - resolvedTaskId = opts?.taskId ?? task?.id
 * - opts.activate tab activation behavior
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useLaunchSession } from './useLaunchSession'
import { useTabsStore, type Tab } from '@renderer/stores/tabs'
import { useTasksStore } from '@renderer/stores/tasks'
import { api, makeAgent, makeTask, testCounter } from './__helpers__/useLaunchSession-t1338.helpers'

describe('useLaunchSession T1338: opts.taskId and activate overrides', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
    testCounter.value++
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 4, 6, testCounter.value, 0, 0))
    api.getCliInstances.mockResolvedValue([
      { cli: 'claude', distro: 'Ubuntu-24.04', version: '2.1.58', isDefault: true, type: 'wsl' }
    ])
    api.getAgentSystemPrompt.mockResolvedValue({
      success: true, systemPrompt: 'System', systemPromptSuffix: null, thinkingMode: 'auto'
    })
    api.buildAgentPrompt.mockResolvedValue('auto prompt')
    const tasksStore = useTasksStore()
    ;(tasksStore as unknown as { dbPath: string | null }).dbPath = '/test/db'
  })

  afterEach(() => { vi.useRealTimers() })

  it('opts.taskId overrides task.id for tab tracking', async () => {
    // resolvedTaskId = opts?.taskId ?? task?.id → opts.taskId wins
    const { launchAgentTerminal } = useLaunchSession()
    await launchAgentTerminal(makeAgent(), makeTask({ id: 5 }), { taskId: 99 })

    const tabsStore = useTabsStore()
    const terminal = tabsStore.tabs.find(t => t.type === 'terminal') as Tab | undefined
    expect(terminal?.taskId).toBe(99)
  })

  it('no opts.taskId: uses task.id for tab tracking', async () => {
    const { launchAgentTerminal } = useLaunchSession()
    await launchAgentTerminal(makeAgent(), makeTask({ id: 42 }))

    const tabsStore = useTabsStore()
    const terminal = tabsStore.tabs.find(t => t.type === 'terminal') as Tab | undefined
    expect(terminal?.taskId).toBe(42)
  })

  it('no opts, no task: taskId is undefined → stored as null', async () => {
    const { launchAgentTerminal } = useLaunchSession()
    await launchAgentTerminal(makeAgent(), undefined)

    const tabsStore = useTabsStore()
    const terminal = tabsStore.tabs.find(t => t.type === 'terminal') as Tab | undefined
    expect(terminal?.taskId).toBeNull()
  })

  it('opts.activate = true: tab is activated after launch', async () => {
    const { launchAgentTerminal } = useLaunchSession()
    await launchAgentTerminal(makeAgent(), makeTask(), { activate: true })

    const tabsStore = useTabsStore()
    const terminal = tabsStore.tabs.find(t => t.type === 'terminal') as Tab | undefined
    expect(terminal).toBeDefined()
    // When activate=true, the tab becomes the active tab
    expect(tabsStore.activeTabId).toBe(terminal?.id)
  })

  it('opts.activate = false (default): tab is not activated', async () => {
    // First create a different active tab
    const tabsStore = useTabsStore()
    tabsStore.addTerminal('other-agent', 'Ubuntu-24.04', undefined, undefined, undefined, undefined, undefined, true)
    const firstTabId = tabsStore.activeTabId

    const { launchAgentTerminal } = useLaunchSession()
    await launchAgentTerminal(makeAgent(), makeTask(), { activate: false })

    // Active tab should still be the first one
    expect(tabsStore.activeTabId).toBe(firstTabId)
  })
})
