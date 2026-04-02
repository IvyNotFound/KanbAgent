import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount, shallowMount, flushPromises } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import { nextTick } from 'vue'
import TaskCard from '@renderer/components/TaskCard.vue'
import TaskDetailModal from '@renderer/components/TaskDetailModal.vue'
import i18n from '@renderer/plugins/i18n'

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    title: 'Fix login bug',
    description: 'Users cannot login with special chars',
    status: 'todo',
    scope: 'front-vuejs',
    effort: 2,
    agent_assigned_id: 1,
    agent_name: 'dev-front',
    agent_creator_id: null,
    agent_creator_name: null,
    agent_scope: null,
    agent_validator_id: null,
    priority: 'normal',
    parent_task_id: null,
    session_id: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    started_at: null,
    completed_at: null,
    validated_at: null,
    ...overrides,
  } as Task
}

// ── StatusColumn ──────────────────────────────────────────────────────────────

describe('TaskCard', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('renders the task title', () => {
    const wrapper = shallowMount(TaskCard, {
      props: { task: makeTask({ title: 'My important task' }) },
      global: { plugins: [i18n] },
    })
    expect(wrapper.text()).toContain('My important task')
  })

  it('renders the task id', () => {
    const wrapper = shallowMount(TaskCard, {
      props: { task: makeTask({ id: 42 }) },
      global: { plugins: [i18n] },
    })
    expect(wrapper.text()).toContain('#42')
  })

  it('renders effort badge S for effort=1', () => {
    const wrapper = shallowMount(TaskCard, {
      props: { task: makeTask({ effort: 1 }) },
      global: { plugins: [i18n] },
    })
    const badges = wrapper.findAll('span').filter(s => s.text() === 'S')
    expect(badges.length).toBeGreaterThanOrEqual(1)
  })

  it('renders effort badge M for effort=2', () => {
    const wrapper = shallowMount(TaskCard, {
      props: { task: makeTask({ effort: 2 }) },
      global: { plugins: [i18n] },
    })
    const badges = wrapper.findAll('span').filter(s => s.text() === 'M')
    expect(badges.length).toBeGreaterThanOrEqual(1)
  })

  it('renders effort badge L for effort=3', () => {
    const wrapper = shallowMount(TaskCard, {
      props: { task: makeTask({ effort: 3 }) },
      global: { plugins: [i18n] },
    })
    const badges = wrapper.findAll('span').filter(s => s.text() === 'L')
    expect(badges.length).toBeGreaterThanOrEqual(1)
  })

  it('renders priority badge !! for critical', () => {
    const wrapper = shallowMount(TaskCard, {
      props: { task: makeTask({ priority: 'critical' } as Partial<Task>) },
      global: { plugins: [i18n] },
    })
    expect(wrapper.text()).toContain('!!')
  })

  it('renders priority badge ! for high', () => {
    const wrapper = shallowMount(TaskCard, {
      props: { task: makeTask({ priority: 'high' } as Partial<Task>) },
      global: { plugins: [i18n] },
    })
    // Has "!" but not "!!"
    const badges = wrapper.findAll('span').filter(s => s.text().trim() === '!')
    expect(badges.length).toBeGreaterThanOrEqual(1)
  })

  it('shows scope badge when task has scope', () => {
    const wrapper = shallowMount(TaskCard, {
      props: { task: makeTask({ scope: 'front-vuejs' }) },
      global: { plugins: [i18n] },
    })
    expect(wrapper.text()).toContain('front-vuejs')
  })

  it('shows AgentBadge when task has agent_name', () => {
    const wrapper = shallowMount(TaskCard, {
      props: { task: makeTask({ agent_name: 'review-master' }) },
      global: { plugins: [i18n] },
    })
    const badge = wrapper.findComponent({ name: 'AgentBadge' })
    expect(badge.exists()).toBe(true)
  })

  it('calls store.openTask when card is clicked', async () => {
    const task = makeTask()
    const pinia = createTestingPinia()
    const wrapper = shallowMount(TaskCard, {
      props: { task },
      global: { plugins: [pinia, i18n] },
    })

    await wrapper.find('div').trigger('click')

    const { useTasksStore } = await import('@renderer/stores/tasks')
    const store = useTasksStore()
    expect(store.openTask).toHaveBeenCalledWith(task)
  })

  it('does not show effort badge when effort is undefined', () => {
    const wrapper = shallowMount(TaskCard, {
      props: { task: makeTask({ effort: undefined as unknown as number }) },
      global: { plugins: [i18n] },
    })
    const labels = ['S', 'M', 'L']
    const badges = wrapper.findAll('span').filter(s => labels.includes(s.text().trim()))
    expect(badges.length).toBe(0)
  })

  // ── T575: context menu on in_progress tasks ──
  it('shows ContextMenu on right-click when task is in_progress (T575)', async () => {
    const task = makeTask({ status: 'in_progress' })
    const pinia = createTestingPinia({
      initialState: { tasks: { agents: [], dbPath: '/p/db' }, tabs: { tabs: [] } },
    })
    const wrapper = shallowMount(TaskCard, {
      props: { task },
      global: { plugins: [pinia, i18n] },
    })
    expect(wrapper.findComponent({ name: 'ContextMenu' }).exists()).toBe(false)
    await wrapper.find('div').trigger('contextmenu', { clientX: 100, clientY: 200 })
    await nextTick()
    const menu = wrapper.findComponent({ name: 'ContextMenu' })
    expect(menu.exists()).toBe(true)
    expect(menu.props('x')).toBe(100)
    expect(menu.props('y')).toBe(200)
  })

  it('does not show ContextMenu on right-click when task is todo (T575)', async () => {
    const task = makeTask({ status: 'todo' })
    const pinia = createTestingPinia({
      initialState: { tasks: { agents: [], dbPath: '/p/db' }, tabs: { tabs: [] } },
    })
    const wrapper = shallowMount(TaskCard, {
      props: { task },
      global: { plugins: [pinia, i18n] },
    })
    await wrapper.find('div').trigger('contextmenu', { clientX: 50, clientY: 50 })
    await nextTick()
    expect(wrapper.findComponent({ name: 'ContextMenu' }).exists()).toBe(false)
  })

  it('closes ContextMenu when @close is emitted (T575)', async () => {
    const task = makeTask({ status: 'in_progress' })
    const pinia = createTestingPinia({
      initialState: { tasks: { agents: [], dbPath: '/p/db' }, tabs: { tabs: [] } },
    })
    const wrapper = shallowMount(TaskCard, {
      props: { task },
      global: { plugins: [pinia, i18n] },
    })
    await wrapper.find('div').trigger('contextmenu', { clientX: 10, clientY: 10 })
    await nextTick()
    const menu = wrapper.findComponent({ name: 'ContextMenu' })
    expect(menu.exists()).toBe(true)
    await menu.vm.$emit('close')
    await nextTick()
    expect(wrapper.findComponent({ name: 'ContextMenu' }).exists()).toBe(false)
  })

  it('shows "Session already active" label when tab already open for task (T575)', async () => {
    const task = makeTask({ status: 'in_progress', id: 42 })
    const pinia = createTestingPinia({
      initialState: {
        tasks: { agents: [], dbPath: '/p/db' },
        tabs: { tabs: [{ id: 't1', type: 'terminal', taskId: 42, agentName: 'dev' }] },
      },
    })
    const wrapper = shallowMount(TaskCard, {
      props: { task },
      global: { plugins: [pinia, i18n] },
    })
    await wrapper.find('div').trigger('contextmenu', { clientX: 10, clientY: 10 })
    await nextTick()
    const menu = wrapper.findComponent({ name: 'ContextMenu' })
    expect(menu.exists()).toBe(true)
    const items = menu.props('items') as Array<{ label: string }>
    // Label should be "Session already active" (en) or "Session déjà active" (fr)
    expect(items[0].label).toMatch(/session/i)
  })
})

// ── Sidebar (T230) ───────────────────────────────────────────────────────────

import Sidebar from '@renderer/components/Sidebar.vue'
import SidebarAgentSection from '@renderer/components/SidebarAgentSection.vue'

describe('TaskCard — multi-agents', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('falls back to AgentBadge when task_agents is empty', async () => {
    const api = window.electronAPI as Record<string, ReturnType<typeof vi.fn>>
    api.getTaskAssignees.mockResolvedValue({ success: true, assignees: [] })

    const wrapper = shallowMount(TaskCard, {
      props: { task: makeTask({ agent_name: 'dev-front' }) },
      global: {
        plugins: [createTestingPinia({
          initialState: { tasks: { dbPath: '/p/db', agents: [] } },
        }), i18n],
      },
    })
    await flushPromises()

    // No avatars rendered — AgentBadge fallback is shown
    const avatarDivs = wrapper.findAll('div.avatar')
    expect(avatarDivs.length).toBe(0)
    const badge = wrapper.findComponent({ name: 'AgentBadge' })
    expect(badge.exists()).toBe(true)
  })

  it('renders 2 avatars when boardAssignees has 2 agents for task (T787)', async () => {
    const task = makeTask({ id: 1 })
    const assignees = [
      { agent_id: 1, agent_name: 'dev-front', role: 'primary', assigned_at: '' },
      { agent_id: 2, agent_name: 'test-front', role: null, assigned_at: '' },
    ]

    const wrapper = shallowMount(TaskCard, {
      props: { task },
      global: {
        plugins: [createTestingPinia({
          initialState: { tasks: { dbPath: '/p/db', agents: [], boardAssignees: new Map([[1, assignees]]) } },
        }), i18n],
      },
    })
    await nextTick()

    const avatarDivs = wrapper.findAll('div.avatar')
    expect(avatarDivs.length).toBe(2)
    const overflowBadge = wrapper.findAll('div.avatar').find(d => d.text().startsWith('+'))
    expect(overflowBadge).toBeUndefined()
  })

  it('renders 3 avatars without overflow badge when boardAssignees has exactly 3 agents (T787)', async () => {
    const task = makeTask({ id: 1 })
    const assignees = [
      { agent_id: 1, agent_name: 'dev-front', role: 'primary', assigned_at: '' },
      { agent_id: 2, agent_name: 'test-front', role: null, assigned_at: '' },
      { agent_id: 3, agent_name: 'review', role: 'reviewer', assigned_at: '' },
    ]

    const wrapper = shallowMount(TaskCard, {
      props: { task },
      global: {
        plugins: [createTestingPinia({
          initialState: { tasks: { dbPath: '/p/db', agents: [], boardAssignees: new Map([[1, assignees]]) } },
        }), i18n],
      },
    })
    await nextTick()

    const allRounded = wrapper.findAll('div.avatar')
    expect(allRounded.length).toBe(3)
    const overflowBadge = allRounded.find(d => d.text().startsWith('+'))
    expect(overflowBadge).toBeUndefined()
  })

  it('renders 3 avatars + "+1" overflow badge when boardAssignees has 4 agents (T787)', async () => {
    const task = makeTask({ id: 1 })
    const assignees = [
      { agent_id: 1, agent_name: 'dev-front', role: 'primary', assigned_at: '' },
      { agent_id: 2, agent_name: 'test-front', role: null, assigned_at: '' },
      { agent_id: 3, agent_name: 'review', role: 'reviewer', assigned_at: '' },
      { agent_id: 4, agent_name: 'arch', role: null, assigned_at: '' },
    ]

    const wrapper = shallowMount(TaskCard, {
      props: { task },
      global: {
        plugins: [createTestingPinia({
          initialState: { tasks: { dbPath: '/p/db', agents: [], boardAssignees: new Map([[1, assignees]]) } },
        }), i18n],
      },
    })
    await nextTick()

    const allRounded = wrapper.findAll('div.avatar')
    expect(allRounded.length).toBe(4)
    const overflowBadge = allRounded.find(d => d.text().trim() === '+1')
    expect(overflowBadge).toBeDefined()
  })
})
