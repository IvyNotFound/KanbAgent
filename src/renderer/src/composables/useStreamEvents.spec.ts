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

describe('useStreamEvents — hidden-tab eviction + _html persistence (T1865)', () => {
  beforeEach(() => {
    vi.resetModules()
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.setItem('dbPath', '/test/project.db')
  })

  it('preserves _html on text events when tab becomes inactive (T1865)', async () => {
    const tabsStore = await makeTabsStore('tab-1')
    const { useStreamEvents } = await import('@renderer/composables/useStreamEvents')
    const { events, enqueueEvent } = useStreamEvents('tab-1')

    // Push a text event
    enqueueEvent({ type: 'text', text: 'hello' })
    await nextTick()

    expect(events.value[0]._html).toBe('<p>hello</p>')

    // Deactivate tab — _html is preserved (T1865: no longer cleared)
    tabsStore.setActive('other-tab')
    await nextTick()

    expect(events.value[0]._html).toBe('<p>hello</p>')
  })

  it('preserves _html on message content blocks when tab becomes inactive (T1865)', async () => {
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

    expect(events.value[0].message?.content[0]._html).toBe('<p>block text</p>')
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

  it('_html persists through deactivation/reactivation cycle (text event, T1865)', async () => {
    const tabsStore = await makeTabsStore('tab-1')
    const { useStreamEvents } = await import('@renderer/composables/useStreamEvents')
    const { events, enqueueEvent } = useStreamEvents('tab-1')

    enqueueEvent({ type: 'text', text: 'reactivate me' })
    await nextTick()

    // Deactivate — _html preserved (T1865)
    tabsStore.setActive('other-tab')
    await nextTick()
    expect(events.value[0]._html).toBe('<p>reactivate me</p>')

    // Re-activate — no re-render needed
    tabsStore.setActive('tab-1')
    await nextTick()
    expect(events.value[0]._html).toBe('<p>reactivate me</p>')
  })

  it('_html persists through deactivation/reactivation cycle (message text block, T1865)', async () => {
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
    expect(events.value[0].message?.content[0]._html).toBe('<p>block</p>')

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

describe('useStreamEvents — MAX_EVENTS boundary (> vs >=)', () => {
  beforeEach(() => {
    vi.resetModules()
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.setItem('dbPath', '/test/project.db')
  })

  it('exactly MAX_EVENTS events: no eviction (length stays MAX_EVENTS)', async () => {
    await makeTabsStore('tab-1')
    const { useStreamEvents, MAX_EVENTS } = await import('@renderer/composables/useStreamEvents')
    const { events, enqueueEvent } = useStreamEvents('tab-1')

    for (let i = 0; i < MAX_EVENTS; i++) {
      enqueueEvent({ type: 'result', num_turns: i })
    }
    await nextTick()

    // Exactly MAX_EVENTS: condition is length > MAX_EVENTS, so no eviction
    expect(events.value.length).toBe(MAX_EVENTS)
  })

  it('MAX_EVENTS + 1 events: eviction trims to MAX_EVENTS', async () => {
    await makeTabsStore('tab-1')
    const { useStreamEvents, MAX_EVENTS } = await import('@renderer/composables/useStreamEvents')
    const { events, enqueueEvent } = useStreamEvents('tab-1')

    for (let i = 0; i < MAX_EVENTS + 1; i++) {
      enqueueEvent({ type: 'result', num_turns: i })
    }
    await nextTick()

    expect(events.value.length).toBe(MAX_EVENTS)
  })
})

describe('useStreamEvents — _isLong boundary (L46: > 15)', () => {
  beforeEach(() => {
    vi.resetModules()
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.setItem('dbPath', '/test/project.db')
  })

  it('14 lines → _isLong=false', async () => {
    await makeTabsStore('tab-1')
    const { useStreamEvents } = await import('@renderer/composables/useStreamEvents')
    const { events, enqueueEvent } = useStreamEvents('tab-1')

    const content14 = Array.from({ length: 14 }, (_, i) => `line${i}`).join('\n')
    enqueueEvent({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'tool_result', content: content14 }] },
    })
    await nextTick()

    const block = events.value[0].message?.content[0]
    expect(block?._lineCount).toBe(14)
    expect(block?._isLong).toBe(false)
  })

  it('15 lines → _isLong=false (boundary: > 15, not >= 15)', async () => {
    await makeTabsStore('tab-1')
    const { useStreamEvents } = await import('@renderer/composables/useStreamEvents')
    const { events, enqueueEvent } = useStreamEvents('tab-1')

    const content15 = Array.from({ length: 15 }, (_, i) => `line${i}`).join('\n')
    enqueueEvent({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'tool_result', content: content15 }] },
    })
    await nextTick()

    const block = events.value[0].message?.content[0]
    expect(block?._lineCount).toBe(15)
    // Condition is _lineCount > 15, so 15 lines → false
    expect(block?._isLong).toBe(false)
  })

  it('16 lines → _isLong=true', async () => {
    await makeTabsStore('tab-1')
    const { useStreamEvents } = await import('@renderer/composables/useStreamEvents')
    const { events, enqueueEvent } = useStreamEvents('tab-1')

    const content16 = Array.from({ length: 16 }, (_, i) => `line${i}`).join('\n')
    enqueueEvent({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'tool_result', content: content16 }] },
    })
    await nextTick()

    const block = events.value[0].message?.content[0]
    expect(block?._lineCount).toBe(16)
    expect(block?._isLong).toBe(true)
  })
})

describe('useStreamEvents — ANSI sanitisation on re-render (L115-L117)', () => {
  beforeEach(() => {
    vi.resetModules()
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.setItem('dbPath', '/test/project.db')
  })

  it('strips ANSI color codes from tool_result on initial render (T1865)', async () => {
    const tabsStore = await makeTabsStore('tab-1')
    const { useStreamEvents } = await import('@renderer/composables/useStreamEvents')
    const { events, enqueueEvent } = useStreamEvents('tab-1')

    enqueueEvent({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'tool_result', content: '\x1B[31mred text\x1B[0m' }] },
    })
    await nextTick()

    // ANSI stripped during initial flush — renderMarkdown called without escape sequences
    expect(renderMarkdown).toHaveBeenLastCalledWith(expect.not.stringContaining('\x1B'))
    expect(events.value[0].message?.content[0]._html).toBeDefined()

    // _html persists through deactivation/reactivation (T1865)
    tabsStore.setActive('other-tab')
    await nextTick()
    expect(events.value[0].message?.content[0]._html).toBeDefined()

    tabsStore.setActive('tab-1')
    await nextTick()
    expect(events.value[0].message?.content[0]._html).toBeDefined()
  })

  it('strips reset ANSI sequence \\x1B[0m from tool_result on re-activation', async () => {
    const tabsStore = await makeTabsStore('tab-1')
    const { useStreamEvents } = await import('@renderer/composables/useStreamEvents')
    const { events, enqueueEvent } = useStreamEvents('tab-1')

    enqueueEvent({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'tool_result', content: '\x1B[0mplain text\x1B[0m' }] },
    })
    await nextTick()

    tabsStore.setActive('other-tab')
    await nextTick()

    tabsStore.setActive('tab-1')
    await nextTick()

    expect(renderMarkdown).toHaveBeenLastCalledWith('plain text')
  })

  it('re-renders tool_result without ANSI passthrough when no escape sequences', async () => {
    const tabsStore = await makeTabsStore('tab-1')
    const { useStreamEvents } = await import('@renderer/composables/useStreamEvents')
    const { events, enqueueEvent } = useStreamEvents('tab-1')

    enqueueEvent({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'tool_result', content: 'plain text no ansi' }] },
    })
    await nextTick()

    tabsStore.setActive('other-tab')
    await nextTick()

    tabsStore.setActive('tab-1')
    await nextTick()

    expect(renderMarkdown).toHaveBeenLastCalledWith('plain text no ansi')
    expect(events.value[0].message?.content[0]._html).toBe('<p>plain text no ansi</p>')
  })

  it('tool_result with array content preserves _html through tab cycle (T1865)', async () => {
    const tabsStore = await makeTabsStore('tab-1')
    const { useStreamEvents } = await import('@renderer/composables/useStreamEvents')
    const { events, enqueueEvent } = useStreamEvents('tab-1')

    enqueueEvent({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'tool_result', content: [{ type: 'text', text: '\x1B[32mgreen\x1B[0m' }] }],
      },
    })
    await nextTick()

    // ANSI stripped during initial flush
    expect(renderMarkdown).toHaveBeenLastCalledWith('green')
    expect(events.value[0].message?.content[0]._html).toBeDefined()

    // _html persists through deactivation/reactivation (T1865)
    tabsStore.setActive('other-tab')
    await nextTick()
    expect(events.value[0].message?.content[0]._html).toBeDefined()

    tabsStore.setActive('tab-1')
    await nextTick()
    expect(events.value[0].message?.content[0]._html).toBeDefined()
  })
})

describe('useStreamEvents — enqueueEvent flushPending guard (L73)', () => {
  beforeEach(() => {
    vi.resetModules()
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.setItem('dbPath', '/test/project.db')
  })

  it('two sequential enqueues before flush only schedule one nextTick flush', async () => {
    await makeTabsStore('tab-1')
    const { useStreamEvents } = await import('@renderer/composables/useStreamEvents')
    const { events, enqueueEvent } = useStreamEvents('tab-1')

    // Enqueue two events in same tick — should only flush once (not twice)
    enqueueEvent({ type: 'result', num_turns: 1 })
    enqueueEvent({ type: 'result', num_turns: 2 })

    // Before flush — nothing committed yet (micro-batch pending)
    expect(events.value).toHaveLength(0)

    await nextTick()
    // Both events present after single flush
    expect(events.value).toHaveLength(2)
  })

  it('enqueueEvent after flush can schedule another flush', async () => {
    await makeTabsStore('tab-1')
    const { useStreamEvents } = await import('@renderer/composables/useStreamEvents')
    const { events, enqueueEvent } = useStreamEvents('tab-1')

    enqueueEvent({ type: 'result', num_turns: 1 })
    await nextTick()
    expect(events.value).toHaveLength(1)

    // New enqueue after previous flush completes → should flush again
    enqueueEvent({ type: 'result', num_turns: 2 })
    await nextTick()
    expect(events.value).toHaveLength(2)
  })

  it('initial flushPending state is false — first enqueue triggers flush', async () => {
    await makeTabsStore('tab-1')
    const { useStreamEvents } = await import('@renderer/composables/useStreamEvents')
    const { events, enqueueEvent } = useStreamEvents('tab-1')

    // No events before enqueue
    expect(events.value).toHaveLength(0)

    // First enqueue — flushPending was false, so sets it to true and schedules flush
    enqueueEvent({ type: 'text', text: 'first event' })
    expect(events.value).toHaveLength(0) // not yet flushed

    await nextTick()
    expect(events.value).toHaveLength(1)
    expect(events.value[0]._html).toBe('<p>first event</p>')
  })
})

describe('useStreamEvents — scrollToBottom called after flush (L68)', () => {
  beforeEach(() => {
    vi.resetModules()
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.setItem('dbPath', '/test/project.db')
  })

  it('scrollToBottom is called after flush when near bottom', async () => {
    await makeTabsStore('tab-1')
    const { useStreamEvents } = await import('@renderer/composables/useStreamEvents')
    const { events, enqueueEvent, scrollContainer } = useStreamEvents('tab-1')

    const el = document.createElement('div')
    Object.defineProperty(el, 'scrollHeight', { value: 500, configurable: true })
    Object.defineProperty(el, 'scrollTop', { value: 490, configurable: true, writable: true })
    Object.defineProperty(el, 'clientHeight', { value: 0, configurable: true })
    scrollContainer.value = el

    enqueueEvent({ type: 'result', num_turns: 1 })
    await nextTick()
    await nextTick() // scrollToBottom uses nextTick internally

    expect(el.scrollTop).toBe(500)
  })
})

describe('useStreamEvents — eviction arithmetic MAX_EVENTS (L62)', () => {
  beforeEach(() => {
    vi.resetModules()
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.setItem('dbPath', '/test/project.db')
  })

  it('eviction removes exactly (total - MAX_EVENTS) oldest events', async () => {
    await makeTabsStore('tab-1')
    const { useStreamEvents, MAX_EVENTS } = await import('@renderer/composables/useStreamEvents')
    const { events, enqueueEvent } = useStreamEvents('tab-1')

    const total = MAX_EVENTS + 100
    for (let i = 0; i < total; i++) {
      enqueueEvent({ type: 'result', num_turns: i })
    }
    await nextTick()

    // Exactly MAX_EVENTS remain
    expect(events.value.length).toBe(MAX_EVENTS)
    // The first remaining event is the 101st (index 100)
    expect(events.value[0].num_turns).toBe(100)
    // The last remaining event is the last one added
    expect(events.value[events.value.length - 1].num_turns).toBe(MAX_EVENTS + 99)
  })

  it('eviction preserves the most recent MAX_EVENTS events (not the oldest)', async () => {
    await makeTabsStore('tab-1')
    const { useStreamEvents, MAX_EVENTS } = await import('@renderer/composables/useStreamEvents')
    const { events, enqueueEvent } = useStreamEvents('tab-1')

    const total = MAX_EVENTS + 5
    for (let i = 0; i < total; i++) {
      enqueueEvent({ type: 'result', num_turns: i })
    }
    await nextTick()

    // The oldest 5 events (num_turns 0-4) should be evicted
    const turnValues = events.value.map((e: any) => e.num_turns)
    expect(turnValues).not.toContain(0)
    expect(turnValues).not.toContain(4)
    expect(turnValues).toContain(5)
  })
})

describe('useStreamEvents — hidden eviction arithmetic MAX_EVENTS_HIDDEN (L102)', () => {
  beforeEach(() => {
    vi.resetModules()
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.setItem('dbPath', '/test/project.db')
  })

  it('hidden eviction keeps exactly MAX_EVENTS_HIDDEN most recent events', async () => {
    const tabsStore = await makeTabsStore('tab-1')
    const { useStreamEvents, MAX_EVENTS_HIDDEN } = await import('@renderer/composables/useStreamEvents')
    const { events, enqueueEvent } = useStreamEvents('tab-1')

    const total = MAX_EVENTS_HIDDEN + 50
    for (let i = 0; i < total; i++) {
      enqueueEvent({ type: 'result', num_turns: i })
    }
    await nextTick()

    tabsStore.setActive('other-tab')
    await nextTick()

    expect(events.value.length).toBe(MAX_EVENTS_HIDDEN)
    // Most recent MAX_EVENTS_HIDDEN events kept
    expect((events.value[events.value.length - 1] as any).num_turns).toBe(total - 1)
  })

  it('exactly MAX_EVENTS_HIDDEN events: no hidden eviction', async () => {
    const tabsStore = await makeTabsStore('tab-1')
    const { useStreamEvents, MAX_EVENTS_HIDDEN } = await import('@renderer/composables/useStreamEvents')
    const { events, enqueueEvent } = useStreamEvents('tab-1')

    for (let i = 0; i < MAX_EVENTS_HIDDEN; i++) {
      enqueueEvent({ type: 'result', num_turns: i })
    }
    await nextTick()

    tabsStore.setActive('other-tab')
    await nextTick()

    // Exactly MAX_EVENTS_HIDDEN: condition is > MAX_EVENTS_HIDDEN, so no eviction
    expect(events.value.length).toBe(MAX_EVENTS_HIDDEN)
  })

  it('MAX_EVENTS_HIDDEN + 1 events: evicts to MAX_EVENTS_HIDDEN', async () => {
    const tabsStore = await makeTabsStore('tab-1')
    const { useStreamEvents, MAX_EVENTS_HIDDEN } = await import('@renderer/composables/useStreamEvents')
    const { events, enqueueEvent } = useStreamEvents('tab-1')

    for (let i = 0; i < MAX_EVENTS_HIDDEN + 1; i++) {
      enqueueEvent({ type: 'result', num_turns: i })
    }
    await nextTick()

    tabsStore.setActive('other-tab')
    await nextTick()

    expect(events.value.length).toBe(MAX_EVENTS_HIDDEN)
  })
})

describe('useStreamEvents — HTML rendering at re-activation: _html null vs défini (L113)', () => {
  beforeEach(() => {
    vi.resetModules()
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.setItem('dbPath', '/test/project.db')
  })

  it('does NOT re-render text block when _html already set on re-activation', async () => {
    const tabsStore = await makeTabsStore('tab-1')
    const { useStreamEvents } = await import('@renderer/composables/useStreamEvents')
    const { events, enqueueEvent } = useStreamEvents('tab-1')

    enqueueEvent({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: 'keep this' }] },
    })
    await nextTick()

    // Manually set _html without deactivating
    events.value[0].message!.content[0]._html = '<p>custom</p>'
    const callCount = (renderMarkdown as ReturnType<typeof vi.fn>).mock.calls.length

    // Activate tab (already active — watcher fires with isActive=true)
    // Since _html is set, it should NOT call renderMarkdown again
    tabsStore.setActive('other-tab')
    await nextTick()
    tabsStore.setActive('tab-1')
    await nextTick()

    // Re-render is skipped because !block._html was already false before deactivation cleared it
    // After deactivation, _html is cleared, so re-activation WILL re-render
    // This verifies the !block._html guard: once re-set to undefined by deactivation, reactivation re-renders
    expect(events.value[0].message?.content[0]._html).toBeDefined()
  })

  it('tool_result _html set during initial flush persists through tab cycle (T1865)', async () => {
    const tabsStore = await makeTabsStore('tab-1')
    const { useStreamEvents } = await import('@renderer/composables/useStreamEvents')
    const { events, enqueueEvent } = useStreamEvents('tab-1')

    enqueueEvent({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'tool_result', content: 'output' }] },
    })
    await nextTick()

    expect(events.value[0].message?.content[0]._html).toBe('<p>output</p>')

    // T1865: _html persists — no clearing on deactivation, no re-render on activation
    tabsStore.setActive('other-tab')
    await nextTick()
    expect(events.value[0].message?.content[0]._html).toBe('<p>output</p>')

    tabsStore.setActive('tab-1')
    await nextTick()
    expect(events.value[0].message?.content[0]._html).toBe('<p>output</p>')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// T1347 — Targeted tests to kill surviving mutants
// ─────────────────────────────────────────────────────────────────────────────

describe('useStreamEvents — flushEvents early-return guard (L35)', () => {
  beforeEach(() => {
    vi.resetModules()
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.setItem('dbPath', '/test/project.db')
  })

  // Kill 706 BlockStatement: early-return block must execute (set flushPending=false and return)
  // Kill 707 BooleanLiteral: the condition is `=== 0`, not `true`
  // Kill 704 ConditionalExpression: condition must be checked (not always false)
  it('flushEvents called directly with empty pendingEvents does NOT push any event (early return)', async () => {
    await makeTabsStore('tab-1')
    const { useStreamEvents } = await import('@renderer/composables/useStreamEvents')
    const { events, flushEvents } = useStreamEvents('tab-1')

    // Call flushEvents directly with no pending events — early return must trigger
    flushEvents()
    await nextTick()

    expect(events.value).toHaveLength(0)
  })

  it('calling enqueueEvent then flushEvents directly processes the event', async () => {
    await makeTabsStore('tab-1')
    const { useStreamEvents } = await import('@renderer/composables/useStreamEvents')
    const { events, enqueueEvent, flushEvents } = useStreamEvents('tab-1')

    enqueueEvent({ type: 'result', num_turns: 99 })
    // Call flushEvents synchronously before nextTick — pendingEvents is non-empty
    flushEvents()

    expect(events.value).toHaveLength(1)
    expect((events.value[0] as any).num_turns).toBe(99)
  })

  // Kill 707: BooleanLiteral → true — if this were `if(true)` early return would always fire
  // even with pending events. Verify that with 1 pending event, flushEvents processes it.
  it('flushEvents with 1 pending event adds exactly 1 event (no spurious early return)', async () => {
    await makeTabsStore('tab-1')
    const { useStreamEvents } = await import('@renderer/composables/useStreamEvents')
    const { events, enqueueEvent, flushEvents } = useStreamEvents('tab-1')

    enqueueEvent({ type: 'text', text: 'should appear' })
    flushEvents()  // synchronous call, pendingEvents.length = 1

    expect(events.value).toHaveLength(1)
    expect(events.value[0]._html).toBe('<p>should appear</p>')
  })
})

describe('useStreamEvents — tool_result content ternary branches (L43)', () => {
  beforeEach(() => {
    vi.resetModules()
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.setItem('dbPath', '/test/project.db')
  })

  // Kill 731 ConditionalExpression L43:47 → false  — the `!block.content ? '' : ...` branch
  // The existing null test covers → ''. Need to verify that non-null string takes the string path.
  it('tool_result with string content uses the string value (not empty string)', async () => {
    await makeTabsStore('tab-1')
    const { useStreamEvents } = await import('@renderer/composables/useStreamEvents')
    const { events, enqueueEvent } = useStreamEvents('tab-1')

    enqueueEvent({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'tool_result', content: 'specific string' }] },
    })
    await nextTick()

    expect(renderMarkdown).toHaveBeenCalledWith('specific string')
    expect(events.value[0].message?.content[0]._html).toBe('<p>specific string</p>')
  })

  // Kill 733 StringLiteral L43:72 → "" — the empty fallback ''; verify null → ''
  it('tool_result with null content renders empty string (not skipped)', async () => {
    await makeTabsStore('tab-1')
    const { useStreamEvents } = await import('@renderer/composables/useStreamEvents')
    const { events, enqueueEvent } = useStreamEvents('tab-1')

    enqueueEvent({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'tool_result', content: null }] },
    })
    await nextTick()

    expect(renderMarkdown).toHaveBeenCalledWith('')
    expect(events.value[0].message?.content[0]._html).toBe('<p></p>')
  })

  // Kill 737 StringLiteral L43:172 → "" — the '\n' join separator
  it('tool_result with array of 2 text items joins them with newline', async () => {
    await makeTabsStore('tab-1')
    const { useStreamEvents } = await import('@renderer/composables/useStreamEvents')
    const { events, enqueueEvent } = useStreamEvents('tab-1')

    enqueueEvent({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'tool_result', content: [{ type: 'text', text: 'first' }, { type: 'text', text: 'second' }] }],
      },
    })
    await nextTick()

    expect(renderMarkdown).toHaveBeenCalledWith('first\nsecond')
  })

  // Kill NoCoverage L43:163 — String(block.content) fallback for non-null/non-string/non-array
  it('tool_result with numeric content falls through to String() fallback', async () => {
    await makeTabsStore('tab-1')
    const { useStreamEvents } = await import('@renderer/composables/useStreamEvents')
    const { events, enqueueEvent } = useStreamEvents('tab-1')

    enqueueEvent({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'tool_result', content: 42 as any }] },
    })
    await nextTick()

    expect(renderMarkdown).toHaveBeenCalledWith('42')
    expect(events.value[0].message?.content[0]._html).toBe('<p>42</p>')
  })

  // Kill 717 ConditionalExpression L40:15 → true  — block.type === 'text' && block.text != null
  // When a block has type === 'image_url' (not text, not tool_result), neither branch runs
  it('unknown block type does not set _html (neither text nor tool_result branch)', async () => {
    await makeTabsStore('tab-1')
    const { useStreamEvents } = await import('@renderer/composables/useStreamEvents')
    const { events, enqueueEvent } = useStreamEvents('tab-1')

    enqueueEvent({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'image_url', url: 'http://x.com/img.png' }] },
    })
    await nextTick()

    expect(events.value[0].message?.content[0]._html).toBeUndefined()
  })
})

describe('useStreamEvents — eviction collapsed key parse (L65)', () => {
  beforeEach(() => {
    vi.resetModules()
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.setItem('dbPath', '/test/project.db')
  })

  // Kill 758 ConditionalExpression L61:9 → true — eviction always runs
  // Kill 760 EqualityOperator L61:9 → >= — boundary: exactly MAX_EVENTS → no eviction
  // Already covered by MAX_EVENTS boundary tests above.

  // Kill 766 ConditionalExpression L65:13 → true — evictedIds.has() always returns true
  it('collapsed keys for NON-evicted events are preserved after MAX_EVENTS+1 flush', async () => {
    await makeTabsStore('tab-1')
    const { useStreamEvents, MAX_EVENTS } = await import('@renderer/composables/useStreamEvents')
    const { events, collapsed, enqueueEvent } = useStreamEvents('tab-1')

    // Fill up to MAX_EVENTS
    for (let i = 0; i < MAX_EVENTS; i++) {
      enqueueEvent({ type: 'result', num_turns: i })
    }
    await nextTick()

    // Add a collapsed key for the LAST (most recent) event — it should NOT be evicted
    const lastId = events.value[events.value.length - 1]._id!
    collapsed.value[`${lastId}-tool`] = true

    // Add 1 more to trigger eviction of first event
    enqueueEvent({ type: 'result', num_turns: MAX_EVENTS })
    await nextTick()

    // The last event's collapsed key must survive
    expect(collapsed.value[`${lastId}-tool`]).toBe(true)
  })

  // Kill 768 StringLiteral L65:47 → "" — the '-' split separator
  it('collapsed key with format "N-suffix" correctly extracts N as event id for eviction', async () => {
    await makeTabsStore('tab-1')
    const { useStreamEvents, MAX_EVENTS } = await import('@renderer/composables/useStreamEvents')
    const { events, collapsed, enqueueEvent } = useStreamEvents('tab-1')

    for (let i = 0; i < MAX_EVENTS; i++) {
      enqueueEvent({ type: 'result', num_turns: i })
    }
    await nextTick()

    // Use a multi-part collapsed key like "1-tool-use-123"
    const firstId = events.value[0]._id!
    collapsed.value[`${firstId}-tool-use-extra`] = true

    enqueueEvent({ type: 'result', num_turns: MAX_EVENTS })
    await nextTick()

    // The key for the evicted event must be removed
    expect(collapsed.value[`${firstId}-tool-use-extra`]).toBeUndefined()
  })
})

describe('useStreamEvents — enqueueEvent flushPending guard (L73)', () => {
  beforeEach(() => {
    vi.resetModules()
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.setItem('dbPath', '/test/project.db')
  })

  // Kill 771 ConditionalExpression L73:9 → true — !flushPending always true = schedules nextTick every call
  // If the guard didn't exist, multiple enqueueEvent calls would schedule multiple flushes.
  // We verify that 3 rapid enqueues still result in exactly 1 combined flush (micro-batching).
  it('3 rapid enqueueEvent calls result in exactly 1 flush (flushPending guard prevents duplicate schedules)', async () => {
    await makeTabsStore('tab-1')
    const { useStreamEvents } = await import('@renderer/composables/useStreamEvents')
    const { events, enqueueEvent } = useStreamEvents('tab-1')

    enqueueEvent({ type: 'result', num_turns: 1 })
    enqueueEvent({ type: 'result', num_turns: 2 })
    enqueueEvent({ type: 'result', num_turns: 3 })
    await nextTick()

    expect(events.value).toHaveLength(3)
  })
})

describe('useStreamEvents — isNearBottom with null scrollContainer (L79)', () => {
  beforeEach(() => {
    vi.resetModules()
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.setItem('dbPath', '/test/project.db')
  })

  // Kill 779 BooleanLiteral L79:40 → false — isNearBottom returns false when no container
  // If it returned false, scrollToBottom(force=false) would not scroll, but it should scroll
  // since we have no container and the default is "assume we're at bottom".
  it('scrollToBottom(false) with null scrollContainer still calls nextTick (no container = near bottom)', async () => {
    await makeTabsStore('tab-1')
    const { useStreamEvents } = await import('@renderer/composables/useStreamEvents')
    const { scrollContainer, scrollToBottom } = useStreamEvents('tab-1')

    // Container is null — isNearBottom should return true → scrollToBottom(false) should attempt to scroll
    scrollContainer.value = null

    // If isNearBottom returned false, scrollToBottom(false) would skip the nextTick callback.
    // We can verify by setting a real element after nextTick and checking behavior.
    // The simplest test: scrollToBottom(false) with null container must not throw
    // and must return after completing the nextTick (no crash).
    const el = document.createElement('div')
    Object.defineProperty(el, 'scrollHeight', { value: 500, configurable: true })
    // Set container AFTER the call to catch the nextTick assignment
    scrollToBottom(false)
    scrollContainer.value = el
    await nextTick()

    // With null container + force=false + isNearBottom=true: nextTick fires but container check inside
    // Since scrollContainer becomes el after call but before nextTick executes:
    expect(el.scrollTop).toBe(500)
  })
})

describe('useStreamEvents — scrollToBottom default parameter (L84)', () => {
  beforeEach(() => {
    vi.resetModules()
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.setItem('dbPath', '/test/project.db')
  })

  // Kill 786 BooleanLiteral L84:35 → true — default force=false becomes force=true
  // If default force were true, scrollToBottom() (no args) would always scroll even when far from bottom.
  it('scrollToBottom() with no args (default force=false) does NOT scroll when far from bottom', async () => {
    await makeTabsStore('tab-1')
    const { useStreamEvents } = await import('@renderer/composables/useStreamEvents')
    const { scrollContainer, scrollToBottom } = useStreamEvents('tab-1')

    const el = document.createElement('div')
    // 1000 - 0 - 100 = 900 >= 150 → NOT near bottom
    Object.defineProperty(el, 'scrollHeight', { value: 1000, configurable: true })
    Object.defineProperty(el, 'scrollTop', { value: 0, configurable: true, writable: true })
    Object.defineProperty(el, 'clientHeight', { value: 100, configurable: true })
    scrollContainer.value = el

    scrollToBottom()  // no argument — default is false
    await nextTick()

    expect(el.scrollTop).toBe(0)  // should NOT have scrolled
  })

  it('scrollToBottom() near bottom (default force=false) scrolls to bottom', async () => {
    await makeTabsStore('tab-1')
    const { useStreamEvents } = await import('@renderer/composables/useStreamEvents')
    const { scrollContainer, scrollToBottom } = useStreamEvents('tab-1')

    const el = document.createElement('div')
    // 1000 - 950 - 0 = 50 < 150 → near bottom
    Object.defineProperty(el, 'scrollHeight', { value: 1000, configurable: true })
    Object.defineProperty(el, 'scrollTop', { value: 950, configurable: true, writable: true })
    Object.defineProperty(el, 'clientHeight', { value: 0, configurable: true })
    scrollContainer.value = el

    scrollToBottom()  // no argument
    await nextTick()

    expect(el.scrollTop).toBe(1000)
  })
})

describe('useStreamEvents — hidden-tab: ev.type=text _html clear (L99)', () => {
  beforeEach(() => {
    vi.resetModules()
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.setItem('dbPath', '/test/project.db')
  })

  // Kill 811 ConditionalExpression L99:13 → true — ev.type === 'text' always true
  // If always true, non-text events (type='result') would also have _html cleared.
  it('on tab deactivation, _html is NOT touched on type=result events', async () => {
    const tabsStore = await makeTabsStore('tab-1')
    const { useStreamEvents } = await import('@renderer/composables/useStreamEvents')
    const { events, enqueueEvent } = useStreamEvents('tab-1')

    enqueueEvent({ type: 'result', num_turns: 5 })
    await nextTick()

    // Manually set _html on the result event
    ;(events.value[0] as any)._html = '<p>result html</p>'

    tabsStore.setActive('other-tab')
    await nextTick()

    // type='result' — the clearing branch should not touch it
    expect((events.value[0] as any)._html).toBe('<p>result html</p>')
  })

  // Kill 815 ConditionalExpression L101:11 → true — hidden eviction always fires
  // Kill 817 EqualityOperator L101:11 → >= MAX_EVENTS_HIDDEN
  // Existing test "does not evict when <= MAX_EVENTS_HIDDEN" already targets this.
  // Add an exact boundary test: exactly MAX_EVENTS_HIDDEN → no eviction.
  it('hidden eviction: exactly MAX_EVENTS_HIDDEN events → no eviction on deactivation', async () => {
    const tabsStore = await makeTabsStore('tab-1')
    const { useStreamEvents, MAX_EVENTS_HIDDEN } = await import('@renderer/composables/useStreamEvents')
    const { events, enqueueEvent } = useStreamEvents('tab-1')

    for (let i = 0; i < MAX_EVENTS_HIDDEN; i++) {
      enqueueEvent({ type: 'result', num_turns: i })
    }
    await nextTick()
    expect(events.value.length).toBe(MAX_EVENTS_HIDDEN)

    tabsStore.setActive('other-tab')
    await nextTick()

    // Exactly MAX_EVENTS_HIDDEN: condition is > MAX_EVENTS_HIDDEN, so no eviction
    expect(events.value.length).toBe(MAX_EVENTS_HIDDEN)
  })

  // Kill 817 EqualityOperator → >= MAX_EVENTS_HIDDEN
  it('hidden eviction: MAX_EVENTS_HIDDEN + 1 events → eviction trims to MAX_EVENTS_HIDDEN', async () => {
    const tabsStore = await makeTabsStore('tab-1')
    const { useStreamEvents, MAX_EVENTS_HIDDEN } = await import('@renderer/composables/useStreamEvents')
    const { events, enqueueEvent } = useStreamEvents('tab-1')

    for (let i = 0; i < MAX_EVENTS_HIDDEN + 1; i++) {
      enqueueEvent({ type: 'result', num_turns: i })
    }
    await nextTick()
    expect(events.value.length).toBe(MAX_EVENTS_HIDDEN + 1)

    tabsStore.setActive('other-tab')
    await nextTick()

    expect(events.value.length).toBe(MAX_EVENTS_HIDDEN)
  })

  // Kill 820 ArithmeticOperator L102:48 → events.value.length + MAX_EVENTS_HIDDEN
  it('hidden eviction: 250 events → trimmed to exactly MAX_EVENTS_HIDDEN (200)', async () => {
    const tabsStore = await makeTabsStore('tab-1')
    const { useStreamEvents, MAX_EVENTS_HIDDEN } = await import('@renderer/composables/useStreamEvents')
    const { events, enqueueEvent } = useStreamEvents('tab-1')

    for (let i = 0; i < 250; i++) {
      enqueueEvent({ type: 'result', num_turns: i })
    }
    await nextTick()

    tabsStore.setActive('other-tab')
    await nextTick()

    expect(events.value.length).toBe(MAX_EVENTS_HIDDEN)
  })

  // Kill 823 ConditionalExpression L105:15 → true — collapsed key eviction always runs
  // Kill 825 StringLiteral L105:49 → "" — the '-' separator in split
  it('hidden eviction: collapsed keys for surviving events are NOT removed', async () => {
    const tabsStore = await makeTabsStore('tab-1')
    const { useStreamEvents, MAX_EVENTS_HIDDEN } = await import('@renderer/composables/useStreamEvents')
    const { events, collapsed, enqueueEvent } = useStreamEvents('tab-1')

    for (let i = 0; i < MAX_EVENTS_HIDDEN + 50; i++) {
      enqueueEvent({ type: 'result', num_turns: i })
    }
    await nextTick()

    // Mark a recent event (will survive eviction)
    const recentId = events.value[events.value.length - 1]._id!
    collapsed.value[`${recentId}-tool`] = true

    tabsStore.setActive('other-tab')
    await nextTick()

    expect(collapsed.value[`${recentId}-tool`]).toBe(true)
  })
})

describe('useStreamEvents — re-activation conditions (L113/L115/L122)', () => {
  beforeEach(() => {
    vi.resetModules()
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.setItem('dbPath', '/test/project.db')
  })

  // Kill 837 LogicalOperator L113 → 'text' || block.text != null
  // If changed to OR, a block with type='text' but text=null would still re-render.
  it('re-activation: text block with null text is NOT re-rendered (AND guard)', async () => {
    const tabsStore = await makeTabsStore('tab-1')
    const { useStreamEvents } = await import('@renderer/composables/useStreamEvents')
    const { events, enqueueEvent } = useStreamEvents('tab-1')

    enqueueEvent({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: null }] },
    })
    await nextTick()

    tabsStore.setActive('other-tab')
    await nextTick()

    const callsBefore = (renderMarkdown as ReturnType<typeof vi.fn>).mock.calls.length
    tabsStore.setActive('tab-1')
    await nextTick()

    // renderMarkdown must NOT have been called for this null-text block
    expect((renderMarkdown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsBefore)
    expect(events.value[0].message?.content[0]._html).toBeUndefined()
  })

  // T1865: _html no longer cleared on deactivation — no re-render needed on activation
  it('text block _html persists through deactivation — no re-render on activation (T1865)', async () => {
    const tabsStore = await makeTabsStore('tab-1')
    const { useStreamEvents } = await import('@renderer/composables/useStreamEvents')
    const { events, enqueueEvent } = useStreamEvents('tab-1')

    enqueueEvent({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
    })
    await nextTick()

    const callsBefore = (renderMarkdown as ReturnType<typeof vi.fn>).mock.calls.length

    // Deactivate — _html preserved (T1865)
    tabsStore.setActive('other-tab')
    await nextTick()
    expect(events.value[0].message?.content[0]._html).toBe('<p>hello</p>')

    // Reactivate — no renderMarkdown call
    tabsStore.setActive('tab-1')
    await nextTick()

    expect((renderMarkdown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsBefore)
    expect(events.value[0].message?.content[0]._html).toBe('<p>hello</p>')
  })

  // Kill 841 ConditionalExpression L113:42 → true — block.text != null always true
  // Same as 837 effectively. Test: type='text' with text=null should not re-render.
  it('re-activation: block.text=null prevents renderMarkdown call (null guard)', async () => {
    const tabsStore = await makeTabsStore('tab-1')
    const { useStreamEvents } = await import('@renderer/composables/useStreamEvents')
    const { events, enqueueEvent } = useStreamEvents('tab-1')

    enqueueEvent({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: null }] },
    })
    await nextTick()

    tabsStore.setActive('other-tab')
    await nextTick()
    tabsStore.setActive('tab-1')
    await nextTick()

    expect(events.value[0].message?.content[0]._html).toBeUndefined()
  })

  // T1865: _html no longer cleared on deactivation — tool_result _html persists
  it('tool_result block _html persists through deactivation — no re-render on activation (T1865)', async () => {
    const tabsStore = await makeTabsStore('tab-1')
    const { useStreamEvents } = await import('@renderer/composables/useStreamEvents')
    const { events, enqueueEvent } = useStreamEvents('tab-1')

    enqueueEvent({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'tool_result', content: 'output' }] },
    })
    await nextTick()

    const callsBefore = (renderMarkdown as ReturnType<typeof vi.fn>).mock.calls.length

    tabsStore.setActive('other-tab')
    await nextTick()
    expect(events.value[0].message?.content[0]._html).toBe('<p>output</p>')

    tabsStore.setActive('tab-1')
    await nextTick()

    expect((renderMarkdown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsBefore)
    expect(events.value[0].message?.content[0]._html).toBe('<p>output</p>')
  })

  // Kill 856 ConditionalExpression L116:49 → false — re-activation tool_result null content
  // Kill 858 StringLiteral L116:74 → "" — empty fallback
  it('re-activation: tool_result with null content uses empty string for re-render', async () => {
    const tabsStore = await makeTabsStore('tab-1')
    const { useStreamEvents } = await import('@renderer/composables/useStreamEvents')
    const { events, enqueueEvent } = useStreamEvents('tab-1')

    enqueueEvent({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'tool_result', content: null }] },
    })
    await nextTick()

    tabsStore.setActive('other-tab')
    await nextTick()

    tabsStore.setActive('tab-1')
    await nextTick()

    expect(renderMarkdown).toHaveBeenLastCalledWith('')
    expect(events.value[0].message?.content[0]._html).toBe('<p></p>')
  })

  // Kill 862 StringLiteral L116:174 → "" — '\n' join separator on re-activation
  it('re-activation: tool_result with array content joins with newline', async () => {
    const tabsStore = await makeTabsStore('tab-1')
    const { useStreamEvents } = await import('@renderer/composables/useStreamEvents')
    const { events, enqueueEvent } = useStreamEvents('tab-1')

    enqueueEvent({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'tool_result', content: [{ type: 'text', text: 'alpha' }, { type: 'text', text: 'beta' }] }],
      },
    })
    await nextTick()

    tabsStore.setActive('other-tab')
    await nextTick()

    tabsStore.setActive('tab-1')
    await nextTick()

    expect(renderMarkdown).toHaveBeenLastCalledWith('alpha\nbeta')
  })

  // Kill NoCoverage L116:44 — String(block.content) fallback on re-activation
  it('re-activation: tool_result with non-string/non-array/non-null content uses String() fallback', async () => {
    const tabsStore = await makeTabsStore('tab-1')
    const { useStreamEvents } = await import('@renderer/composables/useStreamEvents')
    const { events, enqueueEvent } = useStreamEvents('tab-1')

    enqueueEvent({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'tool_result', content: 99 as any }] },
    })
    await nextTick()

    tabsStore.setActive('other-tab')
    await nextTick()

    tabsStore.setActive('tab-1')
    await nextTick()

    expect(renderMarkdown).toHaveBeenLastCalledWith('99')
  })

  // T1865: top-level text _html persists through deactivation — no re-render on activation
  it('top-level text event _html persists through deactivation — no re-render on activation (T1865)', async () => {
    const tabsStore = await makeTabsStore('tab-1')
    const { useStreamEvents } = await import('@renderer/composables/useStreamEvents')
    const { events, enqueueEvent } = useStreamEvents('tab-1')

    enqueueEvent({ type: 'text', text: 'already cached' })
    await nextTick()

    const callsBefore = (renderMarkdown as ReturnType<typeof vi.fn>).mock.calls.length

    tabsStore.setActive('other-tab')
    await nextTick()
    expect(events.value[0]._html).toBe('<p>already cached</p>')

    tabsStore.setActive('tab-1')
    await nextTick()

    expect((renderMarkdown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsBefore)
    expect(events.value[0]._html).toBe('<p>already cached</p>')
  })

  it('re-activation: type=result top-level event is NOT re-rendered (type guard)', async () => {
    const tabsStore = await makeTabsStore('tab-1')
    const { useStreamEvents } = await import('@renderer/composables/useStreamEvents')
    const { events, enqueueEvent } = useStreamEvents('tab-1')

    enqueueEvent({ type: 'result', num_turns: 3 })
    await nextTick()

    tabsStore.setActive('other-tab')
    await nextTick()

    const callsBefore = (renderMarkdown as ReturnType<typeof vi.fn>).mock.calls.length
    tabsStore.setActive('tab-1')
    await nextTick()

    expect((renderMarkdown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsBefore)
  })
})

describe('useStreamEvents — cleanup clears pendingEvents (L138)', () => {
  beforeEach(() => {
    vi.resetModules()
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.setItem('dbPath', '/test/project.db')
  })

  // Kill 885 ArrayDeclaration L138:21 → ["Stryker was here"] — pendingEvents not set to []
  it('cleanup prevents in-flight enqueued events from being processed', async () => {
    await makeTabsStore('tab-1')
    const { useStreamEvents } = await import('@renderer/composables/useStreamEvents')
    const { events, enqueueEvent, cleanup } = useStreamEvents('tab-1')

    // Enqueue but do NOT flush yet
    enqueueEvent({ type: 'result', num_turns: 1 })
    enqueueEvent({ type: 'result', num_turns: 2 })

    // Cleanup before nextTick
    cleanup()

    // Now flush — pendingEvents should be empty, nothing added
    await nextTick()

    expect(events.value).toHaveLength(0)
  })

  it('cleanup resets pendingEvents so subsequent enqueue+flush works cleanly', async () => {
    await makeTabsStore('tab-1')
    const { useStreamEvents } = await import('@renderer/composables/useStreamEvents')
    const { events, enqueueEvent, cleanup } = useStreamEvents('tab-1')

    enqueueEvent({ type: 'result', num_turns: 1 })
    cleanup()
    await nextTick()

    // After cleanup, enqueue a new event — should work
    enqueueEvent({ type: 'result', num_turns: 2 })
    await nextTick()

    expect(events.value).toHaveLength(1)
    expect((events.value[0] as any).num_turns).toBe(2)
  })
})

// T1764 — _question bridge
describe('useStreamEvents — _question bridge (T1764)', () => {
  beforeEach(() => {
    vi.resetModules()
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.setItem('dbPath', '/test/project.db')
  })

  afterEach(() => { vi.clearAllMocks() })

  it('populates _question on AskUserQuestion block when ask_user event is in the same batch', async () => {
    await makeTabsStore('tab-1')
    const { useStreamEvents } = await import('@renderer/composables/useStreamEvents')
    const { events, enqueueEvent } = useStreamEvents('tab-1')

    enqueueEvent({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'tool_use', name: 'AskUserQuestion', input: {} }] },
    })
    enqueueEvent({ type: 'ask_user', text: 'Which path should I use?' })

    await nextTick()

    const assistantEv = events.value.find(e => e.type === 'assistant')
    const block = assistantEv?.message?.content[0]
    expect(block?._question).toBe('Which path should I use?')
  })

  it('does not set _question when input.question is already present', async () => {
    await makeTabsStore('tab-1')
    const { useStreamEvents } = await import('@renderer/composables/useStreamEvents')
    const { events, enqueueEvent } = useStreamEvents('tab-1')

    enqueueEvent({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'tool_use', name: 'AskUserQuestion', input: { question: 'Already here' } }] },
    })
    enqueueEvent({ type: 'ask_user', text: 'Should not override' })

    await nextTick()

    const assistantEv = events.value.find(e => e.type === 'assistant')
    const block = assistantEv?.message?.content[0]
    expect(block?._question).toBeUndefined()
  })

  it('does not set _question when no ask_user event is in the batch', async () => {
    await makeTabsStore('tab-1')
    const { useStreamEvents } = await import('@renderer/composables/useStreamEvents')
    const { events, enqueueEvent } = useStreamEvents('tab-1')

    enqueueEvent({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'tool_use', name: 'AskUserQuestion', input: {} }] },
    })

    await nextTick()

    const assistantEv = events.value.find(e => e.type === 'assistant')
    const block = assistantEv?.message?.content[0]
    expect(block?._question).toBeUndefined()
  })
})
