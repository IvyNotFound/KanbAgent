/**
 * Tests for useStreamIpc composable (T1965)
 * File: src/renderer/src/composables/useStreamIpc.ts
 *
 * Covers: handleSend, handleStop, handlePermissionRespond, handleLinkClick,
 *         onMounted exit handler (auto-close), onUnmounted cleanup.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, ref, computed } from 'vue'
import { createTestingPinia } from '@pinia/testing'
import i18n from '@renderer/plugins/i18n'
import { useStreamIpc } from '@renderer/composables/useStreamIpc'
import { useTabsStore } from '@renderer/stores/tabs'
import type { StreamEvent } from '@renderer/types/stream'

// ── Helpers ────────────────────────────────────────────────────────────────────

const TERMINAL_ID = 'tab-test-1'

function makeTab(overrides: Record<string, unknown> = {}) {
  return {
    id: TERMINAL_ID,
    type: 'stream',
    title: 'Test Tab',
    ptyId: null,
    agentName: 'dev-front-vuejs',
    wslDistro: null,
    autoSend: null,
    systemPrompt: null,
    thinkingMode: null,
    customBinaryName: null,
    convId: null,
    workDir: null,
    cli: null,
    modelId: null,
    ...overrides,
  }
}

function defaultInitialState(overrides: Record<string, unknown> = {}) {
  return {
    tabs: { tabs: [makeTab()] },
    tasks: { projectPath: '/project', dbPath: '/project/.claude/project.db' },
    settings: { autoLaunchAgentSessions: true },
    agents: { agents: [{ id: 1, name: 'dev-front-vuejs', type: 'dev' }] },
    ...overrides,
  }
}

function api() {
  return window.electronAPI as Record<string, ReturnType<typeof vi.fn>>
}

async function mountComposable(options: {
  initialState?: Record<string, unknown>
  scrollContainerEl?: HTMLElement | null
} = {}) {
  const { initialState = {}, scrollContainerEl = null } = options

  const events = ref<StreamEvent[]>([])
  const scrollContainerRef = ref<HTMLElement | null>(scrollContainerEl)

  let composable!: ReturnType<typeof useStreamIpc>
  let capturedTabsStore!: ReturnType<typeof useTabsStore>

  const TestComp = defineComponent({
    setup() {
      capturedTabsStore = useTabsStore()
      composable = useStreamIpc({
        terminalId: TERMINAL_ID,
        events,
        enqueueEvent: vi.fn(),
        assignEventId: (e: StreamEvent) => { e._id = 1 },
        scrollToBottom: vi.fn(),
        scrollContainer: scrollContainerRef,
        isStreaming: computed(() => false),
      })
      return {}
    },
    template: '<div/>',
  })

  const wrapper = mount(TestComp, {
    global: {
      plugins: [
        createTestingPinia({
          initialState: defaultInitialState(initialState),
          stubActions: true,
        }),
        i18n,
      ],
    },
  })

  await flushPromises()
  return { wrapper, composable, events, tabsStore: capturedTabsStore, scrollContainerRef }
}

// ── handleSend ─────────────────────────────────────────────────────────────────

describe('useStreamIpc — handleSend', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Restore default agentSend implementation in case a previous test overrode it
    api().agentSend.mockResolvedValue(undefined)
  })

  it('strips 📎 path lines from displayText but sends raw text to agentSend', async () => {
    const { composable, events } = await mountComposable()
    const rawText = 'Hello agent\n📎 /tmp/image.png'

    await composable.handleSend(rawText)

    const userEvent = events.value.find(e => e.type === 'user')
    expect(userEvent).toBeDefined()
    const textBlock = userEvent?.message?.content.find(b => b.type === 'text')
    expect(textBlock?.text).toBe('Hello agent')
    // agentSend receives the full raw text (with 📎 line)
    expect(api().agentSend).toHaveBeenCalledWith('agent-1', rawText)
  })

  it('creates user StreamEvent with correct content blocks and pushes to events', async () => {
    const { composable, events } = await mountComposable()

    await composable.handleSend('Test message')

    expect(events.value.length).toBeGreaterThanOrEqual(1)
    const userEvent = events.value.find(e => e.type === 'user')
    expect(userEvent).toBeDefined()
    expect(userEvent?.message?.role).toBe('user')
    expect(userEvent?.message?.content[0]?.type).toBe('text')
    expect(userEvent?.message?.content[0]?.text).toBe('Test message')
  })

  it('ptyId null → still pushes user event but does not call agentSend', async () => {
    const { composable, events } = await mountComposable()
    composable.ptyId.value = null

    await composable.handleSend('Hello with no ptyId')

    expect(events.value.some(e => e.type === 'user')).toBe(true)
    expect(api().agentSend).not.toHaveBeenCalled()
  })

  it('agentSend throws → pushes error system event', async () => {
    api().agentSend.mockRejectedValueOnce(new Error('IPC error'))

    const { composable, events } = await mountComposable()
    await composable.handleSend('failing message')
    await flushPromises()

    const errEvent = events.value.find(e => e.type === 'system' && e.subtype === 'error')
    expect(errEvent).toBeDefined()
    expect(errEvent?.session_id).toContain('IPC error')
  })
})

// ── handleStop ─────────────────────────────────────────────────────────────────

describe('useStreamIpc — handleStop', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('agentStopped=true → does not call agentKill', async () => {
    const { composable } = await mountComposable()
    composable.agentStopped.value = true

    composable.handleStop()

    expect(api().agentKill).not.toHaveBeenCalled()
  })

  it('ptyId=null → no-op, does not call agentKill', async () => {
    const { composable } = await mountComposable()
    composable.ptyId.value = null

    composable.handleStop()

    expect(api().agentKill).not.toHaveBeenCalled()
  })

  it('ptyId set and not stopped → calls agentKill and sets agentStopped=true', async () => {
    const { composable } = await mountComposable()
    // ptyId is 'agent-1' after agentCreate resolves in onMounted

    composable.handleStop()

    expect(api().agentKill).toHaveBeenCalledWith('agent-1')
    expect(composable.agentStopped.value).toBe(true)
  })
})

// ── handlePermissionRespond ────────────────────────────────────────────────────

describe('useStreamIpc — handlePermissionRespond', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api().permissionRespond.mockResolvedValue(true)
  })

  it('allow → calls permissionRespond, removes permission from list, adds user event', async () => {
    const { composable, events } = await mountComposable()

    composable.pendingPermissions.value = [
      { permission_id: 'perm-1', tool_name: 'Bash', tool_input: {} },
    ]

    await composable.handlePermissionRespond('perm-1', 'allow')
    await flushPromises()

    expect(api().permissionRespond).toHaveBeenCalledWith('perm-1', 'allow')
    expect(composable.pendingPermissions.value).toHaveLength(0)
    expect(events.value.some(e => e.type === 'user')).toBe(true)
  })

  it('deny → calls permissionRespond with deny, removes permission, adds user event', async () => {
    const { composable, events } = await mountComposable()

    composable.pendingPermissions.value = [
      { permission_id: 'perm-2', tool_name: 'Write', tool_input: {} },
    ]

    await composable.handlePermissionRespond('perm-2', 'deny')
    await flushPromises()

    expect(api().permissionRespond).toHaveBeenCalledWith('perm-2', 'deny')
    expect(composable.pendingPermissions.value).toHaveLength(0)
    expect(events.value.filter(e => e.type === 'user').length).toBeGreaterThan(0)
  })

  it('unknown permissionId → no-op, does not call permissionRespond', async () => {
    const { composable, events } = await mountComposable()

    composable.pendingPermissions.value = [
      { permission_id: 'perm-3', tool_name: 'Bash', tool_input: {} },
    ]
    const eventsBefore = events.value.length

    await composable.handlePermissionRespond('perm-unknown', 'allow')

    expect(api().permissionRespond).not.toHaveBeenCalled()
    expect(composable.pendingPermissions.value).toHaveLength(1)
    expect(events.value.length).toBe(eventsBefore)
  })
})

// ── handleLinkClick (via scrollContainer capture listener) ────────────────────

describe('useStreamIpc — handleLinkClick', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(window.electronAPI as Record<string, unknown>).openExternal = vi.fn()
  })

  afterEach(() => {
    delete (window.electronAPI as Record<string, unknown>).openExternal
  })

  it('https link → calls preventDefault and openExternal', async () => {
    const div = document.createElement('div')
    await mountComposable({ scrollContainerEl: div })

    const a = document.createElement('a')
    a.setAttribute('href', 'https://example.com')
    div.appendChild(a)

    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    vi.spyOn(event, 'preventDefault')
    a.dispatchEvent(event)

    expect(event.preventDefault).toHaveBeenCalled()
    const openExternal = (window.electronAPI as Record<string, ReturnType<typeof vi.fn>>).openExternal
    expect(openExternal).toHaveBeenCalledWith('https://example.com')
  })

  it('relative link → does not call openExternal', async () => {
    const div = document.createElement('div')
    await mountComposable({ scrollContainerEl: div })

    const a = document.createElement('a')
    a.setAttribute('href', '/relative/path')
    div.appendChild(a)

    a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

    const openExternal = (window.electronAPI as Record<string, ReturnType<typeof vi.fn>>).openExternal
    expect(openExternal).not.toHaveBeenCalled()
  })
})

// ── onMounted exit handler ─────────────────────────────────────────────────────

describe('useStreamIpc — onMounted exit handler', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('exitCode=0 + autoLaunchAgentSessions + non-planner agent → schedules closeTab after 3s', async () => {
    let exitCb: ((code: number | null) => void) | undefined
    api().onAgentExit.mockImplementation((_id: string, cb: (code: number | null) => void) => {
      exitCb = cb
      return () => {}
    })

    const { tabsStore } = await mountComposable()

    vi.useFakeTimers()
    expect(exitCb).toBeDefined()
    exitCb!(0)

    expect(tabsStore.closeTab).not.toHaveBeenCalled()
    vi.advanceTimersByTime(3000)
    expect(tabsStore.closeTab).toHaveBeenCalledWith(TERMINAL_ID)
  })

  it('exitCode≠0 → does NOT schedule closeTab', async () => {
    let exitCb: ((code: number | null) => void) | undefined
    api().onAgentExit.mockImplementation((_id: string, cb: (code: number | null) => void) => {
      exitCb = cb
      return () => {}
    })

    const { tabsStore } = await mountComposable()

    vi.useFakeTimers()
    exitCb!(1)
    vi.advanceTimersByTime(3000)

    expect(tabsStore.closeTab).not.toHaveBeenCalled()
  })

  it('task-creator agentName → does NOT auto-close even on clean exit (exitCode=0)', async () => {
    let exitCb: ((code: number | null) => void) | undefined
    api().onAgentExit.mockImplementation((_id: string, cb: (code: number | null) => void) => {
      exitCb = cb
      return () => {}
    })

    const { tabsStore } = await mountComposable({
      initialState: {
        tabs: { tabs: [makeTab({ agentName: 'task-creator' })] },
        agents: { agents: [{ id: 1, name: 'dev-front-vuejs', type: 'dev' }] },
      },
    })

    vi.useFakeTimers()
    exitCb!(0)
    vi.advanceTimersByTime(3000)

    expect(tabsStore.closeTab).not.toHaveBeenCalled()
  })

  it('planner agent type → does NOT auto-close on clean exit', async () => {
    let exitCb: ((code: number | null) => void) | undefined
    api().onAgentExit.mockImplementation((_id: string, cb: (code: number | null) => void) => {
      exitCb = cb
      return () => {}
    })

    const { tabsStore } = await mountComposable({
      initialState: {
        tabs: { tabs: [makeTab({ agentName: 'my-planner' })] },
        agents: { agents: [{ id: 1, name: 'my-planner', type: 'planner' }] },
      },
    })

    vi.useFakeTimers()
    exitCb!(0)
    vi.advanceTimersByTime(3000)

    expect(tabsStore.closeTab).not.toHaveBeenCalled()
  })
})

// ── onUnmounted cleanup ────────────────────────────────────────────────────────

describe('useStreamIpc — onUnmounted', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls all unsub functions and agentKill when agent not stopped', async () => {
    const unsubStream = vi.fn()
    const unsubConvId = vi.fn()
    const unsubExit = vi.fn()
    const unsubPermission = vi.fn()

    api().onAgentStream.mockReturnValue(unsubStream)
    api().onAgentConvId.mockReturnValue(unsubConvId)
    api().onAgentExit.mockReturnValue(unsubExit)
    api().onPermissionRequest.mockReturnValue(unsubPermission)

    const { wrapper, composable } = await mountComposable()
    expect(composable.ptyId.value).toBe('agent-1')

    wrapper.unmount()

    expect(unsubStream).toHaveBeenCalled()
    expect(unsubConvId).toHaveBeenCalled()
    expect(unsubExit).toHaveBeenCalled()
    expect(unsubPermission).toHaveBeenCalled()
    expect(api().agentKill).toHaveBeenCalledWith('agent-1')
  })

  it('does not call agentKill when agent was already stopped', async () => {
    const { wrapper, composable } = await mountComposable()

    composable.agentStopped.value = true
    wrapper.unmount()

    expect(api().agentKill).not.toHaveBeenCalled()
  })
})
