import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import i18n from '@renderer/plugins/i18n'
import TopologyView from '@renderer/components/TopologyView.vue'

const baseAgents = [
  { id: 1, name: 'dev-front', type: 'dev', scope: 'front-vuejs', session_status: 'started', session_tokens: 1200 },
  { id: 2, name: 'dev-back', type: 'dev', scope: 'back-electron', session_status: null, session_tokens: null },
]

const baseTasks = [
  { id: 10, title: 'Build UI', status: 'in_progress', agent_assigned_id: 1, effort: 2 },
]

describe('TopologyView (T750)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders agent cards grouped by perimetre (T750)', async () => {
    const wrapper = mount(TopologyView, {
      global: {
        plugins: [createTestingPinia({
          initialState: {
            tasks: { dbPath: '/p/db', agents: baseAgents, tasks: baseTasks },
          },
        }), i18n],
      },
    })
    await flushPromises()
    expect(wrapper.text()).toContain('dev-front')
    expect(wrapper.text()).toContain('dev-back')
    expect(wrapper.text()).toContain('front-vuejs')
    expect(wrapper.text()).toContain('Build UI')
    wrapper.unmount()
  })

  it('shows empty state when no agents returned (T750)', async () => {
    const wrapper = mount(TopologyView, {
      global: {
        plugins: [createTestingPinia({
          initialState: {
            tasks: { dbPath: '/p/db', agents: [], tasks: [] },
          },
        }), i18n],
      },
    })
    await flushPromises()
    const text = wrapper.text().toLowerCase()
    expect(text).toMatch(/no agents|aucun agent/)
    wrapper.unmount()
  })

  it('groups agents with null perimetre into global column (T750)', async () => {
    const wrapper = mount(TopologyView, {
      global: {
        plugins: [createTestingPinia({
          initialState: {
            tasks: {
              dbPath: '/p/db',
              agents: [{ id: 3, name: 'arch', type: 'arch', scope: null, session_status: null, session_tokens: null }],
              tasks: [],
            },
          },
        }), i18n],
      },
    })
    await flushPromises()
    expect(wrapper.text()).toContain('arch')
    const text = wrapper.text().toLowerCase()
    expect(text).toMatch(/global/)
    wrapper.unmount()
  })

  it('sets selectedAgentId on agent card click (T750)', async () => {
    const pinia = createTestingPinia({
      initialState: {
        tasks: { dbPath: '/p/db', agents: baseAgents, tasks: baseTasks },
        tabs: { activeTabId: 'topology' },
      },
      stubActions: false,
    })
    const wrapper = mount(TopologyView, {
      global: { plugins: [pinia, i18n] },
    })
    await flushPromises()
    // Find the dev-front agent card (scope=front-vuejs, id=1)
    const cards = wrapper.findAll('.tp-card')
    const devFrontCard = cards.find(c => c.text().includes('dev-front'))!
    await devFrontCard.trigger('click')
    const { useTasksStore: getTasksStore } = await import('@renderer/stores/tasks')
    const tasksStore = getTasksStore(pinia)
    expect(tasksStore.selectedAgentId).toBe(1)
    wrapper.unmount()
  })
})
