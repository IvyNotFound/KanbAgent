/**
 * Tests for useStreamEvents: scrollToBottom, isNearBottom, scroll after flush, default params.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { nextTick } from 'vue'
import { installMockElectronAPI, makeTabsStore } from './__helpers__/useStreamEvents.helpers'

installMockElectronAPI()

vi.mock('@renderer/utils/renderMarkdown', () => ({
  renderMarkdown: vi.fn((text: string) => `<p>${text}</p>`),
}))

// ─── scrollToBottom / isNearBottom ───────────────────────────────────────────

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
    Object.defineProperty(el, 'scrollHeight', { value: 1000, configurable: true })
    Object.defineProperty(el, 'scrollTop', { value: 0, configurable: true, writable: true })
    Object.defineProperty(el, 'clientHeight', { value: 100, configurable: true })
    scrollContainer.value = el

    scrollToBottom(false)
    await nextTick()

    expect(el.scrollTop).toBe(0)
  })

  it('isNearBottom threshold: exactly 149px from bottom = near (should scroll)', async () => {
    await makeTabsStore('tab-1')
    const { useStreamEvents } = await import('@renderer/composables/useStreamEvents')
    const { scrollContainer, scrollToBottom } = useStreamEvents('tab-1')

    const el = document.createElement('div')
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
    Object.defineProperty(el, 'scrollHeight', { value: 1000, configurable: true })
    Object.defineProperty(el, 'scrollTop', { value: 850, configurable: true, writable: true })
    Object.defineProperty(el, 'clientHeight', { value: 0, configurable: true })
    scrollContainer.value = el

    scrollToBottom(false)
    await nextTick()

    expect(el.scrollTop).toBe(850)
  })
})

// ─── scrollToBottom called after flush ───────────────────────────────────────

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
    await nextTick()

    expect(el.scrollTop).toBe(500)
  })
})

// ─── isNearBottom with null scrollContainer ──────────────────────────────────

describe('useStreamEvents — isNearBottom with null scrollContainer (L79)', () => {
  beforeEach(() => {
    vi.resetModules()
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.setItem('dbPath', '/test/project.db')
  })

  it('scrollToBottom(false) with null scrollContainer still calls nextTick (no container = near bottom)', async () => {
    await makeTabsStore('tab-1')
    const { useStreamEvents } = await import('@renderer/composables/useStreamEvents')
    const { scrollContainer, scrollToBottom } = useStreamEvents('tab-1')

    scrollContainer.value = null

    const el = document.createElement('div')
    Object.defineProperty(el, 'scrollHeight', { value: 500, configurable: true })
    scrollToBottom(false)
    scrollContainer.value = el
    await nextTick()

    expect(el.scrollTop).toBe(500)
  })
})

// ─── scrollToBottom default parameter ────────────────────────────────────────

describe('useStreamEvents — scrollToBottom default parameter (L84)', () => {
  beforeEach(() => {
    vi.resetModules()
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.setItem('dbPath', '/test/project.db')
  })

  it('scrollToBottom() with no args (default force=false) does NOT scroll when far from bottom', async () => {
    await makeTabsStore('tab-1')
    const { useStreamEvents } = await import('@renderer/composables/useStreamEvents')
    const { scrollContainer, scrollToBottom } = useStreamEvents('tab-1')

    const el = document.createElement('div')
    Object.defineProperty(el, 'scrollHeight', { value: 1000, configurable: true })
    Object.defineProperty(el, 'scrollTop', { value: 0, configurable: true, writable: true })
    Object.defineProperty(el, 'clientHeight', { value: 100, configurable: true })
    scrollContainer.value = el

    scrollToBottom()
    await nextTick()

    expect(el.scrollTop).toBe(0)
  })

  it('scrollToBottom() near bottom (default force=false) scrolls to bottom', async () => {
    await makeTabsStore('tab-1')
    const { useStreamEvents } = await import('@renderer/composables/useStreamEvents')
    const { scrollContainer, scrollToBottom } = useStreamEvents('tab-1')

    const el = document.createElement('div')
    Object.defineProperty(el, 'scrollHeight', { value: 1000, configurable: true })
    Object.defineProperty(el, 'scrollTop', { value: 950, configurable: true, writable: true })
    Object.defineProperty(el, 'clientHeight', { value: 0, configurable: true })
    scrollContainer.value = el

    scrollToBottom()
    await nextTick()

    expect(el.scrollTop).toBe(1000)
  })
})
