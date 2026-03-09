/**
 * Tests for useStreamEvents composable (T1220)
 * Targets: assignEventId, enqueueEvent/flushEvents, MAX_EVENTS eviction,
 * isNearBottom/scrollToBottom, hidden-tab eviction, toggleCollapsed, cleanup.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { nextTick } from 'vue'

// ─── Mock electronAPI ─────────────────────────────────────────────────────────
const mockElectronAPI = {
  queryDb: vi.fn().mockResolvedValue([]),
  watchDb: vi.fn().mockResolvedValue(undefined),
  unwatchDb: vi.fn().mockResolvedValue(undefined),
  onDbChanged: vi.fn().mockReturnValue(() => {}),
  agentGroupsList: vi.fn().mockResolvedValue({ success: true, groups: [] }),
  findProjectDb: vi.fn().mockResolvedValue(null),
  migrateDb: vi.fn().mockResolvedValue({ success: true }),
  tasksUpdateStatus: vi.fn().mockResolvedValue({ success: true }),
  agentCreate: vi.fn().mockResolvedValue('agent-1'),
  agentSend: vi.fn().mockResolvedValue(undefined),
  agentKill: vi.fn().mockResolvedValue(undefined),
  onAgentStream: vi.fn(() => () => {}),
  onAgentConvId: vi.fn(() => () => {}),
  onAgentExit: vi.fn(() => () => {}),
  onHookEvent: vi.fn(() => () => {}),
}

Object.defineProperty(window, 'electronAPI', {
  value: mockElectronAPI,
  writable: true,
})

// ─── Mock renderMarkdown ──────────────────────────────────────────────────────
vi.mock('@renderer/utils/renderMarkdown', () => ({
  renderMarkdown: vi.fn((text: string) => `<p>${text}</p>`),
}))

import { renderMarkdown } from '@renderer/utils/renderMarkdown'

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function makeTabsStore(activeTabId = 'tab-1') {
  const { useTabsStore } = await import('@renderer/stores/tabs')
  const store = useTabsStore()
  store.$patch({ tabs: [{ id: activeTabId, type: 'terminal', title: 'T', ptyId: null, agentName: null, wslDistro: null, autoSend: null, systemPrompt: null, thinkingMode: null, convId: null, viewMode: 'stream' }] })
  store.setActive(activeTabId)
  return store
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('useStreamEvents — assignEventId (L27)', () => {
  beforeEach(() => {
    vi.resetModules()
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.setItem('dbPath', '/test/project.db')
  })

  it('assigns _id when _id is null', async () => {
    await makeTabsStore('tab-1')
    const { useStreamEvents } = await import('@renderer/composables/useStreamEvents')
    const { assignEventId } = useStreamEvents('tab-1')

    const e: any = { type: 'result', _id: null }
    assignEventId(e)
    expect(e._id).toBe(1)
  })

  it('assigns _id when _id is undefined', async () => {
    await makeTabsStore('tab-1')
    const { useStreamEvents } = await import('@renderer/composables/useStreamEvents')
    const { assignEventId } = useStreamEvents('tab-1')

    const e: any = { type: 'result' }
    assignEventId(e)
    expect(e._id).toBe(1)
  })

  it('does NOT overwrite existing _id', async () => {
    await makeTabsStore('tab-1')
    const { useStreamEvents } = await import('@renderer/composables/useStreamEvents')
    const { assignEventId } = useStreamEvents('tab-1')

    const e: any = { type: 'result', _id: 42 }
    assignEventId(e)
    expect(e._id).toBe(42)
  })

  it('increments _id monotonically across multiple calls', async () => {
    await makeTabsStore('tab-1')
    const { useStreamEvents } = await import('@renderer/composables/useStreamEvents')
    const { assignEventId } = useStreamEvents('tab-1')

    const e1: any = { type: 'result', _id: null }
    const e2: any = { type: 'result', _id: null }
    assignEventId(e1)
    assignEventId(e2)
    expect(e2._id).toBe(e1._id! + 1)
  })
})

describe('useStreamEvents — flushEvents text event rendering (L52-L54)', () => {
  beforeEach(() => {
    vi.resetModules()
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.setItem('dbPath', '/test/project.db')
  })

  it('pre-renders _html for type=text events with non-null text', async () => {
    await makeTabsStore('tab-1')
    const { useStreamEvents } = await import('@renderer/composables/useStreamEvents')
    const { events, enqueueEvent } = useStreamEvents('tab-1')

    enqueueEvent({ type: 'text', text: 'hello world' })
    await nextTick()

    expect(events.value).toHaveLength(1)
    expect(events.value[0]._html).toBe('<p>hello world</p>')
    expect(renderMarkdown).toHaveBeenCalledWith('hello world')
  })

  it('does NOT render _html for type=text with null text', async () => {
    await makeTabsStore('tab-1')
    const { useStreamEvents } = await import('@renderer/composables/useStreamEvents')
    const { events, enqueueEvent } = useStreamEvents('tab-1')

    enqueueEvent({ type: 'text', text: null })
    await nextTick()

    expect(events.value).toHaveLength(1)
    expect(events.value[0]._html).toBeUndefined()
  })

  it('does NOT render _html for type=result (non-text event)', async () => {
    await makeTabsStore('tab-1')
    const { useStreamEvents } = await import('@renderer/composables/useStreamEvents')
    const { events, enqueueEvent } = useStreamEvents('tab-1')

    enqueueEvent({ type: 'result', num_turns: 5 })
    await nextTick()

    expect(events.value).toHaveLength(1)
    expect(events.value[0]._html).toBeUndefined()
  })

  it('does NOT render _html for type=error (non-text event)', async () => {
    await makeTabsStore('tab-1')
    const { useStreamEvents } = await import('@renderer/composables/useStreamEvents')
    const { events, enqueueEvent } = useStreamEvents('tab-1')

    enqueueEvent({ type: 'error', text: 'err msg' })
    await nextTick()

    expect(events.value).toHaveLength(1)
    expect(events.value[0]._html).toBeUndefined()
  })
})

describe('useStreamEvents — flushEvents message.content blocks (L38-L50)', () => {
  beforeEach(() => {
    vi.resetModules()
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.setItem('dbPath', '/test/project.db')
  })

  it('renders _html for message.content text blocks with non-null text', async () => {
    await makeTabsStore('tab-1')
    const { useStreamEvents } = await import('@renderer/composables/useStreamEvents')
    const { events, enqueueEvent } = useStreamEvents('tab-1')

    enqueueEvent({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'block text' }],
      },
    })
    await nextTick()

    expect(events.value[0].message?.content[0]._html).toBe('<p>block text</p>')
  })

  it('does NOT render _html for text block with null text', async () => {
    await makeTabsStore('tab-1')
    const { useStreamEvents } = await import('@renderer/composables/useStreamEvents')
    const { events, enqueueEvent } = useStreamEvents('tab-1')

    enqueueEvent({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: null }],
      },
    })
    await nextTick()

    expect(events.value[0].message?.content[0]._html).toBeUndefined()
  })

  it('processes tool_result block with string content', async () => {
    await makeTabsStore('tab-1')
    const { useStreamEvents } = await import('@renderer/composables/useStreamEvents')
    const { events, enqueueEvent } = useStreamEvents('tab-1')

    enqueueEvent({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'tool_result', content: 'tool output text' }],
      },
    })
    await nextTick()

    const block = events.value[0].message?.content[0]
    expect(block?._html).toBe('<p>tool output text</p>')
    expect(typeof block?._lineCount).toBe('number')
    expect(typeof block?._isLong).toBe('boolean')
  })

  it('processes tool_result block with array content', async () => {
    await makeTabsStore('tab-1')
    const { useStreamEvents } = await import('@renderer/composables/useStreamEvents')
    const { events, enqueueEvent } = useStreamEvents('tab-1')

    enqueueEvent({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'tool_result', content: [{ type: 'text', text: 'line1' }, { type: 'text', text: 'line2' }] }],
      },
    })
    await nextTick()

    const block = events.value[0].message?.content[0]
    expect(renderMarkdown).toHaveBeenCalledWith(expect.stringContaining('line1'))
  })

  it('processes tool_result block with empty/null content (uses empty string)', async () => {
    await makeTabsStore('tab-1')
    const { useStreamEvents } = await import('@renderer/composables/useStreamEvents')
    const { events, enqueueEvent } = useStreamEvents('tab-1')

    enqueueEvent({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'tool_result', content: null }],
      },
    })
    await nextTick()

    const block = events.value[0].message?.content[0]
    expect(block?._html).toBe('<p></p>')
  })

  it('strips ANSI escape codes from tool_result content', async () => {
    await makeTabsStore('tab-1')
    const { useStreamEvents } = await import('@renderer/composables/useStreamEvents')
    const { events, enqueueEvent } = useStreamEvents('tab-1')

    enqueueEvent({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'tool_result', content: '\x1B[32mgreen text\x1B[0m' }],
      },
    })
    await nextTick()

    expect(renderMarkdown).toHaveBeenCalledWith('green text')
  })

  it('sets _isLong=true for tool_result with more than 15 lines', async () => {
    await makeTabsStore('tab-1')
    const { useStreamEvents } = await import('@renderer/composables/useStreamEvents')
    const { events, enqueueEvent } = useStreamEvents('tab-1')

    const longContent = Array.from({ length: 20 }, (_, i) => `line${i}`).join('\n')
    enqueueEvent({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'tool_result', content: longContent }],
      },
    })
    await nextTick()

    const block = events.value[0].message?.content[0]
    expect(block?._isLong).toBe(true)
    expect(block?._lineCount).toBe(20)
  })

  it('sets _isLong=false for tool_result with 15 lines or fewer', async () => {
    await makeTabsStore('tab-1')
    const { useStreamEvents } = await import('@renderer/composables/useStreamEvents')
    const { events, enqueueEvent } = useStreamEvents('tab-1')

    const shortContent = Array.from({ length: 10 }, (_, i) => `line${i}`).join('\n')
    enqueueEvent({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'tool_result', content: shortContent }],
      },
    })
    await nextTick()

    const block = events.value[0].message?.content[0]
    expect(block?._isLong).toBe(false)
    expect(block?._lineCount).toBe(10)
  })
})

describe('useStreamEvents — MAX_EVENTS eviction (L61-L67)', () => {
  beforeEach(() => {
    vi.resetModules()
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.setItem('dbPath', '/test/project.db')
  })

  it('retains at most MAX_EVENTS events after flush when over limit', async () => {
    await makeTabsStore('tab-1')
    const { useStreamEvents, MAX_EVENTS } = await import('@renderer/composables/useStreamEvents')
    const { events, enqueueEvent } = useStreamEvents('tab-1')

    // Push MAX_EVENTS + 50 events
    const total = MAX_EVENTS + 50
    for (let i = 0; i < total; i++) {
      enqueueEvent({ type: 'result', num_turns: i })
    }
    await nextTick()

    expect(events.value.length).toBe(MAX_EVENTS)
  })

  it('events below MAX_EVENTS are not evicted', async () => {
    await makeTabsStore('tab-1')
    const { useStreamEvents, MAX_EVENTS } = await import('@renderer/composables/useStreamEvents')
    const { events, enqueueEvent } = useStreamEvents('tab-1')

    const total = MAX_EVENTS - 10
    for (let i = 0; i < total; i++) {
      enqueueEvent({ type: 'result', num_turns: i })
    }
    await nextTick()

    expect(events.value.length).toBe(total)
  })

  it('evicted events have their collapsed keys removed', async () => {
    await makeTabsStore('tab-1')
    const { useStreamEvents, MAX_EVENTS } = await import('@renderer/composables/useStreamEvents')
    const { events, collapsed, enqueueEvent, flushEvents, assignEventId } = useStreamEvents('tab-1')

    // Push exactly MAX_EVENTS events so we know their _id values (1..MAX_EVENTS)
    for (let i = 0; i < MAX_EVENTS; i++) {
      enqueueEvent({ type: 'result', num_turns: i })
    }
    await nextTick()

    // The first event has _id=1 — add a collapsed key for it
    const firstId = events.value[0]._id!
    collapsed.value[`${firstId}-tool`] = true

    expect(collapsed.value[`${firstId}-tool`]).toBe(true)

    // Push 1 more event — this triggers eviction of the first event
    enqueueEvent({ type: 'result', num_turns: MAX_EVENTS })
    await nextTick()

    // The collapsed key for the evicted event should be gone
    expect(collapsed.value[`${firstId}-tool`]).toBeUndefined()
  })
})

describe('useStreamEvents — scrollToBottom / isNearBottom (L78-L87)', () => {
  beforeEach(() => {
    vi.resetModules()
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.setItem('dbPath', '/test/project.db')
  })

  it('isNearBottom returns true when scrollContainer is null', async () => {
    await makeTabsStore('tab-1')
    const { useStreamEvents } = await import('@renderer/composables/useStreamEvents')
    const { scrollContainer, scrollToBottom } = useStreamEvents('tab-1')

    // scrollContainer is null by default — scrollToBottom should not throw
    scrollContainer.value = null
    expect(() => scrollToBottom(true)).not.toThrow()
  })

  it('scrollToBottom(force=true) sets scrollTop to scrollHeight', async () => {
    await makeTabsStore('tab-1')
    const { useStreamEvents } = await import('@renderer/composables/useStreamEvents')
    const { scrollContainer, scrollToBottom } = useStreamEvents('tab-1')

    const el = document.createElement('div')
    Object.defineProperty(el, 'scrollHeight', { value: 1000, configurable: true })
    scrollContainer.value = el

    scrollToBottom(true)
    await nextTick()

    expect(el.scrollTop).toBe(1000)
  })

  it('scrollToBottom(force=false) scrolls when near bottom (< 150px from bottom)', async () => {
    await makeTabsStore('tab-1')
    const { useStreamEvents } = await import('@renderer/composables/useStreamEvents')
    const { scrollContainer, scrollToBottom } = useStreamEvents('tab-1')

    const el = document.createElement('div')
    // scrollHeight - scrollTop - clientHeight = 1000 - 900 - 50 = 50 < 150 → near bottom
    Object.defineProperty(el, 'scrollHeight', { value: 1000, configurable: true })
    Object.defineProperty(el, 'scrollTop', { value: 900, configurable: true, writable: true })
    Object.defineProperty(el, 'clientHeight', { value: 50, configurable: true })
    scrollContainer.value = el

    scrollToBottom(false)
    await nextTick()

    expect(el.scrollTop).toBe(1000)
  })

  it('scrollToBottom(force=false) does NOT scroll when far from bottom (>= 150px)', async () => {
    await makeTabsStore('tab-1')
    const { useStreamEvents } = await import('@renderer/composables/useStreamEvents')
    const { scrollContainer, scrollToBottom } = useStreamEvents('tab-1')

    const el = document.createElement('div')
    // scrollHeight - scrollTop - clientHeight = 1000 - 0 - 100 = 900 >= 150 → not near bottom
    Object.defineProperty(el, 'scrollHeight', { value: 1000, configurable: true })
    Object.defineProperty(el, 'scrollTop', { value: 0, configurable: true, writable: true })
    Object.defineProperty(el, 'clientHeight', { value: 100, configurable: true })
    scrollContainer.value = el

    scrollToBottom(false)
    await nextTick()

    // scrollTop should remain 0 (not scrolled)
    expect(el.scrollTop).toBe(0)
  })

  it('isNearBottom threshold: exactly 149px from bottom = near (should scroll)', async () => {
    await makeTabsStore('tab-1')
    const { useStreamEvents } = await import('@renderer/composables/useStreamEvents')
    const { scrollContainer, scrollToBottom } = useStreamEvents('tab-1')

    const el = document.createElement('div')
    // 1000 - 851 - 0 = 149 < 150 → near bottom
    Object.defineProperty(el, 'scrollHeight', { value: 1000, configurable: true })
    Object.defineProperty(el, 'scrollTop', { value: 851, configurable: true, writable: true })
    Object.defineProperty(el, 'clientHeight', { value: 0, configurable: true })
    scrollContainer.value = el

    scrollToBottom(false)
    await nextTick()

    expect(el.scrollTop).toBe(1000)
  })

  it('isNearBottom threshold: exactly 150px from bottom = NOT near (should not scroll)', async () => {
    await makeTabsStore('tab-1')
    const { useStreamEvents } = await import('@renderer/composables/useStreamEvents')
    const { scrollContainer, scrollToBottom } = useStreamEvents('tab-1')

    const el = document.createElement('div')
    // 1000 - 850 - 0 = 150 → NOT < 150, so not near bottom
    Object.defineProperty(el, 'scrollHeight', { value: 1000, configurable: true })
    Object.defineProperty(el, 'scrollTop', { value: 850, configurable: true, writable: true })
    Object.defineProperty(el, 'clientHeight', { value: 0, configurable: true })
    scrollContainer.value = el

    scrollToBottom(false)
    await nextTick()

    expect(el.scrollTop).toBe(850)
  })
})

describe('useStreamEvents — hidden-tab eviction + _html clearing (L90-L127)', () => {
  beforeEach(() => {
    vi.resetModules()
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.setItem('dbPath', '/test/project.db')
  })

  it('clears _html on text events when tab becomes inactive', async () => {
    const tabsStore = await makeTabsStore('tab-1')
    const { useStreamEvents } = await import('@renderer/composables/useStreamEvents')
    const { events, enqueueEvent } = useStreamEvents('tab-1')

    // Push a text event
    enqueueEvent({ type: 'text', text: 'hello' })
    await nextTick()

    expect(events.value[0]._html).toBe('<p>hello</p>')

    // Deactivate tab to trigger hidden-tab watcher
    tabsStore.setActive('other-tab')
    await nextTick()

    expect(events.value[0]._html).toBeUndefined()
  })

  it('clears _html on message content blocks when tab becomes inactive', async () => {
    const tabsStore = await makeTabsStore('tab-1')
    const { useStreamEvents } = await import('@renderer/composables/useStreamEvents')
    const { events, enqueueEvent } = useStreamEvents('tab-1')

    enqueueEvent({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'block text' }],
      },
    })
    await nextTick()

    expect(events.value[0].message?.content[0]._html).toBe('<p>block text</p>')

    tabsStore.setActive('other-tab')
    await nextTick()

    expect(events.value[0].message?.content[0]._html).toBeUndefined()
  })

  it('evicts to MAX_EVENTS_HIDDEN when tab becomes inactive with >200 events', async () => {
    const tabsStore = await makeTabsStore('tab-1')
    const { useStreamEvents, MAX_EVENTS_HIDDEN } = await import('@renderer/composables/useStreamEvents')
    const { events, enqueueEvent } = useStreamEvents('tab-1')

    // Push 300 events (above MAX_EVENTS_HIDDEN=200)
    for (let i = 0; i < 300; i++) {
      enqueueEvent({ type: 'result', num_turns: i })
    }
    await nextTick()
    expect(events.value.length).toBe(300)

    tabsStore.setActive('other-tab')
    await nextTick()

    expect(events.value.length).toBeLessThanOrEqual(MAX_EVENTS_HIDDEN)
  })

  it('does not evict when tab becomes inactive with <= MAX_EVENTS_HIDDEN events', async () => {
    const tabsStore = await makeTabsStore('tab-1')
    const { useStreamEvents, MAX_EVENTS_HIDDEN } = await import('@renderer/composables/useStreamEvents')
    const { events, enqueueEvent } = useStreamEvents('tab-1')

    for (let i = 0; i < 100; i++) {
      enqueueEvent({ type: 'result', num_turns: i })
    }
    await nextTick()
    expect(events.value.length).toBe(100)

    tabsStore.setActive('other-tab')
    await nextTick()

    expect(events.value.length).toBe(100)
  })

  it('removes collapsed keys for evicted hidden-tab events', async () => {
    const tabsStore = await makeTabsStore('tab-1')
    const { useStreamEvents, MAX_EVENTS_HIDDEN } = await import('@renderer/composables/useStreamEvents')
    const { events, collapsed, enqueueEvent } = useStreamEvents('tab-1')

    for (let i = 0; i < 300; i++) {
      enqueueEvent({ type: 'result', num_turns: i })
    }
    await nextTick()

    // Add a collapsed key for an early event (will be evicted)
    const earlyId = events.value[0]._id!
    collapsed.value[`${earlyId}-tool`] = true

    tabsStore.setActive('other-tab')
    await nextTick()

    expect(collapsed.value[`${earlyId}-tool`]).toBeUndefined()
  })

  it('re-renders _html when tab becomes active again (text event)', async () => {
    const tabsStore = await makeTabsStore('tab-1')
    const { useStreamEvents } = await import('@renderer/composables/useStreamEvents')
    const { events, enqueueEvent } = useStreamEvents('tab-1')

    enqueueEvent({ type: 'text', text: 'reactivate me' })
    await nextTick()

    // Deactivate (clears _html)
    tabsStore.setActive('other-tab')
    await nextTick()
    expect(events.value[0]._html).toBeUndefined()

    // Re-activate (re-renders _html)
    tabsStore.setActive('tab-1')
    await nextTick()
    expect(events.value[0]._html).toBe('<p>reactivate me</p>')
  })

  it('re-renders _html for message text blocks when tab becomes active', async () => {
    const tabsStore = await makeTabsStore('tab-1')
    const { useStreamEvents } = await import('@renderer/composables/useStreamEvents')
    const { events, enqueueEvent } = useStreamEvents('tab-1')

    enqueueEvent({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: 'block' }] },
    })
    await nextTick()

    tabsStore.setActive('other-tab')
    await nextTick()
    expect(events.value[0].message?.content[0]._html).toBeUndefined()

    tabsStore.setActive('tab-1')
    await nextTick()
    expect(events.value[0].message?.content[0]._html).toBe('<p>block</p>')
  })

  it('does NOT re-render text block _html when text is null on reactivation', async () => {
    const tabsStore = await makeTabsStore('tab-1')
    const { useStreamEvents } = await import('@renderer/composables/useStreamEvents')
    const { events, enqueueEvent } = useStreamEvents('tab-1')

    // Push text event with null text
    enqueueEvent({ type: 'text', text: null })
    await nextTick()

    tabsStore.setActive('other-tab')
    await nextTick()

    tabsStore.setActive('tab-1')
    await nextTick()

    expect(events.value[0]._html).toBeUndefined()
  })
})

describe('useStreamEvents — toggleCollapsed (L131-L133)', () => {
  beforeEach(() => {
    vi.resetModules()
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.setItem('dbPath', '/test/project.db')
  })

  it('toggleCollapsed sets key to true when not present (defaultCollapsed=false)', async () => {
    await makeTabsStore('tab-1')
    const { useStreamEvents } = await import('@renderer/composables/useStreamEvents')
    const { collapsed, toggleCollapsed } = useStreamEvents('tab-1')

    toggleCollapsed('key-1')
    expect(collapsed.value['key-1']).toBe(true)
  })

  it('toggleCollapsed sets key to false when already true', async () => {
    await makeTabsStore('tab-1')
    const { useStreamEvents } = await import('@renderer/composables/useStreamEvents')
    const { collapsed, toggleCollapsed } = useStreamEvents('tab-1')

    collapsed.value['key-1'] = true
    toggleCollapsed('key-1')
    expect(collapsed.value['key-1']).toBe(false)
  })

  it('toggleCollapsed sets key to true when already false', async () => {
    await makeTabsStore('tab-1')
    const { useStreamEvents } = await import('@renderer/composables/useStreamEvents')
    const { collapsed, toggleCollapsed } = useStreamEvents('tab-1')

    collapsed.value['key-1'] = false
    toggleCollapsed('key-1')
    expect(collapsed.value['key-1']).toBe(true)
  })

  it('toggleCollapsed with defaultCollapsed=true: absent key → set to false', async () => {
    await makeTabsStore('tab-1')
    const { useStreamEvents } = await import('@renderer/composables/useStreamEvents')
    const { collapsed, toggleCollapsed } = useStreamEvents('tab-1')

    toggleCollapsed('key-2', true)
    // defaultCollapsed=true, current=true, toggle → false
    expect(collapsed.value['key-2']).toBe(false)
  })

  it('toggleCollapsed with defaultCollapsed=true: present=false → true', async () => {
    await makeTabsStore('tab-1')
    const { useStreamEvents } = await import('@renderer/composables/useStreamEvents')
    const { collapsed, toggleCollapsed } = useStreamEvents('tab-1')

    collapsed.value['key-2'] = false
    toggleCollapsed('key-2', true)
    expect(collapsed.value['key-2']).toBe(true)
  })
})

describe('useStreamEvents — cleanup (L135-L139)', () => {
  beforeEach(() => {
    vi.resetModules()
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.setItem('dbPath', '/test/project.db')
  })

  it('cleanup empties events and collapsed', async () => {
    await makeTabsStore('tab-1')
    const { useStreamEvents } = await import('@renderer/composables/useStreamEvents')
    const { events, collapsed, enqueueEvent, toggleCollapsed, cleanup } = useStreamEvents('tab-1')

    enqueueEvent({ type: 'result', num_turns: 1 })
    enqueueEvent({ type: 'result', num_turns: 2 })
    await nextTick()
    toggleCollapsed('1-tool')

    expect(events.value.length).toBeGreaterThan(0)
    expect(Object.keys(collapsed.value).length).toBeGreaterThan(0)

    cleanup()

    expect(events.value).toHaveLength(0)
    expect(Object.keys(collapsed.value)).toHaveLength(0)
  })
})

describe('useStreamEvents — micro-batching (enqueueEvent)', () => {
  beforeEach(() => {
    vi.resetModules()
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.setItem('dbPath', '/test/project.db')
  })

  it('multiple enqueued events are batched and flushed together', async () => {
    await makeTabsStore('tab-1')
    const { useStreamEvents } = await import('@renderer/composables/useStreamEvents')
    const { events, enqueueEvent } = useStreamEvents('tab-1')

    enqueueEvent({ type: 'result', num_turns: 1 })
    enqueueEvent({ type: 'result', num_turns: 2 })
    enqueueEvent({ type: 'result', num_turns: 3 })

    // Before flush — events may still be empty (batched)
    await nextTick()

    expect(events.value).toHaveLength(3)
  })

  it('events get monotonically increasing _id after flush', async () => {
    await makeTabsStore('tab-1')
    const { useStreamEvents } = await import('@renderer/composables/useStreamEvents')
    const { events, enqueueEvent } = useStreamEvents('tab-1')

    enqueueEvent({ type: 'result', num_turns: 1 })
    enqueueEvent({ type: 'result', num_turns: 2 })
    await nextTick()

    expect(events.value[0]._id).toBe(1)
    expect(events.value[1]._id).toBe(2)
  })

  it('flushEvents with pendingEvents empty resets flushPending without adding events', async () => {
    await makeTabsStore('tab-1')
    const { useStreamEvents } = await import('@renderer/composables/useStreamEvents')
    const { events, flushEvents } = useStreamEvents('tab-1')

    flushEvents()
    await nextTick()

    expect(events.value).toHaveLength(0)
  })
})

describe('useStreamEvents — exported constants', () => {
  it('MAX_EVENTS equals 2000', async () => {
    const { MAX_EVENTS } = await import('@renderer/composables/useStreamEvents')
    expect(MAX_EVENTS).toBe(2000)
  })

  it('MAX_EVENTS_HIDDEN equals 200', async () => {
    const { MAX_EVENTS_HIDDEN } = await import('@renderer/composables/useStreamEvents')
    expect(MAX_EVENTS_HIDDEN).toBe(200)
  })
})
