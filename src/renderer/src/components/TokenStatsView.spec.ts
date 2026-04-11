import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount, shallowMount, flushPromises } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import TokenStatsView from '@renderer/components/TokenStatsView.vue'
import i18n from '@renderer/plugins/i18n'

// Stub for TokenStatsSummaryCards — renders formatted total so text assertions work
const tokenStatsSummaryCardsStub = {
  props: ['total', 'tokensIn', 'tokensOut', 'avgPerSession', 'estimatedCost',
    'cacheHitRate', 'cacheHitColor', 'sparkBars', 'sparkBarHeight', 'hoveredSparkBar'],
  template: '<div>{{ typeof total === "number" ? (total >= 1000 ? (total / 1000).toFixed(1).replace(".0", "") + "k" : String(total)) : "" }}</div>',
}

describe('TokenStatsView (T353)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    const api = window.electronAPI as Record<string, ReturnType<typeof vi.fn>>
    // Mock 4 queryDb calls: period-stats, per-agent, per-session, sparkline-7d (T634+T635)
    api.queryDb
      .mockResolvedValueOnce([{ tokens_in: 1000, tokens_out: 500, tokens_cache_read: 200, tokens_cache_write: 100, total: 1500, session_count: 5 }])
      .mockResolvedValueOnce([
        { agent_id: 1, agent_name: 'dev-front', tokens_in: 800, tokens_out: 400, tokens_cache_read: 150, tokens_cache_write: 50, total: 1200, session_count: 3 },
      ])
      .mockResolvedValueOnce([
        { id: 1, agent_id: 1, agent_name: 'dev-front', started_at: '2026-01-01T10:00:00Z', ended_at: null, statut: 'en_cours', tokens_in: 200, tokens_out: 100, tokens_cache_read: 50, tokens_cache_write: 20, total: 300 },
      ])
      .mockResolvedValueOnce([
        { day: '2026-01-25', total: 500 },
        { day: '2026-01-26', total: 1200 },
      ])
  })

  it('renders token stats cards after data loads', async () => {
    const wrapper = shallowMount(TokenStatsView, {
      global: {
        plugins: [createTestingPinia({
          initialState: {
            tasks: { dbPath: '/p/.claude/db' },
            tabs: { activeTabId: 'dashboard' },
          },
          stubActions: false,
        }), i18n],
        stubs: { TokenStatsSummaryCards: tokenStatsSummaryCardsStub },
      },
    })
    await flushPromises()

    const text = wrapper.text()
    // Global stats should show formatted total (1.5k)
    expect(text).toContain('1.5k')
  })

  it('renders per-agent rows with agent names', async () => {
    const wrapper = shallowMount(TokenStatsView, {
      global: {
        plugins: [createTestingPinia({
          initialState: {
            tasks: { dbPath: '/p/.claude/db' },
            tabs: { activeTabId: 'dashboard' },
          },
          stubActions: false,
        }), i18n],
      },
    })
    await flushPromises()

    const badges = wrapper.findAllComponents({ name: 'AgentBadge' })
    expect(badges.length).toBeGreaterThan(0)
    expect(badges[0].props('name')).toBe('dev-front')
  })

  it('renders session table with session IDs', async () => {
    const wrapper = shallowMount(TokenStatsView, {
      global: {
        plugins: [createTestingPinia({
          initialState: {
            tasks: { dbPath: '/p/.claude/db' },
            tabs: { activeTabId: 'dashboard' },
          },
          stubActions: false,
        }), i18n],
      },
    })
    await flushPromises()

    expect(wrapper.text()).toContain('#1')
  })

  it('shows empty state when no data', async () => {
    const api = window.electronAPI as Record<string, ReturnType<typeof vi.fn>>
    // Reset all mocks to return empty (T634+T635: 4 calls — period-stats, per-agent, per-session, sparkline)
    api.queryDb.mockReset()
    api.queryDb
      .mockResolvedValueOnce([{ tokens_in: 0, tokens_out: 0, tokens_cache_read: 0, tokens_cache_write: 0, total: 0, session_count: 0 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    const wrapper = shallowMount(TokenStatsView, {
      global: {
        plugins: [createTestingPinia({
          initialState: {
            tasks: { dbPath: '/p/.claude/db' },
            tabs: { activeTabId: 'dashboard' },
          },
          stubActions: false,
        }), i18n],
      },
    })
    await flushPromises()

    // "Aucune donnée" or "No data"
    const text = wrapper.text()
    expect(text).toContain('Aucune donn')
  })

})
