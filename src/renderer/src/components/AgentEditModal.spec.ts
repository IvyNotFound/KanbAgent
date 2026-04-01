import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount, shallowMount, flushPromises } from '@vue/test-utils'
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
    const input = wrapper.find('input')
    expect(input.exists()).toBe(true)
    expect((input.element as HTMLInputElement).value).toBe('dev-front')
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
    const buttons = wrapper.findAll('button')
    const autoBtn = buttons.find(b => b.text().trim().toLowerCase() === 'auto')
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
    const textarea = wrapper.find('textarea')
    expect(textarea.exists()).toBe(true)
    expect((textarea.element as HTMLTextAreaElement).value).toBe('Bash,Edit,Read')
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
    const backdrop = wrapper.find('.fixed.inset-0')
    await backdrop.trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('emits close when close button ✕ is clicked', async () => {
    const wrapper = shallowMount(AgentEditModal, {
      props: { agent },
      global: {
        plugins: [createTestingPinia({
          initialState: { tasks: { dbPath: '/p/.claude/db' } },
        }), i18n],
        stubs: teleportStub,
      },
    })
    const closeBtn = wrapper.findAll('button').find(b => b.text().includes('✕'))
    expect(closeBtn?.exists()).toBe(true)
    await closeBtn!.trigger('click')
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

    // Click the save button
    const saveBtn = wrapper.findAll('button').find(b => {
      const text = b.text().toLowerCase()
      return text.includes('save') || text.includes('enregistrer') || text.includes('sauvegarder')
    })
    expect(saveBtn?.exists()).toBe(true)
    await saveBtn!.trigger('click')
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

    const saveBtn = wrapper.findAll('button').find(b => {
      const text = b.text().toLowerCase()
      return text.includes('save') || text.includes('enregistrer') || text.includes('sauvegarder')
    })
    expect(saveBtn?.exists()).toBe(true)
    await saveBtn!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('DB locked')
  })

})
