import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount, shallowMount, flushPromises } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import TabBar from '@renderer/components/TabBar.vue'
import i18n from '@renderer/plugins/i18n'

// Stub for TabBarScrollArea — renders agent group names so text assertions work
const tabBarScrollAreaStub = {
  props: ['fileTabs', 'groupedTerminalTabs', 'activeTabId', 'agentTabStyleMap',
    'groupEnvelopeStyleMap', 'subTabBgMap', 'subTabLabel', 'isGroupCollapsed'],
  template: '<div><span v-for="g in groupedTerminalTabs" :key="g.agentName ?? \'misc\'">{{ g.agentName }}</span></div>',
}

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
        stubs: { TabBarScrollArea: tabBarScrollAreaStub },
      },
    })
    expect(wrapper.text()).toContain('review-master')
  })

  it('shows backlog as active in v-tabs when backlog tab is active', () => {
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
    // After v-tabs migration: active state is managed by Vuetify v-tabs via :model-value binding.
    // isCustomElement config renders v-tabs as a custom HTML element with attributes.
    const vtabs = wrapper.find('v-tabs')
    expect(vtabs.exists()).toBe(true)
    expect(vtabs.attributes('model-value')).toBe('backlog')
  })

  it('renders v-tab elements for Backlog and Dashboard navigation', () => {
    const wrapper = shallowMount(TabBar, {
      global: {
        plugins: [createTestingPinia({
          initialState: { tabs: {
            tabs: [
              { id: 'backlog', type: 'backlog', title: 'Backlog', permanent: true },
              { id: 'dashboard', type: 'dashboard', title: 'Dashboard', permanent: true },
            ],
            activeTabId: 'dashboard',
          } },
        }), i18n],
      },
    })
    // v-tabs isCustomElement → renders as native custom elements with value attributes
    const backlogTab = wrapper.find('v-tab[value="backlog"]')
    const dashboardTab = wrapper.find('v-tab[value="dashboard"]')
    expect(backlogTab.exists()).toBe(true)
    expect(dashboardTab.exists()).toBe(true)
    expect(wrapper.text()).toContain('Backlog')
    expect(wrapper.text()).toContain('Dashboard')
  })

})
