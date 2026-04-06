import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount, shallowMount, flushPromises } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import TabBar from '@renderer/components/TabBar.vue'
import i18n from '@renderer/plugins/i18n'

describe('TabBar', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.stubGlobal('ResizeObserver', vi.fn().mockImplementation(function MockResizeObserver() {
      this.observe = vi.fn()
      this.unobserve = vi.fn()
      this.disconnect = vi.fn()
    }))
  })

  it('renders backlog button', () => {
    const wrapper = shallowMount(TabBar, {
      global: {
        plugins: [createTestingPinia({
          initialState: { tabs: { tabs: [{ id: 'backlog', type: 'board', title: 'Backlog', permanent: true }], activeTabId: 'backlog' } },
        }), i18n],
      },
    })
    expect(wrapper.text()).toContain('Backlog')
  })

  it('renders dashboard button', () => {
    const wrapper = shallowMount(TabBar, {
      global: {
        plugins: [createTestingPinia({
          initialState: { tabs: { tabs: [{ id: 'backlog', type: 'backlog', title: 'Backlog', permanent: true }, { id: 'dashboard', type: 'dashboard', title: 'Dashboard', permanent: true }], activeTabId: 'backlog' } },
        }), i18n],
      },
    })
    expect(wrapper.text()).toContain('Dashboard')
  })

  it('renders terminal tab titles', () => {
    const wrapper = shallowMount(TabBar, {
      global: {
        plugins: [createTestingPinia({
          initialState: { tabs: {
            tabs: [
              { id: 'backlog', type: 'backlog', title: 'Backlog', permanent: true },
              { id: 'dashboard', type: 'dashboard', title: 'Dashboard', permanent: true },
              { id: 'term-1', type: 'terminal', title: 'review-master', permanent: false, agentName: 'review-master' },
            ],
            activeTabId: 'term-1',
          } },
        }), i18n],
      },
    })
    expect(wrapper.text()).toContain('review-master')
  })

  it('shows active indicator on active tab', () => {
    const wrapper = shallowMount(TabBar, {
      global: {
        plugins: [createTestingPinia({
          initialState: { tabs: {
            tabs: [{ id: 'backlog', type: 'board', title: 'Backlog', permanent: true }],
            activeTabId: 'backlog',
          } },
        }), i18n],
      },
    })
    // backlog is active — check for active indicator
    const indicator = wrapper.find('.tab-indicator')
    expect(indicator.exists()).toBe(true)
  })

  it('calls store.setActive when backlog button is clicked', async () => {
    const pinia = createTestingPinia({
      initialState: { tabs: {
        tabs: [
          { id: 'backlog', type: 'backlog', title: 'Backlog', permanent: true },
          { id: 'dashboard', type: 'dashboard', title: 'Dashboard', permanent: true },
        ],
        activeTabId: 'dashboard',
      } },
    })
    const wrapper = shallowMount(TabBar, {
      global: { plugins: [pinia, i18n] },
    })

    const { useTabsStore } = await import('@renderer/stores/tabs')
    const tabsStore = useTabsStore()

    // Click backlog button
    const backlogBtn = wrapper.findAll('button').find(b => b.text().includes('Backlog'))
    expect(backlogBtn).toBeDefined()
    await backlogBtn!.trigger('click')
    expect(tabsStore.setActive).toHaveBeenCalledWith('backlog')
  })

})
