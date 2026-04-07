import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount, shallowMount, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import CostStatsSection from '@renderer/components/CostStatsSection.vue'
import i18n from '@renderer/plugins/i18n'

describe('CostStatsSection (T824)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    const api = window.electronAPI as Record<string, ReturnType<typeof vi.fn>>
    api.sessionsStatsCost.mockResolvedValue({ success: true, rows: [] })
  })

  it('shows loading state while fetching', async () => {
    const api = window.electronAPI as Record<string, ReturnType<typeof vi.fn>>
    // Never resolves during this test — simulates pending fetch
    api.sessionsStatsCost.mockReturnValue(new Promise(() => {}))

    const wrapper = mount(CostStatsSection, {
      props: { dbPath: '/p/db' },
      global: { plugins: [i18n] },
    })
    // loading=true and rows=[] → loading message visible after reactive update
    await nextTick()
    const text = wrapper.text()
    expect(text).toMatch(/chargement|loading/i)
    wrapper.unmount()
  })

  it('shows noData message when rows are empty', async () => {
    const api = window.electronAPI as Record<string, ReturnType<typeof vi.fn>>
    api.sessionsStatsCost.mockResolvedValue({ success: true, rows: [] })

    const wrapper = mount(CostStatsSection, {
      props: { dbPath: '/p/db' },
      global: { plugins: [i18n] },
    })
    await flushPromises()
    const text = wrapper.text()
    expect(text).toMatch(/aucune donn|no data/i)
    wrapper.unmount()
  })

  it('renders global summary (cost, sessions, turns) from rows', async () => {
    const api = window.electronAPI as Record<string, ReturnType<typeof vi.fn>>
    api.sessionsStatsCost.mockResolvedValue({
      success: true,
      rows: [
        { agent_name: 'dev-front', agent_id: 1, period: '2026-01-01', session_count: 3, total_cost: 0.05, avg_duration_s: 120, total_turns: 10, total_tokens: 5000, cache_read: 400, cache_write: 100 },
        { agent_name: 'dev-back',  agent_id: 2, period: '2026-01-01', session_count: 2, total_cost: 0.03, avg_duration_s: 80,  total_turns: 6,  total_tokens: 3000, cache_read: 200, cache_write: 200 },
      ],
    })

    const wrapper = mount(CostStatsSection, {
      props: { dbPath: '/p/db' },
      global: { plugins: [i18n] },
    })
    await flushPromises()
    const text = wrapper.text()
    // Global cost = 0.05 + 0.03 = $0.08
    expect(text).toContain('$0.08')
    // Global sessions = 3 + 2 = 5
    expect(text).toContain('5')
    // Global turns = 10 + 6 = 16
    expect(text).toContain('16')
    wrapper.unmount()
  })

  it('renders sparkline section when sparkPeriods.length > 1', async () => {
    const api = window.electronAPI as Record<string, ReturnType<typeof vi.fn>>
    api.sessionsStatsCost.mockResolvedValue({
      success: true,
      rows: [
        { agent_name: 'dev-front', agent_id: 1, period: '2026-01-01', session_count: 1, total_cost: 0.01, avg_duration_s: 60, total_turns: 2, total_tokens: 1000, cache_read: 100, cache_write: 50 },
        { agent_name: 'dev-front', agent_id: 1, period: '2026-01-02', session_count: 1, total_cost: 0.02, avg_duration_s: 60, total_turns: 3, total_tokens: 1500, cache_read: 200, cache_write: 50 },
      ],
    })

    const wrapper = mount(CostStatsSection, {
      props: { dbPath: '/p/db' },
      global: { plugins: [i18n] },
    })
    await flushPromises()
    // The sparkline trend label should appear (2 distinct periods)
    const text = wrapper.text()
    expect(text).toMatch(/tendance|trend/i)
    wrapper.unmount()
  })

  it('renders agents sorted by cost descending', async () => {
    const api = window.electronAPI as Record<string, ReturnType<typeof vi.fn>>
    api.sessionsStatsCost.mockResolvedValue({
      success: true,
      rows: [
        { agent_name: 'cheap-agent',     agent_id: 2, period: '2026-01-01', session_count: 1, total_cost: 0.001, avg_duration_s: 10, total_turns: 1, total_tokens: 500,  cache_read: 0,   cache_write: 100 },
        { agent_name: 'expensive-agent', agent_id: 1, period: '2026-01-01', session_count: 1, total_cost: 0.1,   avg_duration_s: 60, total_turns: 5, total_tokens: 5000, cache_read: 800, cache_write: 200 },
      ],
    })

    const wrapper = mount(CostStatsSection, {
      props: { dbPath: '/p/db' },
      global: { plugins: [i18n] },
    })
    await flushPromises()
    const text = wrapper.text()
    const expIdx   = text.indexOf('expensive-agent')
    const cheapIdx = text.indexOf('cheap-agent')
    expect(expIdx).toBeGreaterThanOrEqual(0)
    expect(cheapIdx).toBeGreaterThan(expIdx)
    wrapper.unmount()
  })

  it('computes cacheEfficiency correctly (cache_read / total * 100)', async () => {
    // cache_read=800, cache_write=200 → efficiency = 80%
    const api = window.electronAPI as Record<string, ReturnType<typeof vi.fn>>
    api.sessionsStatsCost.mockResolvedValue({
      success: true,
      rows: [
        { agent_name: 'agent-a', agent_id: 1, period: '2026-01-01', session_count: 2, total_cost: 0.05, avg_duration_s: 60, total_turns: 4, total_tokens: 4000, cache_read: 800, cache_write: 200 },
      ],
    })

    const wrapper = mount(CostStatsSection, {
      props: { dbPath: '/p/db' },
      global: { plugins: [i18n] },
    })
    await flushPromises()
    expect(wrapper.text()).toContain('80%')
    wrapper.unmount()
  })

  it('re-fetches when period selector changes (day→week)', async () => {
    const api = window.electronAPI as Record<string, ReturnType<typeof vi.fn>>
    api.sessionsStatsCost.mockResolvedValue({ success: true, rows: [] })

    const wrapper = mount(CostStatsSection, {
      props: { dbPath: '/p/db' },
      global: { plugins: [i18n] },
    })
    await flushPromises()
    expect(api.sessionsStatsCost).toHaveBeenCalledTimes(1)
    expect(api.sessionsStatsCost).toHaveBeenCalledWith('/p/db', { period: 'day', limit: 30 })

    // Click "Semaine" / "Week" button
    const buttons = wrapper.findAll('v-btn')
    const weekBtn = buttons.find(b => b.text().match(/semaine|week/i))
    expect(weekBtn?.exists()).toBe(true)
    await weekBtn!.trigger('click')
    await flushPromises()
    expect(api.sessionsStatsCost).toHaveBeenCalledTimes(2)
    expect(api.sessionsStatsCost).toHaveBeenLastCalledWith('/p/db', { period: 'week', limit: 30 })
    wrapper.unmount()
  })

  it('formatCost: $0.01 for 0.01, $0.00 for 0 cost row', async () => {
    const api = window.electronAPI as Record<string, ReturnType<typeof vi.fn>>
    api.sessionsStatsCost.mockResolvedValue({
      success: true,
      rows: [
        { agent_name: 'a1', agent_id: 1, period: '2026-01-01', session_count: 1, total_cost: 0.01, avg_duration_s: 10, total_turns: 1, total_tokens: 100, cache_read: 0, cache_write: 10 },
      ],
    })
    const wrapper = mount(CostStatsSection, {
      props: { dbPath: '/p/db' },
      global: { plugins: [i18n] },
    })
    await flushPromises()
    // globalCost = 0.01 → '$0.01'
    expect(wrapper.text()).toContain('$0.01')
    wrapper.unmount()

    // Zero cost row → $0.00
    api.sessionsStatsCost.mockResolvedValue({
      success: true,
      rows: [
        { agent_name: 'b1', agent_id: 2, period: '2026-01-01', session_count: 1, total_cost: 0, avg_duration_s: 0, total_turns: 0, total_tokens: 0, cache_read: 0, cache_write: 0 },
      ],
    })
    const w2 = mount(CostStatsSection, {
      props: { dbPath: '/p/db' },
      global: { plugins: [i18n] },
    })
    await flushPromises()
    expect(w2.text()).toContain('$0.00')
    w2.unmount()
  })

  it('re-fetches when dbPath prop changes', async () => {
    const api = window.electronAPI as Record<string, ReturnType<typeof vi.fn>>
    api.sessionsStatsCost.mockResolvedValue({ success: true, rows: [] })

    const wrapper = mount(CostStatsSection, {
      props: { dbPath: '/p/db1' },
      global: { plugins: [i18n] },
    })
    await flushPromises()
    expect(api.sessionsStatsCost).toHaveBeenCalledWith('/p/db1', { period: 'day', limit: 30 })

    await wrapper.setProps({ dbPath: '/p/db2' })
    await flushPromises()
    expect(api.sessionsStatsCost).toHaveBeenCalledWith('/p/db2', { period: 'day', limit: 30 })
    wrapper.unmount()
  })
})
