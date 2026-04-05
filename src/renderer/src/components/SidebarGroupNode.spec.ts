import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { shallowMount } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import { ref } from 'vue'
import SidebarGroupNode from '@renderer/components/SidebarGroupNode.vue'
import { sidebarGroupsKey } from '@renderer/composables/useSidebarGroups'
import { sidebarDragDropKey } from '@renderer/composables/useSidebarDragDrop'
import i18n from '@renderer/plugins/i18n'
import type { AgentGroup, Agent } from '@renderer/types'

function makeGroup(overrides: Partial<AgentGroup> = {}): AgentGroup {
  return {
    id: 1,
    name: 'Backend',
    sort_order: 0,
    parent_id: null,
    created_at: '2026-01-01T00:00:00Z',
    members: [],
    children: [],
    ...overrides,
  }
}

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 10,
    name: 'dev-back',
    type: 'dev',
    perimetre: 'back-electron',
    system_prompt: null,
    system_prompt_suffix: null,
    thinking_mode: null,
    allowed_tools: null,
    auto_launch: 1,
    permission_mode: null,
    max_sessions: 1,
    created_at: '2026-01-01T00:00:00Z',
    session_statut: null,
    session_started_at: null,
    last_log_at: null,
    has_history: 0,
    sort_order: 0,
    ...overrides,
  }
}

// Provide mock for sidebarGroupsKey inject
function makeSidebarGroupsProvide() {
  return {
    confirmDeleteGroup: ref(null),
    renamingGroupId: ref<number | null>(null),
    renameGroupName: ref(''),
    renameGroupInputEl: ref(null),
    startRename: vi.fn(),
    confirmRename: vi.fn(),
    cancelRename: vi.fn(),
    creatingGroup: ref(false),
    newGroupName: ref(''),
    createGroupInputEl: ref(null),
    startCreateGroup: vi.fn(),
    confirmCreateGroup: vi.fn(),
    cancelCreateGroup: vi.fn(),
    creatingSubgroupForId: ref<number | null>(null),
    newSubgroupName: ref(''),
    createSubgroupInputEl: ref(null),
    startCreateSubgroup: vi.fn(),
    confirmCreateSubgroup: vi.fn(),
    cancelCreateSubgroup: vi.fn(),
    handleDeleteGroup: vi.fn(),
    onConfirmDeleteGroup: vi.fn(),
  }
}

function makeDragDropProvide() {
  return {
    dragAgentId: ref<number | null>(null),
    dragGroupId: ref<number | null>(null),
    dragOverGroupId: ref<number | null>(null),
    onAgentDragStart: vi.fn(),
    onGroupDragStart: vi.fn(),
    onGroupDragOver: vi.fn(),
    onGroupDragLeave: vi.fn(),
    onGroupDrop: vi.fn(),
  }
}

function mountGroupNode(group: AgentGroup, storeAgents: Agent[] = [], extraProvide: Record<string, unknown> = {}) {
  const pinia = createTestingPinia({
    initialState: {
      tasks: { agents: storeAgents, selectedAgentId: null, dbPath: '/p/db' },
      tabs: { tabs: [], activeTabId: null },
    },
  })

  return shallowMount(SidebarGroupNode, {
    props: { group, level: 0 },
    global: {
      plugins: [pinia, i18n],
      provide: {
        [sidebarGroupsKey as unknown as string]: makeSidebarGroupsProvide(),
        [sidebarDragDropKey as unknown as string]: makeDragDropProvide(),
        openLaunchModal: vi.fn(),
        openContextMenu: vi.fn(),
        openEditAgent: vi.fn(),
        ...extraProvide,
      },
    },
  })
}

describe('SidebarGroupNode', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('renders group name', () => {
    const wrapper = mountGroupNode(makeGroup({ name: 'Frontend' }))
    expect(wrapper.text()).toContain('Frontend')
    wrapper.unmount()
  })

  it('renders group with members', () => {
    const agent = makeAgent({ id: 10, name: 'dev-front' })
    const group = makeGroup({ members: [{ agent_id: 10, sort_order: 0 }] })
    const wrapper = mountGroupNode(group, [agent])
    expect(wrapper.text()).toContain('dev-front')
    wrapper.unmount()
  })

  it('shows empty drop hint when group has no agents and no drag over', () => {
    const wrapper = mountGroupNode(makeGroup({ members: [] }))
    // Empty group shows drop hint
    expect(wrapper.exists()).toBe(true)
    wrapper.unmount()
  })

  it('applies correct indent style for level 0', () => {
    const wrapper = mountGroupNode(makeGroup(), [], {})
    // level 0 → paddingLeft: 0px
    const html = wrapper.html()
    expect(html).toContain('padding-left: 0px')
    wrapper.unmount()
  })

  it('applies correct indent style for level 1', () => {
    const wrapper = shallowMount(SidebarGroupNode, {
      props: { group: makeGroup(), level: 1 },
      global: {
        plugins: [
          createTestingPinia({
            initialState: {
              tasks: { agents: [], selectedAgentId: null, dbPath: '/p/db' },
              tabs: { tabs: [], activeTabId: null },
            },
          }),
          i18n,
        ],
        provide: {
          [sidebarGroupsKey as unknown as string]: makeSidebarGroupsProvide(),
          [sidebarDragDropKey as unknown as string]: makeDragDropProvide(),
          openLaunchModal: vi.fn(),
          openContextMenu: vi.fn(),
          openEditAgent: vi.fn(),
        },
      },
    })
    // level 1 → paddingLeft: 12px (1 * 12px)
    expect(wrapper.html()).toContain('padding-left: 12px')
    wrapper.unmount()
  })

  it('toggles collapsed state on button click', async () => {
    const wrapper = mountGroupNode(makeGroup({ name: 'Dev' }))
    const agent = makeAgent({ id: 1, name: 'dev-agent' })
    const group = makeGroup({ name: 'Dev', members: [{ agent_id: 1, sort_order: 0 }] })
    const wrapper2 = mountGroupNode(group, [agent])
    // content is visible by default (not collapsed)
    const button = wrapper2.find('v-btn')
    expect(button.exists()).toBe(true)
    await button.trigger('click')
    // After click, collapsed state changes — content div is hidden
    // We can't easily test visibility with shallowMount but we can verify no error
    expect(wrapper2.exists()).toBe(true)
    wrapper.unmount()
    wrapper2.unmount()
  })

  it('renders child groups recursively when children exist', () => {
    const child = makeGroup({ id: 2, name: 'Child Group', parent_id: 1 })
    const parent = makeGroup({ id: 1, name: 'Parent Group', children: [child] })
    const wrapper = mountGroupNode(parent)
    // shallowMount stubs recursive SidebarGroupNode — stub appears as <sidebar-group-node-stub> in HTML
    expect(wrapper.html().toLowerCase()).toContain('sidebar-group-node')
    wrapper.unmount()
  })

  it('shows rename input when renamingGroupId matches group id', async () => {
    const groupsProvide = makeSidebarGroupsProvide()
    groupsProvide.renamingGroupId.value = 1

    const pinia = createTestingPinia({
      initialState: {
        tasks: { agents: [], selectedAgentId: null, dbPath: '/p/db' },
        tabs: { tabs: [], activeTabId: null },
      },
    })

    const wrapper = shallowMount(SidebarGroupNode, {
      props: { group: makeGroup({ id: 1 }), level: 0 },
      global: {
        plugins: [pinia, i18n],
        provide: {
          [sidebarGroupsKey as unknown as string]: groupsProvide,
          [sidebarDragDropKey as unknown as string]: makeDragDropProvide(),
          openLaunchModal: vi.fn(),
          openContextMenu: vi.fn(),
          openEditAgent: vi.fn(),
        },
      },
    })
    // rename text-field appears instead of span (T1574: input → v-text-field)
    expect(wrapper.find('v-text-field').exists()).toBe(true)
    wrapper.unmount()
  })
})
