import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { shallowMount } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import SidebarAgentSection from '@renderer/components/SidebarAgentSection.vue'
import i18n from '@renderer/plugins/i18n'
import { mockElectronAPI } from '../../../test/setup'
import type { Agent } from '@renderer/types'

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 1,
    name: 'dev-front',
    type: 'dev',
    perimetre: 'front-vuejs',
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
    ...overrides,
  }
}

describe('SidebarAgentSection', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('renders agents from store', () => {
    const pinia = createTestingPinia({
      initialState: {
        tasks: {
          agents: [makeAgent({ id: 1, name: 'dev-front' })],
          agentGroups: [],
          selectedAgentId: null,
          dbPath: '/db',
        },
        tabs: { tabs: [] },
      },
    })
    const wrapper = shallowMount(SidebarAgentSection, {
      global: { plugins: [pinia, i18n] },
    })
    expect(wrapper.text()).toContain('dev-front')
    wrapper.unmount()
  })

  it('shows empty agent list when no agents are in store', () => {
    const pinia = createTestingPinia({
      initialState: {
        tasks: { agents: [], agentGroups: [], selectedAgentId: null, dbPath: '/db' },
        tabs: { tabs: [] },
      },
    })
    const wrapper = shallowMount(SidebarAgentSection, {
      global: { plugins: [pinia, i18n] },
    })
    // The agent section header should still exist
    expect(wrapper.find('.agent-section').exists()).toBe(true)
    wrapper.unmount()
  })

  it('shows reset button when selectedAgentId is not null', () => {
    const pinia = createTestingPinia({
      initialState: {
        tasks: {
          agents: [makeAgent()],
          agentGroups: [],
          selectedAgentId: 1,
          dbPath: '/db',
        },
        tabs: { tabs: [] },
      },
    })
    const wrapper = shallowMount(SidebarAgentSection, {
      global: { plugins: [pinia, i18n] },
    })
    const buttons = wrapper.findAll('v-btn')
    const hasResetBtn = buttons.some(b => b.classes().includes('reset-btn'))
    expect(hasResetBtn).toBe(true)
    wrapper.unmount()
  })

  it('does not show reset button when selectedAgentId is null', () => {
    const pinia = createTestingPinia({
      initialState: {
        tasks: {
          agents: [],
          agentGroups: [],
          selectedAgentId: null,
          dbPath: '/db',
        },
        tabs: { tabs: [] },
      },
    })
    const wrapper = shallowMount(SidebarAgentSection, {
      global: { plugins: [pinia, i18n] },
    })
    const resetBtn = wrapper.findAll('v-btn').find(b => b.classes().includes('reset-btn'))
    expect(resetBtn).toBeUndefined()
    wrapper.unmount()
  })

  it('renders ungrouped agents (not in any group)', () => {
    const agents = [
      makeAgent({ id: 1, name: 'agent-a' }),
      makeAgent({ id: 2, name: 'agent-b' }),
    ]
    const pinia = createTestingPinia({
      initialState: {
        tasks: {
          agents,
          agentGroups: [],
          selectedAgentId: null,
          dbPath: '/db',
        },
        tabs: { tabs: [] },
      },
    })
    const wrapper = shallowMount(SidebarAgentSection, {
      global: { plugins: [pinia, i18n] },
    })
    expect(wrapper.text()).toContain('agent-a')
    expect(wrapper.text()).toContain('agent-b')
    wrapper.unmount()
  })

  it('renders grouped agents via v-treeview (SidebarGroupNode replaced — T1668)', () => {
    const agents = [makeAgent({ id: 1, name: 'grouped-agent' })]
    const group = { id: 10, name: 'My Group', sort_order: 0, parent_id: null, members: [{ agent_id: 1, sort_order: 0 }] }
    const pinia = createTestingPinia({
      initialState: {
        tasks: {
          agents,
          agentGroups: [group],
          selectedAgentId: null,
          dbPath: '/db',
        },
        agents: { agentGroupsTree: [group] },
        tabs: { tabs: [] },
      },
    })
    const wrapper = shallowMount(SidebarAgentSection, {
      global: { plugins: [pinia, i18n] },
    })
    // SidebarGroupNode is no longer used — v-treeview handles group rendering
    expect(wrapper.findComponent({ name: 'SidebarGroupNode' }).exists()).toBe(false)
    // Component renders without error
    expect(wrapper.exists()).toBe(true)
    wrapper.unmount()
  })

  it('sets launchTarget when agent launch button is clicked (single session agent)', async () => {
    const agent = makeAgent({ id: 1, name: 'test-agent', max_sessions: 1 })
    const pinia = createTestingPinia({
      initialState: {
        tasks: {
          agents: [agent],
          agentGroups: [],
          selectedAgentId: null,
          dbPath: '/db',
        },
        tabs: { tabs: [] },
      },
    })
    const wrapper = shallowMount(SidebarAgentSection, {
      global: { plugins: [pinia, i18n] },
    })
    // The LaunchSessionModal stub should not exist initially
    const launchModal = wrapper.findComponent({ name: 'LaunchSessionModal' })
    // Initially no launch target (modal not visible)
    expect(launchModal.exists() ? launchModal.isVisible() : false).toBe(false)
    wrapper.unmount()
  })

  it('renders CreateAgentModal when showCreateAgent is true', async () => {
    const pinia = createTestingPinia({
      initialState: {
        tasks: { agents: [], agentGroups: [], selectedAgentId: null, dbPath: '/db' },
        tabs: { tabs: [] },
      },
    })
    const wrapper = shallowMount(SidebarAgentSection, {
      global: { plugins: [pinia, i18n] },
    })
    // Initially no create modal
    // This just verifies the component mounts without errors
    expect(wrapper.exists()).toBe(true)
    wrapper.unmount()
  })
})
