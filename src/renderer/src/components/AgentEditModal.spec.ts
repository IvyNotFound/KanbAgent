import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { shallowMount, flushPromises } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import AgentEditModal from '@renderer/components/AgentEditModal.vue'
import i18n from '@renderer/plugins/i18n'

describe('AgentEditModal', () => {
  const teleportStub = { Teleport: { template: '<div><slot /></div>' } }
  const agent = {
    id: 7,
    name: 'dev-front',
    type: 'dev',
    perimetre: 'front-vuejs',
    system_prompt: null,
    system_prompt_suffix: null,
    thinking_mode: 'auto' as const,
    allowed_tools: 'Bash,Edit,Read',
    preferred_model: null,
    created_at: '2025-01-01',
  }

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    const api = window.electronAPI as Record<string, ReturnType<typeof vi.fn>>
    api.getAgentSystemPrompt.mockResolvedValue({ success: true, thinkingMode: 'auto', preferredModel: null })
    api.updateAgent.mockResolvedValue({ success: true })
  })

  it('renders the modal with agent name pre-filled', () => {
    const wrapper = shallowMount(AgentEditModal, {
      props: { agent },
      global: {
        plugins: [createTestingPinia({
          initialState: { tasks: { dbPath: '/p/.claude/db' } },
        }), i18n],
        stubs: teleportStub,
      },
    })
    // v-text-field is a custom element — v-model is not reflected as HTML attribute.
    // Verify that the name reactive state is initialized from the agent prop.
    expect(wrapper.find('v-text-field').exists()).toBe(true)
    expect((wrapper.vm as any).name).toBe('dev-front')
  })

  it('renders thinking mode buttons', () => {
    const wrapper = shallowMount(AgentEditModal, {
      props: { agent },
      global: {
        plugins: [createTestingPinia({
          initialState: { tasks: { dbPath: '/p/.claude/db' } },
        }), i18n],
        stubs: teleportStub,
      },
    })
    // v-btn elements are custom elements in test context (isCustomElement: tag => tag.startsWith('v-'))
    const vBtns = wrapper.findAll('v-btn')
    const autoBtn = vBtns.find(b => b.text().trim().toLowerCase() === 'auto')
    expect(autoBtn?.exists()).toBe(true)
  })

  it('renders allowedTools textarea pre-filled', () => {
    const wrapper = shallowMount(AgentEditModal, {
      props: { agent },
      global: {
        plugins: [createTestingPinia({
          initialState: { tasks: { dbPath: '/p/.claude/db' } },
        }), i18n],
        stubs: teleportStub,
      },
    })
    // v-textarea is a custom element — v-model is not reflected as HTML attribute.
    // Verify that allowedTools reactive state is initialized from the agent prop.
    expect(wrapper.find('v-textarea').exists()).toBe(true)
    expect((wrapper.vm as any).allowedTools).toBe('Bash,Edit,Read')
  })

  it('emits close when backdrop is clicked', async () => {
    const wrapper = shallowMount(AgentEditModal, {
      props: { agent },
      global: {
        plugins: [createTestingPinia({
          initialState: { tasks: { dbPath: '/p/.claude/db' } },
        }), i18n],
        stubs: teleportStub,
      },
    })
    const backdrop = wrapper.find('[data-testid="agent-edit-backdrop"]')
    await backdrop.trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('emits close when close button is clicked', async () => {
    const wrapper = shallowMount(AgentEditModal, {
      props: { agent },
      global: {
        plugins: [createTestingPinia({
          initialState: { tasks: { dbPath: '/p/.claude/db' } },
        }), i18n],
        stubs: teleportStub,
      },
    })
    const closeBtn = wrapper.find('[data-testid="btn-close"]')
    expect(closeBtn.exists()).toBe(true)
    await closeBtn.trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('calls updateAgent on save and emits saved + close', async () => {
    const api = window.electronAPI as Record<string, ReturnType<typeof vi.fn>>
    const wrapper = shallowMount(AgentEditModal, {
      props: { agent },
      global: {
        plugins: [createTestingPinia({
          initialState: { tasks: { dbPath: '/p/.claude/db' } },
          stubActions: false,
        }), i18n],
        stubs: teleportStub,
      },
    })
    await flushPromises()

    const saveBtn = wrapper.find('[data-testid="btn-save"]')
    expect(saveBtn.exists()).toBe(true)
    await saveBtn.trigger('click')
    await flushPromises()
    expect(api.updateAgent).toHaveBeenCalledWith('/p/.claude/db', 7, expect.objectContaining({
      name: 'dev-front',
      thinkingMode: 'auto',
    }))
    expect(wrapper.emitted('saved')).toHaveLength(1)
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('shows error when updateAgent fails', async () => {
    const api = window.electronAPI as Record<string, ReturnType<typeof vi.fn>>
    api.updateAgent.mockResolvedValue({ success: false, error: 'DB locked' })

    const wrapper = shallowMount(AgentEditModal, {
      props: { agent },
      global: {
        plugins: [createTestingPinia({
          initialState: { tasks: { dbPath: '/p/.claude/db' } },
          stubActions: false,
        }), i18n],
        stubs: teleportStub,
      },
    })
    await flushPromises()

    const saveBtn = wrapper.find('[data-testid="btn-save"]')
    expect(saveBtn.exists()).toBe(true)
    await saveBtn.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('DB locked')
  })
})
