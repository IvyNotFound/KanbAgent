import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount, shallowMount, flushPromises } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import { nextTick } from 'vue'
import LaunchSessionModal from '@renderer/components/LaunchSessionModal.vue'
import i18n from '@renderer/plugins/i18n'

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
    const buttons = wrapper.findAll('button')
    const disabledBtns = buttons.filter(b => b.attributes('disabled') !== undefined)
    expect(disabledBtns.length).toBeGreaterThanOrEqual(1)
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
        stubs: teleportStub,
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

    const backdrop = wrapper.find('.fixed.inset-0')
    await backdrop.trigger('click')
    expect(wrapper.emitted('close')).toBeTruthy()
  })

  it('emits close when close button (✕) is clicked', async () => {
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

    const closeBtn = wrapper.findAll('button').find(b => b.text().trim() === '✕')
    expect(closeBtn).toBeDefined()
    await closeBtn!.trigger('click')
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

    // Find the launch button by text (i18n fr: "Lancer")
    const launchBtn = wrapper.findAll('button').find(b => {
      const text = b.text().toLowerCase()
      return text.includes('lancer') || text.includes('launch')
    })
    expect(launchBtn).toBeDefined()
    await launchBtn!.trigger('click')
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
        stubs: teleportStub,
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
        stubs: teleportStub,
      },
    })
    await flushPromises()
    expect(wrapper.text()).toContain('Ubuntu-24.04')
  })
})

// ── AgentBadge (T231) ────────────────────────────────────────────────────────

import AgentBadge from '@renderer/components/AgentBadge.vue'

describe('LaunchSessionModal — advanced features (T353)', () => {
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
    api.getCliInstances.mockResolvedValue([
      { cli: 'claude', distro: 'Ubuntu-24.04', version: '2.1.58', isDefault: true, type: 'wsl' },
    ])
    api.getAgentSystemPrompt.mockResolvedValue({
      success: true,
      systemPrompt: 'You are a review agent.',
      systemPromptSuffix: 'Always be thorough.',
      thinkingMode: 'auto',
    })
    api.queryDb.mockResolvedValue([{ claude_conv_id: 'conv-abc-123' }])
    api.buildAgentPrompt.mockResolvedValue('test prompt')
  })

  it('shows resume checkbox when previous convId exists', async () => {
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

    // Resume checkbox should be present
    const checkbox = wrapper.find('input[type="checkbox"]')
    expect(checkbox.exists()).toBe(true)
  })

  it('useResume defaults to false when convId exists', async () => {
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

    const checkbox = wrapper.find('input[type="checkbox"]')
    expect((checkbox.element as HTMLInputElement).checked).toBe(false)
  })

  it('fullSystemPrompt combines system_prompt + suffix', async () => {
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

    // Uncheck resume to show system prompt section
    const checkbox = wrapper.find('input[type="checkbox"]')
    await checkbox.setValue(false)
    await nextTick()

    // The system prompt preview should show combined prompt
    const preBlock = wrapper.find('pre')
    if (preBlock.exists()) {
      expect(preBlock.text()).toContain('You are a review agent.')
      expect(preBlock.text()).toContain('Always be thorough.')
    }
  })

  it('thinkingMode toggle between auto and disabled', async () => {
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

    // Find the 'Disabled' / 'Désactivé' button
    const buttons = wrapper.findAll('button')
    const disabledBtn = buttons.find(b => {
      const text = b.text().toLowerCase()
      return text.includes('désactivé') || text.includes('disabled')
    })
    expect(disabledBtn).toBeDefined()

    // Click it
    await disabledBtn!.trigger('click')
    await nextTick()

    // After clicking, re-query the button (Vue re-renders the DOM)
    const updatedButtons = wrapper.findAll('button')
    const updatedDisabledBtn = updatedButtons.find(b => {
      const text = b.text().toLowerCase()
      return text.includes('désactivé') || text.includes('disabled')
    })
    // The disabled button should now have the active style (borderColor set via :style)
    const style = updatedDisabledBtn!.attributes('style') || ''
    expect(style).toContain('border-color')
  })

  it('launch in resume mode calls addTerminal with convId', async () => {
    const pinia = createTestingPinia({
      initialState: {
        tasks: { dbPath: '/p/.claude/db' },
        settings: {
          enabledClis: ['claude'],
          allCliInstances: [{ cli: 'claude', distro: 'Ubuntu-24.04', version: '2.1.58', isDefault: true, type: 'wsl' }],
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

    // useResume defaults to false — check the checkbox first to enable resume mode
    const checkbox = wrapper.find('input[type="checkbox"]')
    await checkbox.setValue(true)
    await nextTick()

    const launchBtn = wrapper.findAll('button').find(b => {
      const text = b.text().toLowerCase()
      return text.includes('lancer') || text.includes('launch')
    })
    await launchBtn!.trigger('click')
    await flushPromises()

    expect(tabsStore.addTerminal).toHaveBeenCalledWith(
      'review-master',     // agentName
      'Ubuntu-24.04',      // distro
      undefined,           // no prompt in resume mode
      undefined,           // no systemPrompt in resume mode
      'auto',              // thinkingMode
      undefined,           // profile (default 'claude' → undefined)
      'conv-abc-123',      // convId for --resume
      true,                // activate
      undefined,           // taskId
      'stream',            // viewMode
      'claude',            // cli (T1014)
      undefined,           // workDir (multiInstance off)
    )
  })
})

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
        stubs: teleportStub,
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
        stubs: teleportStub,
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
        stubs: teleportStub,
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
    const buttons = wrapper.findAll('button')
    const hasThinkingBtn = buttons.some(b => b.text() === 'Auto')
    expect(hasThinkingBtn).toBe(false)
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
    const buttons = wrapper.findAll('button')
    const launchBtn = buttons.find(b => {
      const text = b.text().toLowerCase()
      return text.includes('lancer') || text.includes('launch')
    })
    expect(launchBtn).toBeDefined()
    expect(launchBtn!.attributes('disabled')).toBeDefined()

    // Help message should be visible
    const helpMsg = wrapper.find('p.text-amber-500')
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
        stubs: teleportStub,
      },
    })
    await flushPromises()
    const buttons = wrapper.findAll('button')
    const hasAutoBtn = buttons.some(b => b.text() === 'Auto')
    expect(hasAutoBtn).toBe(true)
  })

  it('hides resume checkbox for Codex (convResume=false)', async () => {
    const api = window.electronAPI as Record<string, ReturnType<typeof vi.fn>>
    api.queryDb.mockResolvedValue([{ claude_conv_id: 'conv-abc' }])

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
    // No resume checkbox should appear for codex
    const checkboxes = wrapper.findAll('input[type="checkbox"]')
    expect(checkboxes.length).toBe(1) // only multiInstance checkbox
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

    const launchBtn = wrapper.findAll('button').find(b => {
      const text = b.text().toLowerCase()
      return text.includes('lancer') || text.includes('launch')
    })
    await launchBtn!.trigger('click')
    await flushPromises()

    const call = (tabsStore.addTerminal as ReturnType<typeof vi.fn>).mock.calls[0]
    // thinkingMode (arg[4]) should be undefined — codex has no thinkingMode capability
    expect(call[4]).toBeUndefined()
    // cli (arg[10]) should be 'codex'
    expect(call[10]).toBe('codex')
  })
})
