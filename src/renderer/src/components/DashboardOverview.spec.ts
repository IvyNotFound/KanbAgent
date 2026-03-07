import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import { createI18n } from 'vue-i18n'
import en from '@renderer/locales/en.json'
import { useTasksStore } from '@renderer/stores/tasks'
import DashboardOverview from '@renderer/components/DashboardOverview.vue'
import { mockElectronAPI } from '../../../test/setup'

const i18n = createI18n({ legacy: false, locale: 'en', messages: { en } })

const CHILD_STUBS = {
  ActivityHeatmap: { template: '<div class="stub-heatmap" />' },
  SessionActivityChart: { template: '<div class="stub-session-chart" />' },
  SuccessRateChart: { template: '<div class="stub-success-chart" />' },
  AgentQualityPanel: { template: '<div class="stub-quality" />' },
  WorkloadView: { template: '<div class="stub-workload" />' },
  CodeTelemetryPanel: { template: '<div class="stub-code-telemetry" />' },
}

function mountWithState(state: Record<string, unknown>) {
  const pinia = createTestingPinia({ initialState: state })
  const store = useTasksStore(pinia)
  // Provide query as a real stub returning empty arrays by default
  ;(store.query as ReturnType<typeof vi.fn>).mockResolvedValue([])
  const wrapper = mount(DashboardOverview, { global: { plugins: [pinia, i18n], stubs: CHILD_STUBS } })
  return { wrapper, store, pinia }
}

const BASE_STATE = {
  tasks: {
    dbPath: '/tmp/test.db',
    tasks: [],
    agents: [],
    stats: { todo: 0, in_progress: 0, done: 0, archived: 0 },
  },
}

describe('DashboardOverview (T923)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockElectronAPI.queryDb.mockResolvedValue([])
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('shows empty state when dbPath is null', async () => {
    const { wrapper } = mountWithState({
      tasks: { dbPath: null, tasks: [], agents: [], stats: { todo: 0, in_progress: 0, done: 0, archived: 0 } },
    })
    await flushPromises()
    expect(wrapper.text()).toContain('No project open')
    wrapper.unmount()
  })

  it('renders 4 metric section labels when dbPath is set', async () => {
    const { wrapper } = mountWithState(BASE_STATE)
    await flushPromises()
    expect(wrapper.text()).toContain('Active agents')
    expect(wrapper.text()).toContain('In progress')
    expect(wrapper.text()).toContain('To do')
    expect(wrapper.text()).toContain('Today')
    wrapper.unmount()
  })

  it('displays in_progress and todo counts from store stats', async () => {
    const { wrapper } = mountWithState({
      tasks: {
        dbPath: '/tmp/test.db',
        tasks: [],
        agents: [],
        stats: { todo: 5, in_progress: 3, done: 0, archived: 0 },
      },
    })
    await flushPromises()
    const text = wrapper.text()
    expect(text).toContain('3')
    expect(text).toContain('5')
    wrapper.unmount()
  })

  it('counts active agents (session_statut = started)', async () => {
    const { wrapper } = mountWithState({
      tasks: {
        dbPath: '/tmp/test.db',
        tasks: [],
        agents: [
          { id: 1, name: 'agent-a', session_statut: 'started' },
          { id: 2, name: 'agent-b', session_statut: 'completed' },
          { id: 3, name: 'agent-c', session_statut: 'started' },
        ],
        stats: { todo: 0, in_progress: 0, done: 0, archived: 0 },
      },
    })
    await flushPromises()
    const metricValues = wrapper.findAll('.tabular-nums')
    // 2 agents with session_statut='started'
    expect(metricValues.some(el => el.text() === '2')).toBe(true)
    wrapper.unmount()
  })

  it('shows "Aucune tâche" empty state when tasks list is empty', async () => {
    const { wrapper } = mountWithState(BASE_STATE)
    await flushPromises()
    expect(wrapper.text()).toContain('No tasks')
    wrapper.unmount()
  })

  it('shows "Aucune activité" when query returns no logs', async () => {
    const { wrapper } = mountWithState(BASE_STATE)
    await flushPromises()
    expect(wrapper.text()).toContain('No activity')
    wrapper.unmount()
  })

  it('renders recent tasks from store', async () => {
    const { wrapper } = mountWithState({
      tasks: {
        dbPath: '/tmp/test.db',
        tasks: [
          { id: 1, titre: 'Task Alpha', statut: 'todo', updated_at: '2026-01-01T10:00:00', priority: 'normal', agent_name: null },
          { id: 2, titre: 'Task Beta', statut: 'in_progress', updated_at: '2026-01-02T10:00:00', priority: 'high', agent_name: 'agent-x' },
        ],
        agents: [],
        stats: { todo: 1, in_progress: 1, done: 0, archived: 0 },
      },
    })
    await flushPromises()
    expect(wrapper.text()).toContain('Task Alpha')
    expect(wrapper.text()).toContain('Task Beta')
    wrapper.unmount()
  })

  it('renders activity entries when query returns logs', async () => {
    const pinia = createTestingPinia({ initialState: BASE_STATE })
    const store = useTasksStore(pinia)
    ;(store.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([{ count: 2 }]) // sessions today
      .mockResolvedValueOnce([
        { created_at: '2026-01-01T10:00:00', action: 'task_started', detail: 'T999', agent_name: 'agent-y' },
      ])
    const wrapper = mount(DashboardOverview, { global: { plugins: [pinia, i18n], stubs: CHILD_STUBS } })
    await flushPromises()
    expect(wrapper.text()).toContain('task_started')
    wrapper.unmount()
  })

  it('renders section headers for tâches récentes and activité récente', async () => {
    const { wrapper } = mountWithState(BASE_STATE)
    await flushPromises()
    expect(wrapper.text()).toContain('Recent tasks')
    expect(wrapper.text()).toContain('Recent activity')
    wrapper.unmount()
  })
})

// ---------------------------------------------------------------------------
// relativeTime() pure logic (T923)
// ---------------------------------------------------------------------------

describe('DashboardOverview relativeTime() logic (T923)', () => {
  const relativeTime = (dateStr: string): string => {
    const diff = Date.now() - new Date(dateStr).getTime()
    const s = Math.floor(diff / 1000)
    if (s < 60) return `${s}s`
    const m = Math.floor(s / 60)
    if (m < 60) return `${m}m`
    const h = Math.floor(m / 60)
    if (h < 24) return `${h}h`
    return `${Math.floor(h / 24)}d`
  }

  it('returns seconds when diff < 60s', () => {
    const recent = new Date(Date.now() - 5000).toISOString()
    expect(relativeTime(recent)).toBe('5s')
  })

  it('returns minutes when diff >= 60s and < 1h', () => {
    const twoMinAgo = new Date(Date.now() - 120000).toISOString()
    expect(relativeTime(twoMinAgo)).toBe('2m')
  })

  it('returns hours when diff >= 1h and < 24h', () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 3600 * 1000).toISOString()
    expect(relativeTime(threeHoursAgo)).toBe('3h')
  })

  it('returns days (d) when diff >= 24h', () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString()
    expect(relativeTime(twoDaysAgo)).toBe('2d')
  })
})
