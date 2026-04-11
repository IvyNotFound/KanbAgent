import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { shallowMount, flushPromises } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import LaunchSessionModal from '@renderer/components/LaunchSessionModal.vue'
import i18n from '@renderer/plugins/i18n'

// Stub for LaunchInstanceSelector — renders radio buttons + labels so text/element queries work
const launchInstanceSelectorStub = {
  props: ['modelValue', 'instances', 'loading', 'agentName', 'noInstanceText'],
  template: `<div><label v-for="inst in instances" :key="inst.cli + inst.distro"><input type="radio" :value="inst" /><span>{{ inst.type === 'wsl' ? inst.distro : 'Linux' }}</span><span>{{ { claude: 'Claude', codex: 'Codex', gemini: 'Gemini' }[inst.cli] || inst.cli }}</span></label></div>`,
}

describe('LaunchSessionModal', () => {
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

  it('renders the modal with agent name', async () => {
    const wrapper = shallowMount(LaunchSessionModal, {
      props: { agent: mockAgent as never },
      global: {
        plugins: [createTestingPinia({
          initialState: { tasks: { dbPath: '/p/.claude/db' } },
        }), i18n],
        stubs: teleportStub,
      },
    })
    await flushPromises()
    expect(wrapper.text()).toContain('review-master')
  })

  it('shows loading state initially — launch button is disabled', () => {
    const wrapper = shallowMount(LaunchSessionModal, {
      props: { agent: mockAgent as never },
      global: {
        plugins: [createTestingPinia({
          initialState: { tasks: { dbPath: '/p/.claude/db' } },
        }), i18n],
        stubs: teleportStub,
      },
    })
    // Before flushPromises, loading is true — launch button should be disabled
    const launchBtn = wrapper.find('[data-testid="btn-launch"]')
    expect(launchBtn.exists()).toBe(true)
    expect(launchBtn.attributes('disabled')).toBeDefined()
  })

  it('renders instance list when Claude instances are found', async () => {
    const wrapper = shallowMount(LaunchSessionModal, {
      props: { agent: mockAgent as never },
      global: {
        plugins: [createTestingPinia({
          initialState: {
            tasks: { dbPath: '/p/.claude/db' },
            settings: {
              enabledClis: ['claude'],
              allCliInstances: [{ cli: 'claude', distro: 'Ubuntu-24.04', version: '2.1.58', isDefault: true, type: 'wsl' }],
            },
          },
        }), i18n],
        stubs: { ...teleportStub, LaunchInstanceSelector: launchInstanceSelectorStub },
      },
    })
    await flushPromises()
    expect(wrapper.text()).toContain('Ubuntu-24.04')
  })

  it('emits close when backdrop is clicked', async () => {
    const wrapper = shallowMount(LaunchSessionModal, {
      props: { agent: mockAgent as never },
      global: {
        plugins: [createTestingPinia({
          initialState: { tasks: { dbPath: '/p/.claude/db' } },
        }), i18n],
        stubs: teleportStub,
      },
    })
    await flushPromises()

    const backdrop = wrapper.find('[data-testid="launch-modal-backdrop"]')
    await backdrop.trigger('click')
    expect(wrapper.emitted('close')).toBeTruthy()
  })

  it('emits close when close button is clicked', async () => {
    const wrapper = shallowMount(LaunchSessionModal, {
      props: { agent: mockAgent as never },
      global: {
        plugins: [createTestingPinia({
          initialState: { tasks: { dbPath: '/p/.claude/db' } },
        }), i18n],
        stubs: teleportStub,
      },
    })
    await flushPromises()

    const closeBtn = wrapper.find('[data-testid="btn-close"]')
    expect(closeBtn.exists()).toBe(true)
    await closeBtn.trigger('click')
    expect(wrapper.emitted('close')).toBeTruthy()
  })

  it('calls addTerminal on launch', async () => {
    const api = window.electronAPI as Record<string, ReturnType<typeof vi.fn>>
    api.getCliInstances.mockResolvedValue([
      { cli: 'claude', distro: 'Ubuntu', version: '2.1', isDefault: true, type: 'wsl' },
    ])

    const pinia = createTestingPinia({
      initialState: {
        tasks: { dbPath: '/p/.claude/db' },
        settings: {
          enabledClis: ['claude'],
          allCliInstances: [{ cli: 'claude', distro: 'Ubuntu', version: '2.1', isDefault: true, type: 'wsl' }],
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
    expect(launchBtn.exists()).toBe(true)
    await launchBtn.trigger('click')
    await flushPromises()
    expect(tabsStore.addTerminal).toHaveBeenCalled()
  })

  it('shows OS label for local-type instances (T775)', async () => {
    const wrapper = shallowMount(LaunchSessionModal, {
      props: { agent: mockAgent as never },
      global: {
        plugins: [createTestingPinia({
          initialState: {
            tasks: { dbPath: '/p/.claude/db' },
            settings: {
              enabledClis: ['claude'],
              allCliInstances: [{ cli: 'claude', distro: 'local', version: '2.1.58', isDefault: true, type: 'local' }],
            },
          },
        }), i18n],
        stubs: { ...teleportStub, LaunchInstanceSelector: launchInstanceSelectorStub },
      },
    })
    await flushPromises()
    // platform mock is 'linux', so label is 'Linux' (on win32 it would be 'Windows', etc.)
    expect(wrapper.text()).toContain('Linux')
    expect(wrapper.text()).toContain('Claude')
  })

  it('shows distro name for wsl-type instances (T775)', async () => {
    const wrapper = shallowMount(LaunchSessionModal, {
      props: { agent: mockAgent as never },
      global: {
        plugins: [createTestingPinia({
          initialState: {
            tasks: { dbPath: '/p/.claude/db' },
            settings: {
              enabledClis: ['claude'],
              allCliInstances: [{ cli: 'claude', distro: 'Ubuntu-24.04', version: '2.1.58', isDefault: true, type: 'wsl' }],
            },
          },
        }), i18n],
        stubs: { ...teleportStub, LaunchInstanceSelector: launchInstanceSelectorStub },
      },
    })
    await flushPromises()
    expect(wrapper.text()).toContain('Ubuntu-24.04')
  })
})

// ── Warmup cache (T1118) ──────────────────────────────────────────────────────

describe('LaunchSessionModal — warmup cache (T1118)', () => {
  const mockAgent = {
    id: 1, name: 'review-master', type: 'global', perimetre: null,
    system_prompt: null, system_prompt_suffix: null, thinking_mode: null,
    allowed_tools: null, created_at: '2026-01-01', session_statut: null, session_started_at: null,
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

  it('skips refreshCliDetection when cache is pre-populated', async () => {
    const pinia = createTestingPinia({
      initialState: {
        tasks: { dbPath: '/p/.claude/db' },
        settings: {
          enabledClis: ['claude'],
          allCliInstances: [{ cli: 'claude', distro: 'Ubuntu', version: '2.1.0', isDefault: true, type: 'wsl' }],
        },
      },
    })
    shallowMount(LaunchSessionModal, {
      props: { agent: mockAgent as never },
      global: { plugins: [pinia, i18n], stubs: teleportStub },
    })
    await flushPromises()

    const { useSettingsStore } = await import('@renderer/stores/settings')
    const settingsStore = useSettingsStore()
    // Cache was pre-populated — should NOT call refreshCliDetection
    expect(settingsStore.refreshCliDetection).not.toHaveBeenCalled()
  })

  it('calls refreshCliDetection when cache is empty', async () => {
    const pinia = createTestingPinia({
      initialState: {
        tasks: { dbPath: '/p/.claude/db' },
        settings: { enabledClis: ['claude'], allCliInstances: [] },
      },
    })
    shallowMount(LaunchSessionModal, {
      props: { agent: mockAgent as never },
      global: { plugins: [pinia, i18n], stubs: teleportStub },
    })
    await flushPromises()

    const { useSettingsStore } = await import('@renderer/stores/settings')
    const settingsStore = useSettingsStore()
    // Cache was empty — should call refreshCliDetection
    expect(settingsStore.refreshCliDetection).toHaveBeenCalled()
  })
})

// ── Auto-select by cli:distro (T1090) ────────────────────────────────────────

describe('LaunchSessionModal — auto-select cli:distro (T1090)', () => {
  const mockAgent = {
    id: 1, name: 'review-master', type: 'global', perimetre: null,
    system_prompt: null, system_prompt_suffix: null, thinking_mode: null,
    allowed_tools: null, created_at: '2026-01-01', session_statut: null, session_started_at: null,
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

  it('selects claude/Ubuntu over codex/Ubuntu when stored key is claude:Ubuntu', async () => {
    const wrapper = shallowMount(LaunchSessionModal, {
      props: { agent: mockAgent as never },
      global: {
        plugins: [createTestingPinia({
          initialState: {
            tasks: { dbPath: '/p/.claude/db' },
            settings: {
              enabledClis: ['claude', 'codex'],
              allCliInstances: [
                { cli: 'codex',  distro: 'Ubuntu', version: '1.0.0', isDefault: false, type: 'wsl' },
                { cli: 'claude', distro: 'Ubuntu', version: '2.1.0', isDefault: true,  type: 'wsl' },
              ],
              defaultCliInstance: 'claude:Ubuntu',
            },
          },
        }), i18n],
        stubs: teleportStub,
      },
    })
    await flushPromises()

    // The launch button should not be disabled (an instance was selected)
    const launchBtn = wrapper.find('[data-testid="btn-launch"]')
    expect(launchBtn.exists()).toBe(true)
    // Vuetify renders :disabled="false" as disabled="false" on the custom element — check it's not 'true'
    expect(launchBtn.attributes('disabled')).not.toBe('true')
  })

  it('falls back to isDefault instance when stored key has no match', async () => {
    const wrapper = shallowMount(LaunchSessionModal, {
      props: { agent: mockAgent as never },
      global: {
        plugins: [createTestingPinia({
          initialState: {
            tasks: { dbPath: '/p/.claude/db' },
            settings: {
              enabledClis: ['claude'],
              allCliInstances: [
                { cli: 'claude', distro: 'Ubuntu', version: '2.1.0', isDefault: true, type: 'wsl' },
              ],
              defaultCliInstance: 'claude:Debian', // stored distro no longer exists
            },
          },
        }), i18n],
        stubs: teleportStub,
      },
    })
    await flushPromises()

    // Falls back to isDefault → Ubuntu — launch button should be enabled
    const launchBtn = wrapper.find('[data-testid="btn-launch"]')
    expect(launchBtn.attributes('disabled')).not.toBe('true')
  })

  it('backward compat: legacy distro-only key still selects by distro', async () => {
    const wrapper = shallowMount(LaunchSessionModal, {
      props: { agent: mockAgent as never },
      global: {
        plugins: [createTestingPinia({
          initialState: {
            tasks: { dbPath: '/p/.claude/db' },
            settings: {
              enabledClis: ['claude'],
              allCliInstances: [
                { cli: 'claude', distro: 'Ubuntu', version: '2.1.0', isDefault: false, type: 'wsl' },
              ],
              defaultCliInstance: 'Ubuntu', // legacy format (no cli prefix)
            },
          },
        }), i18n],
        stubs: teleportStub,
      },
    })
    await flushPromises()

    // Backward compat: finds Ubuntu regardless of cli prefix
    const launchBtn = wrapper.find('[data-testid="btn-launch"]')
    expect(launchBtn.attributes('disabled')).not.toBe('true')
  })
})
