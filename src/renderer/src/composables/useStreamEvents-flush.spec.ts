/**
 * Tests for useStreamEvents: toggleCollapsed, cleanup, micro-batching,
 * flushPending guard, flushEvents early-return guard.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { nextTick } from 'vue'
import { installMockElectronAPI, makeTabsStore } from './__helpers__/useStreamEvents.helpers'

installMockElectronAPI()

vi.mock('@renderer/utils/renderMarkdown', () => ({
  renderMarkdown: vi.fn((text: string) => `<p>${text}</p>`),
}))

// ─── toggleCollapsed ─────────────────────────────────────────────────────────

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

  it('toggleCollapsed with defaultCollapsed=true: absent key -> set to false', async () => {
    await makeTabsStore('tab-1')
    const { useStreamEvents } = await import('@renderer/composables/useStreamEvents')
    const { collapsed, toggleCollapsed } = useStreamEvents('tab-1')

    toggleCollapsed('key-2', true)
    expect(collapsed.value['key-2']).toBe(false)
  })

  it('toggleCollapsed with defaultCollapsed=true: present=false -> true', async () => {
    await makeTabsStore('tab-1')
    const { useStreamEvents } = await import('@renderer/composables/useStreamEvents')
    const { collapsed, toggleCollapsed } = useStreamEvents('tab-1')

    collapsed.value['key-2'] = false
    toggleCollapsed('key-2', true)
    expect(collapsed.value['key-2']).toBe(true)
  })
})

// ─── cleanup ─────────────────────────────────────────────────────────────────

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

// ─── micro-batching ──────────────────────────────────────────────────────────

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

// ─── enqueueEvent flushPending guard ─────────────────────────────────────────

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

    enqueueEvent({ type: 'result', num_turns: 1 })
    enqueueEvent({ type: 'result', num_turns: 2 })

    expect(events.value).toHaveLength(0)

    await nextTick()
    expect(events.value).toHaveLength(2)
  })

  it('enqueueEvent after flush can schedule another flush', async () => {
    await makeTabsStore('tab-1')
    const { useStreamEvents } = await import('@renderer/composables/useStreamEvents')
    const { events, enqueueEvent } = useStreamEvents('tab-1')

    enqueueEvent({ type: 'result', num_turns: 1 })
    await nextTick()
    expect(events.value).toHaveLength(1)

    enqueueEvent({ type: 'result', num_turns: 2 })
    await nextTick()
    expect(events.value).toHaveLength(2)
  })

  it('initial flushPending state is false -- first enqueue triggers flush', async () => {
    await makeTabsStore('tab-1')
    const { useStreamEvents } = await import('@renderer/composables/useStreamEvents')
    const { events, enqueueEvent } = useStreamEvents('tab-1')

    expect(events.value).toHaveLength(0)

    enqueueEvent({ type: 'text', text: 'first event' })
    expect(events.value).toHaveLength(0)

    await nextTick()
    expect(events.value).toHaveLength(1)
    expect(events.value[0]._html).toBe('<p>first event</p>')
  })

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

// ─── flushEvents early-return guard ──────────────────────────────────────────

describe('useStreamEvents — flushEvents early-return guard (L35)', () => {
  beforeEach(() => {
    vi.resetModules()
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.setItem('dbPath', '/test/project.db')
  })

  it('flushEvents called directly with empty pendingEvents does NOT push any event (early return)', async () => {
    await makeTabsStore('tab-1')
    const { useStreamEvents } = await import('@renderer/composables/useStreamEvents')
    const { events, flushEvents } = useStreamEvents('tab-1')

    flushEvents()
    await nextTick()

    expect(events.value).toHaveLength(0)
  })

  it('calling enqueueEvent then flushEvents directly processes the event', async () => {
    await makeTabsStore('tab-1')
    const { useStreamEvents } = await import('@renderer/composables/useStreamEvents')
    const { events, enqueueEvent, flushEvents } = useStreamEvents('tab-1')

    enqueueEvent({ type: 'result', num_turns: 99 })
    flushEvents()

    expect(events.value).toHaveLength(1)
    expect((events.value[0] as any).num_turns).toBe(99)
  })

  it('flushEvents with 1 pending event adds exactly 1 event (no spurious early return)', async () => {
    await makeTabsStore('tab-1')
    const { useStreamEvents } = await import('@renderer/composables/useStreamEvents')
    const { events, enqueueEvent, flushEvents } = useStreamEvents('tab-1')

    enqueueEvent({ type: 'text', text: 'should appear' })
    flushEvents()

    expect(events.value).toHaveLength(1)
    expect(events.value[0]._html).toBe('<p>should appear</p>')
  })
})

// ─── cleanup clears pendingEvents ────────────────────────────────────────────

describe('useStreamEvents — cleanup clears pendingEvents (L138)', () => {
  beforeEach(() => {
    vi.resetModules()
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.setItem('dbPath', '/test/project.db')
  })

  it('cleanup prevents in-flight enqueued events from being processed', async () => {
    await makeTabsStore('tab-1')
    const { useStreamEvents } = await import('@renderer/composables/useStreamEvents')
    const { events, enqueueEvent, cleanup } = useStreamEvents('tab-1')

    enqueueEvent({ type: 'result', num_turns: 1 })
    enqueueEvent({ type: 'result', num_turns: 2 })

    cleanup()

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

    enqueueEvent({ type: 'result', num_turns: 2 })
    await nextTick()

    expect(events.value).toHaveLength(1)
    expect((events.value[0] as any).num_turns).toBe(2)
  })
})
