import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { shallowMount, flushPromises } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import LaunchSessionModal from '@renderer/components/LaunchSessionModal.vue'
import i18n from '@renderer/plugins/i18n'

// Stub for LaunchInstanceSelector — renders radio buttons + labels
const launchInstanceSelectorStub = {
  props: ['modelValue', 'instances', 'loading', 'agentName', 'noInstanceText'],
  template: `<div><label v-for="inst in instances" :key="inst.cli + inst.distro"><input type="radio" :value="inst" /><span>{{ inst.type === 'wsl' ? inst.distro : 'Linux' }}</span><span>{{ { claude: 'Claude', codex: 'Codex', gemini: 'Gemini' }[inst.cli] || inst.cli }}</span></label></div>`,
}

// Stub for LaunchSessionOptions — renders thinking mode buttons, resume switch, worktree switch
const launchSessionOptionsStub = {
  props: ['caps', 'availableModels', 'defaultModelLabel', 'lastConvId', 'worktreeSource',
    'worktreeError', 'accentColor', 'selectedModel', 'useResume', 'thinkingMode',
    'customPrompt', 'multiInstance'],
  template: `<div><template v-if="caps.thinkingMode"><v-btn value="auto">Auto</v-btn><v-btn value="disabled">Désactivé</v-btn></template><v-switch v-if="caps.convResume && lastConvId" data-testid="switch-resume" /><v-switch data-testid="switch-worktree" /></div>`,
}

// ── Capability-driven sections (T1036) ───────────────────────────────────────

describe('LaunchSessionModal — capabilities (T1036)', () => {
  const mockAgent = {
    id: 1,
    name: 'review-master',
    type: 'global',
    perimetre: null,
    system_prompt: null,
    system_prompt_suffix: null,
    thinking_mode: null,
    allowed_tools: null,
    created_at: '2026-01-01',
    session_statut: null,
    session_started_at: null,
  }

  const teleportStub = { Teleport: { template: '<div><slot /></div>' } }

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    const api = window.electronAPI as Record<string, ReturnType<typeof vi.fn>>
    api.getCliInstances.mockResolvedValue([])
    api.getAgentSystemPrompt.mockResolvedValue({ success: true, systemPrompt: null, systemPromptSuffix: null, thinkingMode: 'auto' })
    api.queryDb.mockResolvedValue([])
    api.buildAgentPrompt.mockResolvedValue('test prompt')
  })

  it('shows unified instance list with system + CLI label', async () => {
    const wrapper = shallowMount(LaunchSessionModal, {
      props: { agent: mockAgent as never },
      global: {
        plugins: [createTestingPinia({
          initialState: {
            tasks: { dbPath: '/p/.claude/db' },
            settings: {
              enabledClis: ['claude'],
              allCliInstances: [{ cli: 'claude', distro: 'Ubuntu-24.04', version: '2.1.0', isDefault: true, type: 'wsl' }],
            },
          },
        }), i18n],
        stubs: { ...teleportStub, LaunchInstanceSelector: launchInstanceSelectorStub },
      },
    })
    await flushPromises()
    // Both the distro and the CLI name appear in the unified list
    expect(wrapper.text()).toContain('Ubuntu-24.04')
    expect(wrapper.text()).toContain('Claude')
  })

  it('shows instance radio for Codex (all CLIs use unified list now)', async () => {
    const wrapper = shallowMount(LaunchSessionModal, {
      props: { agent: mockAgent as never },
      global: {
        plugins: [createTestingPinia({
          initialState: {
            tasks: { dbPath: '/p/.claude/db' },
            settings: {
              enabledClis: ['codex'],
              allCliInstances: [{ cli: 'codex', distro: 'Ubuntu-24.04', version: '1.0.0', isDefault: true, type: 'wsl' }],
            },
          },
        }), i18n],
        stubs: { ...teleportStub, LaunchInstanceSelector: launchInstanceSelectorStub },
      },
    })
    await flushPromises()
    // Codex instance now appears in the unified list with a radio
    const radios = wrapper.findAll('input[type="radio"]')
    expect(radios.length).toBe(1)
  })

  it('shows multiple CLIs in unified list when mixed instances available', async () => {
    const wrapper = shallowMount(LaunchSessionModal, {
      props: { agent: mockAgent as never },
      global: {
        plugins: [createTestingPinia({
          initialState: {
            tasks: { dbPath: '/p/.claude/db' },
            settings: {
              enabledClis: ['claude', 'gemini'],
              allCliInstances: [
                { cli: 'claude', distro: 'local', version: '2.1.0', isDefault: true, type: 'local' },
                { cli: 'gemini', distro: 'Ubuntu-24.04', version: '0.2.0', isDefault: true, type: 'wsl' },
              ],
            },
          },
        }), i18n],
        stubs: { ...teleportStub, LaunchInstanceSelector: launchInstanceSelectorStub },
      },
    })
    await flushPromises()
    const radios = wrapper.findAll('input[type="radio"]')
    expect(radios.length).toBe(2)
    expect(wrapper.text()).toContain('Claude')
    expect(wrapper.text()).toContain('Gemini')
  })

  it('hides thinking mode section for Codex (thinkingMode=false)', async () => {
    const wrapper = shallowMount(LaunchSessionModal, {
      props: { agent: mockAgent as never },
      global: {
        plugins: [createTestingPinia({
          initialState: {
            tasks: { dbPath: '/p/.claude/db' },
            settings: { enabledClis: ['codex'], allCliInstances: [] },
          },
        }), i18n],
        stubs: teleportStub,
      },
    })
    await flushPromises()
    // Auto/Disabled buttons are only rendered when thinkingMode=true
    // Vuetify not registered in test env — v-btn renders as custom HTML element <v-btn>
    const vbtns = wrapper.findAll('v-btn')
    const hasAutoBtn = vbtns.some(b => b.text().trim() === 'Auto')
    expect(hasAutoBtn).toBe(false)
  })

  it('disables launch button and shows help message when no instances are detected (T1088)', async () => {
    const wrapper = shallowMount(LaunchSessionModal, {
      props: { agent: mockAgent as never },
      global: {
        plugins: [createTestingPinia({
          initialState: {
            tasks: { dbPath: '/p/.claude/db' },
            settings: {
              enabledClis: ['claude'],
              allCliInstances: [],
            },
          },
        }), i18n],
        stubs: teleportStub,
      },
    })
    await flushPromises()

    // Launch button should be disabled
    const launchBtn = wrapper.find('[data-testid="btn-launch"]')
    expect(launchBtn.exists()).toBe(true)
    expect(launchBtn.attributes('disabled')).toBeDefined()

    // Help message should be visible
    const helpMsg = wrapper.find('[data-testid="no-instance-warning"]')
    expect(helpMsg.exists()).toBe(true)
  })

  it('shows thinking mode section for Claude (thinkingMode=true)', async () => {
    const wrapper = shallowMount(LaunchSessionModal, {
      props: { agent: mockAgent as never },
      global: {
        plugins: [createTestingPinia({
          initialState: {
            tasks: { dbPath: '/p/.claude/db' },
            settings: { enabledClis: ['claude'], allCliInstances: [] },
          },
        }), i18n],
        stubs: { ...teleportStub, LaunchSessionOptions: launchSessionOptionsStub },
      },
    })
    await flushPromises()
    const vbtns = wrapper.findAll('v-btn')
    const hasAutoBtn = vbtns.some(b => b.text().trim() === 'Auto')
    expect(hasAutoBtn).toBe(true)
  })

  it('hides resume switch for Codex (convResume=false)', async () => {
    const api = window.electronAPI as Record<string, ReturnType<typeof vi.fn>>
    api.queryDb.mockResolvedValue([{ conv_id: 'conv-abc' }])

    const wrapper = shallowMount(LaunchSessionModal, {
      props: { agent: mockAgent as never },
      global: {
        plugins: [createTestingPinia({
          initialState: {
            tasks: { dbPath: '/p/.claude/db' },
            settings: { enabledClis: ['codex'], allCliInstances: [] },
          },
        }), i18n],
        stubs: { ...teleportStub, LaunchSessionOptions: launchSessionOptionsStub },
      },
    })
    await flushPromises()
    // No resume switch should appear for codex — only worktree switch
    // Vuetify not registered in test env — v-switch renders as custom HTML element <v-switch>
    const switches = wrapper.findAll('v-switch')
    expect(switches.length).toBe(1) // only multiInstance switch
  })

  it('launch for Codex passes undefined thinkingMode (T1088: requires instance)', async () => {
    const pinia = createTestingPinia({
      initialState: {
        tasks: { dbPath: '/p/.claude/db' },
        settings: {
          enabledClis: ['codex'],
          allCliInstances: [{ cli: 'codex', distro: 'Ubuntu', version: '1.0.0', isDefault: true, type: 'wsl' }],
        },
      },
    })
    const wrapper = shallowMount(LaunchSessionModal, {
      props: { agent: mockAgent as never },
      global: { plugins: [pinia, i18n], stubs: teleportStub },
    })
    await flushPromises()

    const { useTabsStore } = await import('@renderer/stores/tabs')
    const tabsStore = useTabsStore()

    const launchBtn = wrapper.find('[data-testid="btn-launch"]')
    await launchBtn.trigger('click')
    await flushPromises()

    const call = (tabsStore.addTerminal as ReturnType<typeof vi.fn>).mock.calls[0]
    // thinkingMode (arg[4]) should be undefined — codex has no thinkingMode capability
    expect(call[4]).toBeUndefined()
    // cli (arg[10]) should be 'codex'
    expect(call[10]).toBe('codex')
  })
})
