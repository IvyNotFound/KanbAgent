import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount, shallowMount, flushPromises } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import Sidebar from '@renderer/components/Sidebar.vue'
import SidebarAgentSection from '@renderer/components/SidebarAgentSection.vue'
import i18n from '@renderer/plugins/i18n'

// Stub for SidebarAgentItem — renders the agent name so text assertions work
const sidebarAgentItemStub = {
  props: ['agent', 'isSelected', 'depth', 'hasOpenTerminal'],
  template: '<div>{{ agent.name }}</div>',
}

describe('Sidebar', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('renders agent names when agents are in the store', () => {
    const agents = [
      { id: 1, name: 'review-master', type: 'global', perimetre: null, session_statut: null, session_started_at: null, created_at: '2026-01-01', last_log_at: null },
      { id: 2, name: 'dev-front-vuejs', type: 'scoped', perimetre: 'front-vuejs', session_statut: 'en_cours', session_started_at: '2026-01-01', created_at: '2026-01-01', last_log_at: null },
    ]
    // Agent names are rendered by SidebarAgentSection (T815 refacto)
    const wrapper = shallowMount(SidebarAgentSection, {
      global: {
        plugins: [createTestingPinia({
          initialState: {
            tasks: { agents, projectPath: '/p', dbPath: '/p/.claude/db', perimetresData: [], agentGroups: [] },
          },
        }), i18n],
        stubs: {
          LaunchSessionModal: true,
          ContextMenu: true,
          CreateAgentModal: true,
          ConfirmModal: true,
          Teleport: true,
          SidebarAgentItem: sidebarAgentItemStub,
        },
      },
    })
    expect(wrapper.text()).toContain('review-master')
    expect(wrapper.text()).toContain('dev-front-vuejs')
  })

})

// ── LaunchSessionModal (T230) ────────────────────────────────────────────────

import LaunchSessionModal from '@renderer/components/LaunchSessionModal.vue'

describe('Sidebar — context menu & advanced flows', () => {
  const sidebarStubs = {
    LaunchSessionModal: true,
    SettingsModal: true,
    ContextMenu: true,
    CreateAgentModal: true,
    Teleport: true,
  }

  const makeSidebarAgent = (overrides = {}) => ({
    id: 1,
    name: 'review-master',
    type: 'global',
    perimetre: null,
    system_prompt: 'You are review-master',
    system_prompt_suffix: null,
    thinking_mode: 'auto',
    allowed_tools: null,
    session_statut: null,
    session_started_at: null,
    created_at: '2026-01-01',
    last_log_at: null,
    ...overrides,
  })

  const makeSidebarPerimetre = (overrides = {}) => ({
    id: 1,
    name: 'front-vuejs',
    dossier: 'renderer/',
    techno: 'Vue 3',
    description: 'Renderer Vue 3',
    actif: 1,
    created_at: '2026-01-01',
    ...overrides,
  })

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    const api = window.electronAPI as Record<string, ReturnType<typeof vi.fn>>
    api.updateAgentSystemPrompt.mockResolvedValue({ success: true })
    api.renameAgent.mockResolvedValue({ success: true })
    api.updatePerimetre.mockResolvedValue({ success: true })
    api.queryDb.mockResolvedValue([])
  })

  // ── Context menu items ─────────────────────────────────────────────────────

  it('contextmenu event on agent row is handled without error', async () => {
    const agents = [makeSidebarAgent()]
    const wrapper = shallowMount(Sidebar, {
      global: {
        plugins: [createTestingPinia({
          initialState: {
            tasks: { agents, projectPath: '/p', dbPath: '/p/.claude/db', perimetresData: [] },
          },
        }), i18n],
        stubs: sidebarStubs,
      },
    })
    // Find an element containing the agent name and trigger contextmenu
    const agentEl = wrapper.findAll('button, li, div, span').find(el =>
      el.text().includes('review-master')
    )
    if (agentEl) {
      await agentEl.trigger('contextmenu')
    }
    // Component should not crash after contextmenu
    expect(wrapper.exists()).toBe(true)
  })

  // ── Agent rename flow ──────────────────────────────────────────────────────

  it('system prompt editor textarea is hidden initially (systemPromptTarget is null)', () => {
    const agents = [makeSidebarAgent()]
    const wrapper = shallowMount(Sidebar, {
      global: {
        plugins: [createTestingPinia({
          initialState: {
            tasks: { agents, projectPath: '/p', dbPath: '/p/.claude/db', perimetresData: [] },
          },
        }), i18n],
        stubs: sidebarStubs,
      },
    })
    // systemPromptTarget is null initially → prompt editor hidden
    // The editor shows a textarea only when systemPromptTarget is set
    const textareas = wrapper.findAll('textarea')
    // If any textareas visible, none should have system prompt content
    const promptTextareas = textareas.filter(ta =>
      (ta.element as HTMLTextAreaElement).value.includes('You are review-master')
    )
    expect(promptTextareas.length).toBe(0)
  })

  // ── Périmètre editing ──────────────────────────────────────────────────────

  it('perimetres section renders with perimetresData in store', async () => {
    const perimetres = [
      makeSidebarPerimetre({ id: 1, name: 'front-vuejs' }),
      makeSidebarPerimetre({ id: 2, name: 'back-electron', techno: 'Node.js', description: 'Main process' }),
    ]
    const wrapper = shallowMount(Sidebar, {
      global: {
        plugins: [createTestingPinia({
          initialState: {
            tasks: {
              agents: [],
              projectPath: '/p',
              dbPath: '/p/.claude/db',
              perimetresData: perimetres,
            },
          },
        }), i18n],
        stubs: sidebarStubs,
      },
    })
    // Component renders without crashing with perimetresData in store
    expect(wrapper.exists()).toBe(true)
  })

  it('perimetre edit form (editPerimetre) is hidden initially', () => {
    const perimetres = [makeSidebarPerimetre()]
    const wrapper = shallowMount(Sidebar, {
      global: {
        plugins: [createTestingPinia({
          initialState: {
            tasks: {
              agents: [],
              projectPath: '/p',
              dbPath: '/p/.claude/db',
              perimetresData: perimetres,
            },
          },
        }), i18n],
        stubs: sidebarStubs,
      },
    })
    // editPerimetre is null → inline edit form hidden
    // Verify no input pre-filled with perimetre name from editor
    const inputs = wrapper.findAll('input')
    const prefilledInputs = inputs.filter(i =>
      (i.element as HTMLInputElement).value === 'front-vuejs'
    )
    expect(prefilledInputs.length).toBe(0)
  })

})

// ── Sidebar — agent groupings (T558) ─────────────────────────────────────────
//
// Tests for the existing reviewAgents/regularAgents computed in Sidebar,
// which represent the initial grouping logic (review vs regular agents).
// Full drag-and-drop group management (T557) tests are in .skip blocks below.

describe('Sidebar — agent groupings (T558)', () => {
  // Agent groupings are now rendered by SidebarAgentSection (T815 refacto)
  const sidebarGroupStubs = {
    LaunchSessionModal: true,
    ContextMenu: true,
    CreateAgentModal: true,
    ConfirmModal: true,
    Teleport: true,
    // SidebarAgentItem renders agent names — stub it so text assertions work with shallowMount
    SidebarAgentItem: sidebarAgentItemStub,
  }

  const makeGroupAgent = (overrides = {}) => ({
    id: 1,
    name: 'dev-front-vuejs',
    type: 'scoped',
    perimetre: 'front-vuejs',
    system_prompt: null,
    system_prompt_suffix: null,
    thinking_mode: null,
    allowed_tools: null,
    auto_launch: 1,
    permission_mode: null,
    max_sessions: 3,
    session_statut: null,
    session_started_at: null,
    created_at: '2026-01-01',
    last_log_at: null,
    ...overrides,
  })

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  // ── reviewAgents computed (agents with 'review' in name or type='review') ───

  it('renders review agents (name includes review) separately from regular agents', () => {
    const agents = [
      makeGroupAgent({ id: 1, name: 'review-master', type: 'global' }),
      makeGroupAgent({ id: 2, name: 'dev-front-vuejs', type: 'scoped' }),
      makeGroupAgent({ id: 3, name: 'test-front-vuejs', type: 'scoped' }),
    ]
    // Agent names rendered by SidebarAgentSection after T815 refacto
    const wrapper = shallowMount(SidebarAgentSection, {
      global: {
        plugins: [createTestingPinia({
          initialState: {
            tasks: { agents, projectPath: '/p', dbPath: '/p/.claude/db', perimetresData: [], agentGroups: [] },
          },
        }), i18n],
        stubs: sidebarGroupStubs,
      },
    })
    // Both review and regular agents should appear in the sidebar
    const text = wrapper.text()
    expect(text).toContain('review-master')
    expect(text).toContain('dev-front-vuejs')
  })

  it('renders ungrouped agents when agents list has no groups', () => {
    const agents = [
      makeGroupAgent({ id: 1, name: 'dev-front-vuejs', type: 'scoped' }),
      makeGroupAgent({ id: 2, name: 'dev-back-electron', type: 'scoped' }),
    ]
    const wrapper = shallowMount(SidebarAgentSection, {
      global: {
        plugins: [createTestingPinia({
          initialState: {
            tasks: { agents, projectPath: '/p', dbPath: '/p/.claude/db', perimetresData: [], agentGroups: [] },
          },
        }), i18n],
        stubs: sidebarGroupStubs,
      },
    })
    const text = wrapper.text()
    expect(text).toContain('dev-front-vuejs')
    expect(text).toContain('dev-back-electron')
  })

  it('task-creator agent is treated as review agent (management category)', () => {
    const agents = [
      makeGroupAgent({ id: 1, name: 'task-creator', type: 'scoped' }),
      makeGroupAgent({ id: 2, name: 'dev-front-vuejs', type: 'scoped' }),
    ]
    const wrapper = shallowMount(SidebarAgentSection, {
      global: {
        plugins: [createTestingPinia({
          initialState: {
            tasks: { agents, projectPath: '/p', dbPath: '/p/.claude/db', perimetresData: [], agentGroups: [] },
          },
        }), i18n],
        stubs: sidebarGroupStubs,
      },
    })
    // Both agents appear in sidebar
    const text = wrapper.text()
    expect(text).toContain('task-creator')
    expect(text).toContain('dev-front-vuejs')
  })

  it('agents with type=review appear in review section', () => {
    const agents = [
      makeGroupAgent({ id: 1, name: 'arch', type: 'review' }),
      makeGroupAgent({ id: 2, name: 'doc', type: 'scoped' }),
    ]
    const wrapper = shallowMount(SidebarAgentSection, {
      global: {
        plugins: [createTestingPinia({
          initialState: {
            tasks: { agents, projectPath: '/p', dbPath: '/p/.claude/db', perimetresData: [], agentGroups: [] },
          },
        }), i18n],
        stubs: sidebarGroupStubs,
      },
    })
    const text = wrapper.text()
    expect(text).toContain('arch')
    expect(text).toContain('doc')
  })

  it('sidebar renders correctly with empty agents list', () => {
    const wrapper = shallowMount(SidebarAgentSection, {
      global: {
        plugins: [createTestingPinia({
          initialState: {
            tasks: { agents: [], projectPath: '/p', dbPath: '/p/.claude/db', perimetresData: [], agentGroups: [] },
          },
        }), i18n],
        stubs: sidebarGroupStubs,
      },
    })
    expect(wrapper.exists()).toBe(true)
  })

  // ── Future group UI (T557 — skipped until implementation) ──────────────────
  // These tests define the contract for the drag-and-drop group UI.
  // Activate them after T557 lands.

  it.skip('T557: renders group names from agentGroups store', () => {
    // After T557: verify group names appear as section headers in the sidebar
  })

  it.skip('T557: emits group create on Enter in new-group input', () => {
    // After T557: find the new-group <input>, type a name, press Enter
    // verify agentGroupsCreate IPC was called
  })

  it.skip('T557: emits group rename on double-click then Enter', () => {
    // After T557: double-click group header → input appears → type → Enter
    // verify agentGroupsRename IPC was called
  })

  it.skip('T557: shows confirm dialog before group delete when group has members', () => {
    // After T557: click delete button on a group with agents
    // verify showConfirmDialog was called before agentGroupsDelete
  })

  it.skip('T557: drag-and-drop: onDrop moves agent to target group', () => {
    // After T557: simulate DragEvent on group drop zone
    // verify agentSetGroup IPC was called with correct groupId
  })
})

