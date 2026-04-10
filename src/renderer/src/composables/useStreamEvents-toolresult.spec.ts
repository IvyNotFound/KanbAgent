/**
 * Tests for useStreamEvents: tool_result content ternary branches, _question bridge.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { nextTick } from 'vue'
import { installMockElectronAPI, makeTabsStore } from './__helpers__/useStreamEvents.helpers'

installMockElectronAPI()

vi.mock('@renderer/utils/renderMarkdown', () => ({
  renderMarkdown: vi.fn((text: string) => `<p>${text}</p>`),
}))

import { renderMarkdown } from '@renderer/utils/renderMarkdown'

// ─── tool_result content ternary branches ────────────────────────────────────

describe('useStreamEvents — tool_result content ternary branches (L43)', () => {
  beforeEach(() => {
    vi.resetModules()
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.setItem('dbPath', '/test/project.db')
  })

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

// ─── _question bridge ────────────────────────────────────────────────────────

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
