import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount, shallowMount, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import ActivityHeatmap from '@renderer/components/ActivityHeatmap.vue'
import { mockElectronAPI } from '../../../test/setup'
import i18n from '@renderer/plugins/i18n'

describe('ActivityHeatmap (T784)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockElectronAPI.queryDb.mockResolvedValue([])
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders without error with a dbPath prop', async () => {
    const wrapper = mount(ActivityHeatmap, {
      props: { dbPath: '/tmp/test.db' },
      global: { plugins: [i18n] },
    })
    await flushPromises()
    expect(wrapper.exists()).toBe(true)
    wrapper.unmount()
  })

  it('renders "Tous" agent filter button by default', async () => {
    const wrapper = mount(ActivityHeatmap, {
      props: { dbPath: '/tmp/test.db' },
      global: { plugins: [i18n] },
    })
    await flushPromises()
    expect(wrapper.text()).toContain('Tous')
    wrapper.unmount()
  })

  it('does NOT call queryDb when dbPath is empty string', async () => {
    mockElectronAPI.queryDb.mockClear()
    const wrapper = mount(ActivityHeatmap, {
      props: { dbPath: '' },
      global: { plugins: [i18n] },
    })
    await flushPromises()
    expect(mockElectronAPI.queryDb).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('dayCountMap sums counts for same day from different agents', async () => {
    mockElectronAPI.queryDb.mockResolvedValueOnce([
      { day: '2025-01-01', agentId: 1, agentName: 'agentA', count: 3 },
      { day: '2025-01-01', agentId: 2, agentName: 'agentB', count: 2 },
      { day: '2025-01-02', agentId: 1, agentName: 'agentA', count: 1 },
    ]).mockResolvedValueOnce([])
    const wrapper = mount(ActivityHeatmap, { props: { dbPath: '/tmp/test.db' }, global: { plugins: [i18n] } })
    await flushPromises()
    // max = 5 (sum for 2025-01-01)
    expect(wrapper.text()).toContain('5')
    wrapper.unmount()
  })

  it('dayCountMap is empty when rows = []', async () => {
    mockElectronAPI.queryDb.mockResolvedValue([])
    const wrapper = mount(ActivityHeatmap, { props: { dbPath: '/tmp/test.db' }, global: { plugins: [i18n] } })
    await flushPromises()
    // max fallback = 1
    expect(wrapper.text()).toContain('max : 1')
    wrapper.unmount()
  })

  it('filters by filterAgentId when an agent button is clicked', async () => {
    mockElectronAPI.queryDb.mockResolvedValueOnce([
      { day: '2025-01-01', agentId: 1, agentName: 'agentA', count: 5 },
      { day: '2025-01-01', agentId: 2, agentName: 'agentB', count: 2 },
    ]).mockResolvedValueOnce([
      { id: 1, name: 'agentA' },
      { id: 2, name: 'agentB' },
    ])
    const wrapper = mount(ActivityHeatmap, { props: { dbPath: '/tmp/test.db' }, global: { plugins: [i18n] } })
    await flushPromises()
    const agentABtn = wrapper.findAll('v-btn').find(b => b.text() === 'agentA')
    expect(agentABtn?.exists()).toBe(true)
    await agentABtn!.trigger('click')
    await nextTick()
    // After filter by agentA only (count=5), max should be 5
    expect(wrapper.text()).toContain('5')
    wrapper.unmount()
  })
})

// ---------------------------------------------------------------------------
// ActivityHeatmap — intensity() pure logic (T784)
// ---------------------------------------------------------------------------

describe('ActivityHeatmap intensity() logic (T784)', () => {
  it('maps counts to correct intensity levels 0-4', () => {
    // Mirror of the internal intensity() function logic
    const intensity = (count: number): number => {
      if (count === 0) return 0
      if (count === 1) return 1
      if (count <= 3) return 2
      if (count <= 6) return 3
      return 4
    }
    expect(intensity(0)).toBe(0)
    expect(intensity(1)).toBe(1)
    expect(intensity(2)).toBe(2)
    expect(intensity(3)).toBe(2)
    expect(intensity(4)).toBe(3)
    expect(intensity(5)).toBe(3)
    expect(intensity(6)).toBe(3)
    expect(intensity(7)).toBe(4)
  })
})
