import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { shallowMount, flushPromises } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import LaunchSessionModal from '@renderer/components/LaunchSessionModal.vue'
import i18n from '@renderer/plugins/i18n'

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
