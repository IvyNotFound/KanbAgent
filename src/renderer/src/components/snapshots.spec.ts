/**
 * Snapshot tests for key UI components (T984, T1283)
 * Run `npx vitest run --update-snapshots` to regenerate after intentional changes.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { shallowMount, mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { createTestingPinia } from '@pinia/testing'
import i18n from '@renderer/plugins/i18n'

// ── AgentBadge ────────────────────────────────────────────────────────────────

import AgentBadge from '@renderer/components/AgentBadge.vue'

describe('AgentBadge — snapshots', () => {
  it('matches snapshot: inactive badge', () => {
    const wrapper = shallowMount(AgentBadge, {
      props: { name: 'dev-front-vuejs' },
    })
    expect(wrapper.html()).toMatchSnapshot()
  })

  it('matches snapshot: active badge with dot', () => {
    const wrapper = shallowMount(AgentBadge, {
      props: { name: 'review-master', active: true },
    })
    expect(wrapper.html()).toMatchSnapshot()
  })
})

// ── StatusColumn ──────────────────────────────────────────────────────────────

import StatusColumn from '@renderer/components/StatusColumn.vue'
import type { Task } from '@renderer/types'

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    title: 'Fix login bug',
    description: 'Description',
    status: 'todo',
    scope: 'front-vuejs',
    effort: 2,
    priority: 'normal',
    agent_assigned_id: 1,
    agent_name: 'dev-front',
    agent_creator_id: null,
    agent_creator_name: null,
    agent_scope: null,
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

describe('StatusColumn — snapshots', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('matches snapshot: empty column', () => {
    const wrapper = shallowMount(StatusColumn, {
      props: {
        title: 'Todo',
        statut: 'todo',
        tasks: [],
        accentColor: '#94a3b8',
      },
      global: {
        plugins: [createTestingPinia({
          initialState: { tasks: { agents: [], dbPath: '/p/db', boardAssignees: new Map() }, tabs: { tabs: [] } },
        }), i18n],
      },
    })
    expect(wrapper.html()).toMatchSnapshot()
  })

  it('matches snapshot: column with 2 tasks', () => {
    const tasks = [
      makeTask({ id: 1, title: 'Task Alpha', status: 'todo' }),
      makeTask({ id: 2, title: 'Task Beta', status: 'todo', priority: 'high' }),
    ]
    const wrapper = shallowMount(StatusColumn, {
      props: {
        title: 'Todo',
        statut: 'todo',
        tasks,
        accentColor: '#94a3b8',
      },
      global: {
        plugins: [createTestingPinia({
          initialState: { tasks: { agents: [], dbPath: '/p/db', boardAssignees: new Map() }, tabs: { tabs: [] } },
        }), i18n],
      },
    })
    expect(wrapper.html()).toMatchSnapshot()
  })

  it('matches snapshot: in_progress column (drop target)', () => {
    const tasks = [makeTask({ id: 3, title: 'Active Task', status: 'in_progress', effort: 3 })]
    const wrapper = shallowMount(StatusColumn, {
      props: {
        title: 'In Progress',
        statut: 'in_progress',
        tasks,
        accentColor: '#22d3ee',
      },
      global: {
        plugins: [createTestingPinia({
          initialState: { tasks: { agents: [], dbPath: '/p/db', boardAssignees: new Map() }, tabs: { tabs: [] } },
        }), i18n],
      },
    })
    expect(wrapper.html()).toMatchSnapshot()
  })
})

// ── TaskCard ──────────────────────────────────────────────────────────────────

import TaskCard from '@renderer/components/TaskCard.vue'

describe('TaskCard — snapshots', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('matches snapshot: minimal todo task', () => {
    const wrapper = shallowMount(TaskCard, {
      props: {
        task: makeTask({ id: 10, title: 'Simple Task', status: 'todo', effort: 1 }),
      },
      global: {
        plugins: [createTestingPinia({
          initialState: { tasks: { agents: [], dbPath: '/p/db', boardAssignees: new Map() }, tabs: { tabs: [] } },
        }), i18n],
      },
    })
    expect(wrapper.html()).toMatchSnapshot()
  })

  it('matches snapshot: critical in_progress task with all badges', () => {
    // started_at: null → isStale returns false → no dynamic stale tooltip
    const wrapper = shallowMount(TaskCard, {
      props: {
        task: makeTask({
          id: 42,
          title: 'Urgent Fix',
          status: 'in_progress',
          effort: 3,
          priority: 'critical',
          scope: 'back-electron',
          agent_name: 'dev-back',
          started_at: null,
        }),
      },
      global: {
        plugins: [createTestingPinia({
          initialState: { tasks: { agents: [], dbPath: '/p/db', boardAssignees: new Map() }, tabs: { tabs: [] } },
        }), i18n],
      },
    })
    expect(wrapper.html()).toMatchSnapshot()
  })

  it('matches snapshot: done task without agent or perimetre', () => {
    const wrapper = shallowMount(TaskCard, {
      props: {
        task: makeTask({
          id: 99,
          title: 'Completed Task',
          status: 'done',
          effort: undefined as unknown as number,
          priority: undefined as unknown as string,
          scope: null as unknown as string,
          agent_name: null as unknown as string,
          completed_at: '2026-01-02T00:00:00Z',
        }),
      },
      global: {
        plugins: [createTestingPinia({
          initialState: { tasks: { agents: [], dbPath: '/p/db', boardAssignees: new Map() }, tabs: { tabs: [] } },
        }), i18n],
      },
    })
    expect(wrapper.html()).toMatchSnapshot()
  })
})

// ── TabBar ────────────────────────────────────────────────────────────────────

import TabBar from '@renderer/components/TabBar.vue'

describe('TabBar — snapshots', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.stubGlobal('ResizeObserver', vi.fn().mockImplementation(function MockResizeObserver(this: ResizeObserver) {
      (this as unknown as Record<string, unknown>).observe = vi.fn();
      (this as unknown as Record<string, unknown>).unobserve = vi.fn();
      (this as unknown as Record<string, unknown>).disconnect = vi.fn()
    }))
  })

  it('matches snapshot: empty tab bar (no tabs)', () => {
    const wrapper = shallowMount(TabBar, {
      global: {
        plugins: [createTestingPinia({
          initialState: { tabs: { tabs: [], activeTabId: null } },
        }), i18n],
      },
    })
    expect(wrapper.html()).toMatchSnapshot()
  })

  it('matches snapshot: tab bar with one terminal tab', () => {
    const wrapper = shallowMount(TabBar, {
      global: {
        plugins: [createTestingPinia({
          initialState: {
            tabs: {
              tabs: [{
                id: 'tab-1',
                type: 'terminal',
                label: 'dev-front #1',
                agentName: 'dev-front',
                taskId: 1,
                permanent: false,
              }],
              activeTabId: 'tab-1',
            },
          },
        }), i18n],
      },
    })
    expect(wrapper.html()).toMatchSnapshot()
  })
})

// ── TitleBar ──────────────────────────────────────────────────────────────────

import TitleBar from '@renderer/components/TitleBar.vue'

describe('TitleBar — snapshots', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const api = window.electronAPI as Record<string, ReturnType<typeof vi.fn>>
    api.windowIsMaximized.mockResolvedValue(false)
    api.onWindowStateChange.mockReturnValue(vi.fn())
  })

  it('matches snapshot: not maximized', async () => {
    const wrapper = shallowMount(TitleBar, {
      global: { plugins: [i18n] },
    })
    await flushPromises()
    expect(wrapper.html()).toMatchSnapshot()
  })

  it('matches snapshot: maximized', async () => {
    const api = window.electronAPI as Record<string, ReturnType<typeof vi.fn>>
    api.windowIsMaximized.mockResolvedValue(true)
    const wrapper = shallowMount(TitleBar, {
      global: { plugins: [i18n] },
    })
    await flushPromises()
    expect(wrapper.html()).toMatchSnapshot()
  })
})

// ── ContextMenu ───────────────────────────────────────────────────────────────

import ContextMenu from '@renderer/components/ContextMenu.vue'

describe('ContextMenu — snapshots', () => {
  const teleportStub = { Teleport: { template: '<div><slot /></div>' } }

  it('matches snapshot: simple items (no separator)', () => {
    const wrapper = shallowMount(ContextMenu, {
      props: {
        x: 100,
        y: 200,
        items: [
          { label: 'Rename', action: () => {} },
          { label: 'Delete', action: () => {} },
        ],
      },
      global: { stubs: teleportStub },
    })
    expect(wrapper.html()).toMatchSnapshot()
  })

  it('matches snapshot: items with separator', () => {
    const wrapper = shallowMount(ContextMenu, {
      props: {
        x: 50,
        y: 80,
        items: [
          { label: 'Edit', action: () => {} },
          { label: 'Add subgroup', action: () => {} },
          { separator: true, label: '', action: () => {} },
          { label: 'Delete', action: () => {} },
        ],
      },
      global: { stubs: teleportStub },
    })
    expect(wrapper.html()).toMatchSnapshot()
  })
})

// ── ConfirmDialog ─────────────────────────────────────────────────────────────

import ConfirmDialog from '@renderer/components/ConfirmDialog.vue'
import { useConfirmDialog } from '@renderer/composables/useConfirmDialog'

describe('ConfirmDialog — snapshots', () => {
  const teleportStub = { Teleport: { template: '<div><slot /></div>' } }

  afterEach(() => {
    const { cancel } = useConfirmDialog()
    cancel()
  })

  it('matches snapshot: danger dialog', async () => {
    const { confirm } = useConfirmDialog()
    confirm({ title: 'Delete agent?', message: 'This action is irreversible.', type: 'danger', confirmLabel: 'Delete', cancelLabel: 'Cancel' })
    const wrapper = shallowMount(ConfirmDialog, {
      global: { plugins: [i18n], stubs: { ...teleportStub, Transition: false } },
    })
    await flushPromises()
    expect(wrapper.html()).toMatchSnapshot()
  })

  it('matches snapshot: info dialog', async () => {
    const { confirm } = useConfirmDialog()
    confirm({ title: 'Confirm action?', message: 'Do you want to proceed?', type: 'info', confirmLabel: 'OK', cancelLabel: 'Cancel' })
    const wrapper = shallowMount(ConfirmDialog, {
      global: { plugins: [i18n], stubs: { ...teleportStub, Transition: false } },
    })
    await flushPromises()
    expect(wrapper.html()).toMatchSnapshot()
  })
})

// ── ToastContainer ────────────────────────────────────────────────────────────

import ToastContainer from '@renderer/components/ToastContainer.vue'
import { useToast } from '@renderer/composables/useToast'

describe('ToastContainer — snapshots', () => {
  beforeEach(() => {
    const { toasts } = useToast()
    toasts.value.splice(0, toasts.value.length)
  })

  afterEach(() => {
    const { toasts } = useToast()
    toasts.value.splice(0, toasts.value.length)
  })

  it('matches snapshot: empty (no toasts)', () => {
    const wrapper = mount(ToastContainer)
    expect(wrapper.html()).toMatchSnapshot()
  })

  it('matches snapshot: three toast types (error, warn, info)', async () => {
    const { toasts } = useToast()
    // Inject toasts directly to avoid auto-dismiss timers and dynamic IDs
    toasts.value.push(
      { id: 1001, message: 'Connection failed', type: 'error' },
      { id: 1002, message: 'Slow response detected', type: 'warn' },
      { id: 1003, message: 'Changes saved', type: 'info' },
    )
    const wrapper = mount(ToastContainer)
    await flushPromises()
    expect(wrapper.html()).toMatchSnapshot()
  })
})

// ── DbSelector ────────────────────────────────────────────────────────────────

import DbSelector from '@renderer/components/DbSelector.vue'

describe('DbSelector — snapshots', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    const api = window.electronAPI as Record<string, ReturnType<typeof vi.fn>>
    api.getWslUsers.mockResolvedValue([])
  })

  it('matches snapshot: home screen (no project selected)', async () => {
    const wrapper = shallowMount(DbSelector, {
      global: {
        plugins: [createTestingPinia({ initialState: { tasks: { dbPath: null, error: null } } }), i18n],
      },
    })
    await flushPromises()
    expect(wrapper.html()).toMatchSnapshot()
  })

  it('matches snapshot: home screen with error', async () => {
    const wrapper = shallowMount(DbSelector, {
      global: {
        plugins: [createTestingPinia({ initialState: { tasks: { dbPath: null, error: 'DB not found' } } }), i18n],
      },
    })
    await flushPromises()
    expect(wrapper.html()).toMatchSnapshot()
  })
})
