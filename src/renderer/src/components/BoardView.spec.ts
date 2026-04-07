import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { shallowMount } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import { nextTick } from 'vue'
import BoardView from '@renderer/components/BoardView.vue'
import StatusColumn from '@renderer/components/StatusColumn.vue'
import i18n from '@renderer/plugins/i18n'

describe('BoardView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('renders the backlog tab by default', () => {
    const wrapper = shallowMount(BoardView, {
      global: { plugins: [createTestingPinia(), i18n] },
    })
    expect(wrapper.text()).toContain('Backlog')
  })

  it('renders the archive tab', () => {
    const wrapper = shallowMount(BoardView, {
      global: { plugins: [createTestingPinia(), i18n] },
    })
    expect(wrapper.text()).toContain('Archive')
  })

  it('switches active tab when archive is clicked', async () => {
    const wrapper = shallowMount(BoardView, {
      global: { plugins: [createTestingPinia(), i18n] },
    })
    // v-btn-toggle manages active state natively; simulate the tab switch directly
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(wrapper.vm as any).activeTab = 'archive'
    await nextTick()
    // After switching to archive, the archive area should be rendered
    expect(wrapper.find('.archive-area').exists()).toBe(true)
  })

  it('renders StatusColumn stubs for each board column', () => {
    const wrapper = shallowMount(BoardView, {
      global: { plugins: [createTestingPinia(), i18n] },
    })
    const columns = wrapper.findAllComponents({ name: 'StatusColumn' })
    // backlog view: todo, in_progress, done columns (3)
    expect(columns.length).toBe(3)
  })
})
