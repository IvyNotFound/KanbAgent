import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, shallowMount, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import TitleBar from '@renderer/components/TitleBar.vue'
import i18n from '@renderer/plugins/i18n'

describe('TitleBar (T353)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const api = window.electronAPI as Record<string, ReturnType<typeof vi.fn>>
    api.windowIsMaximized.mockResolvedValue(false)
    api.onWindowStateChange.mockReturnValue(vi.fn())
  })

  it('renders app identity text', async () => {
    const wrapper = shallowMount(TitleBar, {
      global: { plugins: [i18n] },
    })
    await flushPromises()
    expect(wrapper.text()).toContain('KanbAgent')
  })

  it('calls windowMinimize when minimize button is clicked', async () => {
    const api = window.electronAPI as Record<string, ReturnType<typeof vi.fn>>
    const wrapper = shallowMount(TitleBar, {
      global: { plugins: [i18n] },
    })
    await flushPromises()

    const minBtn = wrapper.findAll('button').find(b => {
      const title = b.attributes('title') || ''
      return title.includes('Minimiser') || title.includes('Minimize') || title.includes('minimiser')
    })
    expect(minBtn).toBeDefined()
    await minBtn!.trigger('click')
    expect(api.windowMinimize).toHaveBeenCalled()
  })

  it('calls windowMaximize when maximize button is clicked', async () => {
    const api = window.electronAPI as Record<string, ReturnType<typeof vi.fn>>
    const wrapper = shallowMount(TitleBar, {
      global: { plugins: [i18n] },
    })
    await flushPromises()

    const maxBtn = wrapper.findAll('button').find(b => {
      const title = b.attributes('title') || ''
      return title.includes('Agrandir') || title.includes('Maximize') || title.includes('agrandir')
    })
    expect(maxBtn).toBeDefined()
    await maxBtn!.trigger('click')
    expect(api.windowMaximize).toHaveBeenCalled()
  })

  it('calls windowClose when close button is clicked', async () => {
    const api = window.electronAPI as Record<string, ReturnType<typeof vi.fn>>
    const wrapper = shallowMount(TitleBar, {
      global: { plugins: [i18n] },
    })
    await flushPromises()

    const closeBtn = wrapper.findAll('button').find(b => {
      const title = b.attributes('title') || ''
      return title.includes('Fermer') || title.includes('Close') || title.includes('close')
    })
    expect(closeBtn).toBeDefined()
    await closeBtn!.trigger('click')
    expect(api.windowClose).toHaveBeenCalled()
  })

  it('shows restore icon when maximized', async () => {
    const api = window.electronAPI as Record<string, ReturnType<typeof vi.fn>>
    api.windowIsMaximized.mockResolvedValue(true)

    const wrapper = shallowMount(TitleBar, {
      global: { plugins: [i18n] },
    })
    await flushPromises()

    // The restore button title should contain 'Restaurer' or 'Restore'
    const restoreBtn = wrapper.findAll('button').find(b => {
      const title = b.attributes('title') || ''
      return title.includes('Restaurer') || title.includes('Restore')
    })
    expect(restoreBtn).toBeDefined()
  })

  it('emits open-search when search bar is clicked', async () => {
    const wrapper = shallowMount(TitleBar, {
      global: { plugins: [i18n] },
    })
    await flushPromises()

    // Find the search button (has Ctrl+K text)
    const searchBtn = wrapper.findAll('button').find(b => b.text().includes('Ctrl+K'))
    expect(searchBtn).toBeDefined()
    await searchBtn!.trigger('click')
    expect(wrapper.emitted('open-search')).toBeTruthy()
  })

  it('updates isMaximized when onWindowStateChange fires', async () => {
    const api = window.electronAPI as Record<string, ReturnType<typeof vi.fn>>
    let stateCallback: ((maximized: boolean) => void) | null = null
    api.onWindowStateChange.mockImplementation((cb: (maximized: boolean) => void) => {
      stateCallback = cb
      return vi.fn()
    })
    api.windowIsMaximized.mockResolvedValue(false)

    const wrapper = shallowMount(TitleBar, {
      global: { plugins: [i18n] },
    })
    await flushPromises()

    // Initially not maximized — maximize button shows "Agrandir/Maximize"
    let maxBtn = wrapper.findAll('button').find(b => {
      const title = b.attributes('title') || ''
      return title.includes('Agrandir') || title.includes('Maximize')
    })
    expect(maxBtn).toBeDefined()

    // Simulate window state change to maximized
    stateCallback!(true)
    await nextTick()

    // Now should show "Restaurer/Restore"
    const restoreBtn = wrapper.findAll('button').find(b => {
      const title = b.attributes('title') || ''
      return title.includes('Restaurer') || title.includes('Restore')
    })
    expect(restoreBtn).toBeDefined()
  })
})
