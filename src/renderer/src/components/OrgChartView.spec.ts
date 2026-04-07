import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import i18n from '@renderer/plugins/i18n'
import OrgChartView from '@renderer/components/OrgChartView.vue'

const AGENT_ROW = (overrides = {}) => ({
  id: 1,
  name: 'dev-front',
  type: 'dev',
  scope: 'front-vuejs',
  session_status: null,
  tasks_in_progress: 0,
  tasks_todo: 0,
  ...overrides,
})

describe('OrgChartView (T921/T1041)', () => {
  beforeEach(() => {
    const api = window.electronAPI as Record<string, ReturnType<typeof vi.fn>>
    api.queryDb = vi.fn()
  })

  it('renders SVG when agents returned (T921)', async () => {
    const api = window.electronAPI as Record<string, ReturnType<typeof vi.fn>>
    api.queryDb.mockResolvedValue([AGENT_ROW()])

    const wrapper = mount(OrgChartView, {
      global: {
        plugins: [createTestingPinia({ initialState: { tasks: { dbPath: '/p/db' } } }), i18n],
      },
    })
    await flushPromises()
    expect(wrapper.find('svg').exists()).toBe(true)
    wrapper.unmount()
  })

  it('shows empty state when no agents (T921)', async () => {
    const api = window.electronAPI as Record<string, ReturnType<typeof vi.fn>>
    api.queryDb.mockResolvedValue([])

    const wrapper = mount(OrgChartView, {
      global: {
        plugins: [createTestingPinia({ initialState: { tasks: { dbPath: '/p/db' } } }), i18n],
      },
    })
    await flushPromises()
    expect(wrapper.find('svg').exists()).toBe(false)
    const text = wrapper.text().toLowerCase()
    expect(text).toMatch(/aucun agent|no agents/)
    wrapper.unmount()
  })

  it('renders group headers for each scope (T921)', async () => {
    const api = window.electronAPI as Record<string, ReturnType<typeof vi.fn>>
    api.queryDb.mockResolvedValue([
      AGENT_ROW({ id: 1, name: 'dev-front', scope: 'front-vuejs' }),
      AGENT_ROW({ id: 2, name: 'dev-back', scope: 'back-electron' }),
    ])

    const wrapper = mount(OrgChartView, {
      global: {
        plugins: [createTestingPinia({ initialState: { tasks: { dbPath: '/p/db' } } }), i18n],
      },
    })
    await flushPromises()
    const svgText = wrapper.find('svg').text()
    expect(svgText).toContain('front-vuejs')
    expect(svgText).toContain('back-electron')
    wrapper.unmount()
  })

  it('groups null-scope agents under Global (T921)', async () => {
    const api = window.electronAPI as Record<string, ReturnType<typeof vi.fn>>
    api.queryDb.mockResolvedValue([
      AGENT_ROW({ id: 3, name: 'arch', scope: null }),
    ])

    const wrapper = mount(OrgChartView, {
      global: {
        plugins: [createTestingPinia({ initialState: { tasks: { dbPath: '/p/db' } } }), i18n],
      },
    })
    await flushPromises()
    expect(wrapper.find('svg').text()).toContain('Global')
    wrapper.unmount()
  })

  it('layout: positions multiple agents side by side within a group (T921)', async () => {
    const api = window.electronAPI as Record<string, ReturnType<typeof vi.fn>>
    api.queryDb.mockResolvedValue([
      AGENT_ROW({ id: 1, name: 'agent-a', scope: 'front' }),
      AGENT_ROW({ id: 2, name: 'agent-b', scope: 'front' }),
    ])

    const wrapper = mount(OrgChartView, {
      global: {
        plugins: [createTestingPinia({ initialState: { tasks: { dbPath: '/p/db' } } }), i18n],
      },
    })
    await flushPromises()
    // Two agents in same group -> at least 1 group rect + 2 agent card rects
    const rects = wrapper.findAll('rect')
    expect(rects.length).toBeGreaterThanOrEqual(3)
    wrapper.unmount()
  })

  it('hierarchical layout: shows parent group containing children (T1041)', async () => {
    const api = window.electronAPI as Record<string, ReturnType<typeof vi.fn>>
    api.queryDb.mockResolvedValue([
      AGENT_ROW({ id: 1, name: 'arch', scope: null }),
    ])

    const wrapper = mount(OrgChartView, {
      global: {
        plugins: [
          createTestingPinia({
            initialState: {
              tasks: { dbPath: '/p/db' },
              agents: {
                agentGroups: [
                  {
                    id: 10, name: 'Les patrons', sort_order: 0, parent_id: null, created_at: '',
                    members: [],
                    children: [
                      {
                        id: 11, name: 'Global', sort_order: 0, parent_id: 10, created_at: '',
                        members: [{ agent_id: 1, sort_order: 0 }],
                      },
                    ],
                  },
                  {
                    id: 11, name: 'Global', sort_order: 0, parent_id: 10, created_at: '',
                    members: [{ agent_id: 1, sort_order: 0 }],
                  },
                ],
              },
            },
          }),
          i18n,
        ],
      },
    })
    await flushPromises()
    const svgText = wrapper.find('svg').text()
    expect(svgText).toContain('Les patrons')
    expect(svgText).toContain('Global')
    const rects = wrapper.findAll('rect')
    expect(rects.length).toBeGreaterThanOrEqual(3)
    wrapper.unmount()
  })

  it('status: cyan for started session (T921)', async () => {
    const api = window.electronAPI as Record<string, ReturnType<typeof vi.fn>>
    api.queryDb.mockResolvedValue([
      AGENT_ROW({ session_status: 'started' }),
    ])

    const wrapper = mount(OrgChartView, {
      global: {
        plugins: [createTestingPinia({ initialState: { tasks: { dbPath: '/p/db' } } }), i18n],
      },
    })
    await flushPromises()
    const circles = wrapper.findAll('circle')
    const cyanCircle = circles.find(c => c.attributes('fill') === '#67e8f9')
    expect(cyanCircle).toBeDefined()
    wrapper.unmount()
  })

  it('status: red for blocked session (T921)', async () => {
    const api = window.electronAPI as Record<string, ReturnType<typeof vi.fn>>
    api.queryDb.mockResolvedValue([
      AGENT_ROW({ session_status: 'blocked' }),
    ])

    const wrapper = mount(OrgChartView, {
      global: {
        plugins: [createTestingPinia({ initialState: { tasks: { dbPath: '/p/db' } } }), i18n],
      },
    })
    await flushPromises()
    const circles = wrapper.findAll('circle')
    const redCircle = circles.find(c => c.attributes('fill') === '#fca5a5')
    expect(redCircle).toBeDefined()
    wrapper.unmount()
  })

  it('status: green when agent has todo tasks and no active session (T921)', async () => {
    const api = window.electronAPI as Record<string, ReturnType<typeof vi.fn>>
    api.queryDb.mockResolvedValue([
      AGENT_ROW({ session_status: null, tasks_todo: 2 }),
    ])

    const wrapper = mount(OrgChartView, {
      global: {
        plugins: [createTestingPinia({ initialState: { tasks: { dbPath: '/p/db' } } }), i18n],
      },
    })
    await flushPromises()
    const circles = wrapper.findAll('circle')
    const greenCircle = circles.find(c => c.attributes('fill') === '#86efac')
    expect(greenCircle).toBeDefined()
    wrapper.unmount()
  })
})
