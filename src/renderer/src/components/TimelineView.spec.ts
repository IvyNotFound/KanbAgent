import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, shallowMount, flushPromises } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import TimelineView from '@renderer/components/TimelineView.vue'
import i18n from '@renderer/plugins/i18n'
import { mockElectronAPI } from '../../../test/setup'

describe('TimelineView (T842)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(mockElectronAPI.queryDb as ReturnType<typeof vi.fn>).mockResolvedValue([])
  })

  it('displays groups by agent when tasks present', async () => {
    ;(mockElectronAPI.queryDb as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 1, title: 'Task A', status: 'done', created_at: '2026-01-01T10:00:00', started_at: '2026-01-01T10:00:00', completed_at: '2026-01-01T11:00:00', effort: 2, agentName: 'dev-agent', agentId: 1 },
    ])
    const wrapper = mount(TimelineView, {
      global: {
        plugins: [
          createTestingPinia({ initialState: { tasks: { dbPath: '/p/project.db', projectPath: '/p', lastRefresh: 0 } } }),
          i18n,
        ],
      },
    })
    await flushPromises()
    expect(wrapper.text()).toContain('dev-agent')
    wrapper.unmount()
  })

  it('shows empty state when no tasks', async () => {
    const wrapper = mount(TimelineView, {
      global: {
        plugins: [
          createTestingPinia({ initialState: { tasks: { dbPath: '/p/project.db', projectPath: '/p', lastRefresh: 0 } } }),
          i18n,
        ],
      },
    })
    await flushPromises()
    // When no tasks, groups.length === 0 → empty state shown
    expect(wrapper.text()).not.toContain('dev-agent')
    wrapper.unmount()
  })

  it('shows animate-pulse for in_progress tasks', async () => {
    ;(mockElectronAPI.queryDb as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 2, title: 'WIP Task', status: 'in_progress', created_at: '2026-01-01T09:00:00', started_at: '2026-01-01T09:00:00', completed_at: null, effort: 1, agentName: 'dev-agent', agentId: 1 },
    ])
    const wrapper = mount(TimelineView, {
      global: {
        plugins: [
          createTestingPinia({ initialState: { tasks: { dbPath: '/p/project.db', projectPath: '/p', lastRefresh: 0 } } }),
          i18n,
        ],
      },
    })
    await flushPromises()
    // in_progress bars have tl-bar--pulse class (scoped CSS migration, was animate-pulse)
    const bars = wrapper.findAll('.tl-bar--pulse')
    expect(bars.length).toBeGreaterThan(0)
    wrapper.unmount()
  })

  it('does not call queryDb when dbPath is null', async () => {
    vi.clearAllMocks()
    const wrapper = mount(TimelineView, {
      global: {
        plugins: [
          createTestingPinia({ initialState: { tasks: { dbPath: null, projectPath: null, lastRefresh: 0 } } }),
          i18n,
        ],
      },
    })
    await flushPromises()
    expect(mockElectronAPI.queryDb).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
