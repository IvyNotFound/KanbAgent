/**
 * Tests for useStreamEvents: assignEventId, text event rendering, message.content blocks.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { nextTick } from 'vue'
import { installMockElectronAPI, makeTabsStore } from './__helpers__/useStreamEvents.helpers'

installMockElectronAPI()

vi.mock('@renderer/utils/renderMarkdown', () => ({
  renderMarkdown: vi.fn((text: string) => `<p>${text}</p>`),
}))

import { renderMarkdown } from '@renderer/utils/renderMarkdown'

// ─── assignEventId ───────────────────────────────────────────────────────────

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

// ─── flushEvents text event rendering ────────────────────────────────────────

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

// ─── flushEvents message.content blocks ──────────────────────────────────────

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
