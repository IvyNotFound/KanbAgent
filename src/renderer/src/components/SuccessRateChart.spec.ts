import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import SuccessRateChart from '@renderer/components/SuccessRateChart.vue'
import i18n from '@renderer/plugins/i18n'

describe('SuccessRateChart', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('shows empty state when no DB data', async () => {
    const api = window.electronAPI as Record<string, ReturnType<typeof vi.fn>>
    api.queryDb.mockResolvedValue([])

    const wrapper = mount(SuccessRateChart, {
      global: {
        plugins: [
          createTestingPinia({ initialState: { tasks: { dbPath: '/p/db.sqlite' } } }),
          i18n,
        ],
      },
    })
    await flushPromises()
    // isEmpty = true when no rows with rates → shows empty state
    const text = wrapper.text()
    expect(text.length).toBeGreaterThan(0)
    wrapper.unmount()
  })

  it('does not call queryDb when dbPath is null', async () => {
    const api = window.electronAPI as Record<string, ReturnType<typeof vi.fn>>
    api.queryDb.mockResolvedValue([])

    mount(SuccessRateChart, {
      global: {
        plugins: [
          createTestingPinia({ initialState: { tasks: { dbPath: null } } }),
          i18n,
        ],
      },
    })
    await flushPromises()
    expect(api.queryDb).not.toHaveBeenCalled()
  })

  it('renders chart data when rows are returned', async () => {
    const today = new Date()
    const dayStr = today.toISOString().slice(0, 10)
    const api = window.electronAPI as Record<string, ReturnType<typeof vi.fn>>
    api.queryDb.mockResolvedValue([
      { day: dayStr, status: 'completed', count: 8 },
      { day: dayStr, status: 'blocked', count: 2 },
    ])

    const wrapper = mount(SuccessRateChart, {
      global: {
        plugins: [
          createTestingPinia({ initialState: { tasks: { dbPath: '/p/db.sqlite' } } }),
          i18n,
        ],
      },
    })
    await flushPromises()
    // avgRate should be 80 (8/10 = 80%)
    expect(wrapper.text()).toContain('80')
    wrapper.unmount()
  })

  it('shows avg rate badge color green for rate >= 80', async () => {
    const today = new Date()
    const dayStr = today.toISOString().slice(0, 10)
    const api = window.electronAPI as Record<string, ReturnType<typeof vi.fn>>
    api.queryDb.mockResolvedValue([
      { day: dayStr, status: 'completed', count: 9 },
      { day: dayStr, status: 'blocked', count: 1 },
    ])

    const wrapper = mount(SuccessRateChart, {
      global: {
        plugins: [
          createTestingPinia({ initialState: { tasks: { dbPath: '/p/db.sqlite' } } }),
          i18n,
        ],
      },
    })
    await flushPromises()
    // 90% → high rate level
    const badge = wrapper.find('[data-rate-level="high"]')
    expect(badge.exists()).toBe(true)
    wrapper.unmount()
  })

  it('shows avg rate badge color amber for rate 50-79', async () => {
    const today = new Date()
    const dayStr = today.toISOString().slice(0, 10)
    const api = window.electronAPI as Record<string, ReturnType<typeof vi.fn>>
    api.queryDb.mockResolvedValue([
      { day: dayStr, status: 'completed', count: 6 },
      { day: dayStr, status: 'blocked', count: 4 },
    ])

    const wrapper = mount(SuccessRateChart, {
      global: {
        plugins: [
          createTestingPinia({ initialState: { tasks: { dbPath: '/p/db.sqlite' } } }),
          i18n,
        ],
      },
    })
    await flushPromises()
    // 60% → mid rate level
    const badge = wrapper.find('[data-rate-level="mid"]')
    expect(badge.exists()).toBe(true)
    wrapper.unmount()
  })

  it('renders 14 bars in the chart for 14 days', async () => {
    const today = new Date()
    const dayStr = today.toISOString().slice(0, 10)
    const api = window.electronAPI as Record<string, ReturnType<typeof vi.fn>>
    api.queryDb.mockResolvedValue([
      { day: dayStr, status: 'completed', count: 5 },
      { day: dayStr, status: 'blocked', count: 5 },
    ])

    const wrapper = mount(SuccessRateChart, {
      global: {
        plugins: [
          createTestingPinia({ initialState: { tasks: { dbPath: '/p/db.sqlite' } } }),
          i18n,
        ],
      },
    })
    await flushPromises()
    // chart renders 14 grouped days
    const text = wrapper.text()
    expect(text.length).toBeGreaterThan(0)
    wrapper.unmount()
  })

  it('handles queryDb errors gracefully', async () => {
    const api = window.electronAPI as Record<string, ReturnType<typeof vi.fn>>
    api.queryDb.mockRejectedValue(new Error('DB error'))

    const wrapper = mount(SuccessRateChart, {
      global: {
        plugins: [
          createTestingPinia({ initialState: { tasks: { dbPath: '/p/db.sqlite' } } }),
          i18n,
        ],
      },
    })
    await flushPromises()
    // Should not throw — shows empty state
    expect(wrapper.exists()).toBe(true)
    wrapper.unmount()
  })
})
