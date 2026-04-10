/**
 * Tests for useStreamEvents: MAX_EVENTS eviction, boundary, arithmetic, collapsed key parse.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { nextTick } from 'vue'
import { installMockElectronAPI, makeTabsStore } from './__helpers__/useStreamEvents.helpers'

installMockElectronAPI()

vi.mock('@renderer/utils/renderMarkdown', () => ({
  renderMarkdown: vi.fn((text: string) => `<p>${text}</p>`),
}))

// ─── MAX_EVENTS eviction ────────────────────────────────────────────────────

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

    for (let i = 0; i < MAX_EVENTS; i++) {
      enqueueEvent({ type: 'result', num_turns: i })
    }
    await nextTick()

    const firstId = events.value[0]._id!
    collapsed.value[`${firstId}-tool`] = true

    expect(collapsed.value[`${firstId}-tool`]).toBe(true)

    enqueueEvent({ type: 'result', num_turns: MAX_EVENTS })
    await nextTick()

    expect(collapsed.value[`${firstId}-tool`]).toBeUndefined()
  })
})

// ─── exported constants ──────────────────────────────────────────────────────

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

// ─── MAX_EVENTS boundary ────────────────────────────────────────────────────

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

// ─── _isLong boundary ────────────────────────────────────────────────────────

describe('useStreamEvents — _isLong boundary (L46: > 15)', () => {
  beforeEach(() => {
    vi.resetModules()
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.setItem('dbPath', '/test/project.db')
  })

  it('14 lines -> _isLong=false', async () => {
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

  it('15 lines -> _isLong=false (boundary: > 15, not >= 15)', async () => {
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
    expect(block?._isLong).toBe(false)
  })

  it('16 lines -> _isLong=true', async () => {
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

// ─── eviction arithmetic MAX_EVENTS ──────────────────────────────────────────

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

    expect(events.value.length).toBe(MAX_EVENTS)
    expect(events.value[0].num_turns).toBe(100)
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

    const turnValues = events.value.map((e: any) => e.num_turns)
    expect(turnValues).not.toContain(0)
    expect(turnValues).not.toContain(4)
    expect(turnValues).toContain(5)
  })
})

// ─── eviction collapsed key parse ────────────────────────────────────────────

describe('useStreamEvents — eviction collapsed key parse (L65)', () => {
  beforeEach(() => {
    vi.resetModules()
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.setItem('dbPath', '/test/project.db')
  })

  it('collapsed keys for NON-evicted events are preserved after MAX_EVENTS+1 flush', async () => {
    await makeTabsStore('tab-1')
    const { useStreamEvents, MAX_EVENTS } = await import('@renderer/composables/useStreamEvents')
    const { events, collapsed, enqueueEvent } = useStreamEvents('tab-1')

    for (let i = 0; i < MAX_EVENTS; i++) {
      enqueueEvent({ type: 'result', num_turns: i })
    }
    await nextTick()

    const lastId = events.value[events.value.length - 1]._id!
    collapsed.value[`${lastId}-tool`] = true

    enqueueEvent({ type: 'result', num_turns: MAX_EVENTS })
    await nextTick()

    expect(collapsed.value[`${lastId}-tool`]).toBe(true)
  })

  it('collapsed key with format "N-suffix" correctly extracts N as event id for eviction', async () => {
    await makeTabsStore('tab-1')
    const { useStreamEvents, MAX_EVENTS } = await import('@renderer/composables/useStreamEvents')
    const { events, collapsed, enqueueEvent } = useStreamEvents('tab-1')

    for (let i = 0; i < MAX_EVENTS; i++) {
      enqueueEvent({ type: 'result', num_turns: i })
    }
    await nextTick()

    const firstId = events.value[0]._id!
    collapsed.value[`${firstId}-tool-use-extra`] = true

    enqueueEvent({ type: 'result', num_turns: MAX_EVENTS })
    await nextTick()

    expect(collapsed.value[`${firstId}-tool-use-extra`]).toBeUndefined()
  })
})
