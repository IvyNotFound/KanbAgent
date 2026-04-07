import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { shallowMount } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import TaskDependencyGraph from '@renderer/components/TaskDependencyGraph.vue'
import i18n from '@renderer/plugins/i18n'
import type { TaskLink } from '@renderer/types'

function makeLink(overrides: Partial<TaskLink> = {}): TaskLink {
  return {
    id: 1,
    type: 'blocks',
    from_task: 1,
    to_task: 2,
    from_title: 'Task A',
    from_status: 'todo',
    to_title: 'Task B',
    to_status: 'in_progress',
    ...overrides,
  }
}

describe('TaskDependencyGraph', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('shows no dependencies message when links array is empty', () => {
    const wrapper = shallowMount(TaskDependencyGraph, {
      props: { taskId: 1, links: [] },
      global: { plugins: [createTestingPinia(), i18n] },
    })
    expect(wrapper.find('p').exists()).toBe(true)
    wrapper.unmount()
  })

  it('outgoing: includes links where this task blocks another (from_task=taskId, type=blocks)', () => {
    const links = [makeLink({ type: 'blocks', from_task: 1, to_task: 2 })]
    const wrapper = shallowMount(TaskDependencyGraph, {
      props: { taskId: 1, links },
      global: { plugins: [createTestingPinia(), i18n] },
    })
    // Should show outgoing section with task 2
    expect(wrapper.text()).toContain('#2')
    wrapper.unmount()
  })

  it('outgoing: includes links where this task depends on another (to_task=taskId, type=depends_on)', () => {
    const links = [makeLink({ type: 'depends_on', from_task: 2, to_task: 1, from_title: 'Task B', to_title: 'Task A' })]
    const wrapper = shallowMount(TaskDependencyGraph, {
      props: { taskId: 1, links },
      global: { plugins: [createTestingPinia(), i18n] },
    })
    // Link where to_task=taskId and type=dépend_de → outgoing
    expect(wrapper.text()).toContain('#2')
    wrapper.unmount()
  })

  it('incoming: includes links where another task blocks this one (to_task=taskId, type=blocks)', () => {
    const links = [makeLink({ type: 'blocks', from_task: 3, to_task: 1, from_title: 'Task C', to_title: 'Task A', from_status: 'in_progress', to_status: 'todo' })]
    const wrapper = shallowMount(TaskDependencyGraph, {
      props: { taskId: 1, links },
      global: { plugins: [createTestingPinia(), i18n] },
    })
    // incoming section should show task 3
    expect(wrapper.text()).toContain('#3')
    wrapper.unmount()
  })

  it('incoming: includes links where this task has from_task=taskId and type=depends_on', () => {
    const links = [makeLink({ type: 'depends_on', from_task: 1, to_task: 4, to_title: 'Task D', to_status: 'done' })]
    const wrapper = shallowMount(TaskDependencyGraph, {
      props: { taskId: 1, links },
      global: { plugins: [createTestingPinia(), i18n] },
    })
    // incoming section should show task 4
    expect(wrapper.text()).toContain('#4')
    wrapper.unmount()
  })

  it('related: includes related_to links involving this task', () => {
    const links = [makeLink({ type: 'related_to', from_task: 1, to_task: 5, to_title: 'Task E', to_status: 'todo' })]
    const wrapper = shallowMount(TaskDependencyGraph, {
      props: { taskId: 1, links },
      global: { plugins: [createTestingPinia(), i18n] },
    })
    expect(wrapper.text()).toContain('#5')
    wrapper.unmount()
  })

  it('related: includes duplicates links involving this task', () => {
    const links = [makeLink({ type: 'duplicates', from_task: 6, to_task: 1, from_title: 'Task F', from_status: 'todo', to_title: 'Task A', to_status: 'todo' })]
    const wrapper = shallowMount(TaskDependencyGraph, {
      props: { taskId: 1, links },
      global: { plugins: [createTestingPinia(), i18n] },
    })
    expect(wrapper.text()).toContain('#6')
    wrapper.unmount()
  })

  it('emits navigate event when a link button is clicked', async () => {
    const links = [makeLink({ type: 'blocks', from_task: 1, to_task: 7, to_title: 'Task G', to_status: 'todo' })]
    const wrapper = shallowMount(TaskDependencyGraph, {
      props: { taskId: 1, links },
      global: { plugins: [createTestingPinia(), i18n] },
    })
    // Click the first link button (native button, not v-btn)
    const btn = wrapper.find('button')
    expect(btn.exists()).toBe(true)
    await btn.trigger('click')
    expect(wrapper.emitted('navigate')).toBeTruthy()
    expect(wrapper.emitted('navigate')![0]).toEqual([7])
    wrapper.unmount()
  })

  it('linkedTaskId returns to_task when from_task equals taskId', () => {
    const links = [makeLink({ type: 'blocks', from_task: 1, to_task: 99 })]
    const wrapper = shallowMount(TaskDependencyGraph, {
      props: { taskId: 1, links },
      global: { plugins: [createTestingPinia(), i18n] },
    })
    expect(wrapper.text()).toContain('#99')
    wrapper.unmount()
  })

  it('linkedTaskId returns from_task when to_task equals taskId', () => {
    const links = [makeLink({ type: 'blocks', from_task: 88, to_task: 1, from_title: 'Task 88', from_status: 'todo', to_title: 'Task A', to_status: 'todo' })]
    const wrapper = shallowMount(TaskDependencyGraph, {
      props: { taskId: 1, links },
      global: { plugins: [createTestingPinia(), i18n] },
    })
    expect(wrapper.text()).toContain('#88')
    wrapper.unmount()
  })
})
