/**
 * Tests for useStreamEvents: ANSI sanitisation on re-render,
 * HTML rendering at re-activation, re-activation conditions.
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

// ─── ANSI sanitisation on re-render ──────────────────────────────────────────

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

    expect(renderMarkdown).toHaveBeenLastCalledWith(expect.not.stringContaining('\x1B'))
    expect(events.value[0].message?.content[0]._html).toBeDefined()

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

    expect(renderMarkdown).toHaveBeenLastCalledWith('green')
    expect(events.value[0].message?.content[0]._html).toBeDefined()

    tabsStore.setActive('other-tab')
    await nextTick()
    expect(events.value[0].message?.content[0]._html).toBeDefined()

    tabsStore.setActive('tab-1')
    await nextTick()
    expect(events.value[0].message?.content[0]._html).toBeDefined()
  })
})

// ─── HTML rendering at re-activation ─────────────────────────────────────────

describe('useStreamEvents — HTML rendering at re-activation: _html null vs defined (L113)', () => {
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

    events.value[0].message!.content[0]._html = '<p>custom</p>'
    const callCount = (renderMarkdown as ReturnType<typeof vi.fn>).mock.calls.length

    tabsStore.setActive('other-tab')
    await nextTick()
    tabsStore.setActive('tab-1')
    await nextTick()

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

    tabsStore.setActive('other-tab')
    await nextTick()
    expect(events.value[0].message?.content[0]._html).toBe('<p>output</p>')

    tabsStore.setActive('tab-1')
    await nextTick()
    expect(events.value[0].message?.content[0]._html).toBe('<p>output</p>')
  })
})

// ─── re-activation conditions ────────────────────────────────────────────────

describe('useStreamEvents — re-activation conditions (L113/L115/L122)', () => {
  beforeEach(() => {
    vi.resetModules()
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.setItem('dbPath', '/test/project.db')
  })

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

    expect((renderMarkdown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsBefore)
    expect(events.value[0].message?.content[0]._html).toBeUndefined()
  })

  it('text block _html persists through deactivation -- no re-render on activation (T1865)', async () => {
    const tabsStore = await makeTabsStore('tab-1')
    const { useStreamEvents } = await import('@renderer/composables/useStreamEvents')
    const { events, enqueueEvent } = useStreamEvents('tab-1')

    enqueueEvent({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
    })
    await nextTick()

    const callsBefore = (renderMarkdown as ReturnType<typeof vi.fn>).mock.calls.length

    tabsStore.setActive('other-tab')
    await nextTick()
    expect(events.value[0].message?.content[0]._html).toBe('<p>hello</p>')

    tabsStore.setActive('tab-1')
    await nextTick()

    expect((renderMarkdown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsBefore)
    expect(events.value[0].message?.content[0]._html).toBe('<p>hello</p>')
  })

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

  it('tool_result block _html persists through deactivation -- no re-render on activation (T1865)', async () => {
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

  it('top-level text event _html persists through deactivation -- no re-render on activation (T1865)', async () => {
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
