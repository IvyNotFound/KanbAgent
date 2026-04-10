/**
 * Tests for useStreamEvents: hidden-tab eviction, hidden eviction arithmetic,
 * hidden-tab _html persistence, ev.type=text _html clear on deactivation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { nextTick } from 'vue'
import { installMockElectronAPI, makeTabsStore } from './__helpers__/useStreamEvents.helpers'

installMockElectronAPI()

vi.mock('@renderer/utils/renderMarkdown', () => ({
  renderMarkdown: vi.fn((text: string) => `<p>${text}</p>`),
}))

// ─── hidden-tab eviction + _html persistence ────────────────────────────────

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

    enqueueEvent({ type: 'text', text: 'hello' })
    await nextTick()

    expect(events.value[0]._html).toBe('<p>hello</p>')

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

    tabsStore.setActive('other-tab')
    await nextTick()
    expect(events.value[0]._html).toBe('<p>reactivate me</p>')

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

    enqueueEvent({ type: 'text', text: null })
    await nextTick()

    tabsStore.setActive('other-tab')
    await nextTick()

    tabsStore.setActive('tab-1')
    await nextTick()

    expect(events.value[0]._html).toBeUndefined()
  })
})

// ─── hidden eviction arithmetic MAX_EVENTS_HIDDEN ────────────────────────────

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

// ─── hidden-tab: ev.type=text _html clear ────────────────────────────────────

describe('useStreamEvents — hidden-tab: ev.type=text _html clear (L99)', () => {
  beforeEach(() => {
    vi.resetModules()
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.setItem('dbPath', '/test/project.db')
  })

  it('on tab deactivation, _html is NOT touched on type=result events', async () => {
    const tabsStore = await makeTabsStore('tab-1')
    const { useStreamEvents } = await import('@renderer/composables/useStreamEvents')
    const { events, enqueueEvent } = useStreamEvents('tab-1')

    enqueueEvent({ type: 'result', num_turns: 5 })
    await nextTick()

    ;(events.value[0] as any)._html = '<p>result html</p>'

    tabsStore.setActive('other-tab')
    await nextTick()

    expect((events.value[0] as any)._html).toBe('<p>result html</p>')
  })

  it('hidden eviction: exactly MAX_EVENTS_HIDDEN events -> no eviction on deactivation', async () => {
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

    expect(events.value.length).toBe(MAX_EVENTS_HIDDEN)
  })

  it('hidden eviction: MAX_EVENTS_HIDDEN + 1 events -> eviction trims to MAX_EVENTS_HIDDEN', async () => {
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

  it('hidden eviction: 250 events -> trimmed to exactly MAX_EVENTS_HIDDEN (200)', async () => {
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

  it('hidden eviction: collapsed keys for surviving events are NOT removed', async () => {
    const tabsStore = await makeTabsStore('tab-1')
    const { useStreamEvents, MAX_EVENTS_HIDDEN } = await import('@renderer/composables/useStreamEvents')
    const { events, collapsed, enqueueEvent } = useStreamEvents('tab-1')

    for (let i = 0; i < MAX_EVENTS_HIDDEN + 50; i++) {
      enqueueEvent({ type: 'result', num_turns: i })
    }
    await nextTick()

    const recentId = events.value[events.value.length - 1]._id!
    collapsed.value[`${recentId}-tool`] = true

    tabsStore.setActive('other-tab')
    await nextTick()

    expect(collapsed.value[`${recentId}-tool`]).toBe(true)
  })
})
