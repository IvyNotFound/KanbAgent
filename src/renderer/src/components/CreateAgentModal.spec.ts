import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount, shallowMount, flushPromises } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import CreateAgentModal from '@renderer/components/CreateAgentModal.vue'
import i18n from '@renderer/plugins/i18n'

describe('CreateAgentModal', () => {
  const teleportStub = { Teleport: { template: '<div><slot /></div>' } }

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    const api = window.electronAPI as Record<string, ReturnType<typeof vi.fn>>
    api.createAgent.mockResolvedValue({ success: true, agentId: 1 })
    api.getAgentSystemPrompt.mockResolvedValue({ success: true, systemPrompt: null, systemPromptSuffix: null, thinkingMode: 'auto' })
  })

  it('renders create form title', () => {
    const wrapper = shallowMount(CreateAgentModal, {
      global: {
        plugins: [createTestingPinia({
          initialState: { tasks: { dbPath: '/p/.claude/db', projectPath: '/p' } },
        }), i18n],
        stubs: teleportStub,
      },
    })
    expect(wrapper.exists()).toBe(true)
    // Should show the "new agent" title (i18n fr: "Nouvel agent")
    const text = wrapper.text()
    expect(text).toContain('Nouvel agent')
  })

  it('emits close when close button is clicked', async () => {
    const wrapper = shallowMount(CreateAgentModal, {
      global: {
        plugins: [createTestingPinia({
          initialState: { tasks: { dbPath: '/p/.claude/db', projectPath: '/p' } },
        }), i18n],
        stubs: teleportStub,
      },
    })

    // Find the close button by class
    const closeBtn = wrapper.find('button.btn-close')
    expect(closeBtn?.exists()).toBe(true)
    await closeBtn!.trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('shows name error when submitting empty name', async () => {
    const wrapper = shallowMount(CreateAgentModal, {
      global: {
        plugins: [createTestingPinia({
          initialState: { tasks: { dbPath: '/p/.claude/db', projectPath: '/p' } },
        }), i18n],
        stubs: teleportStub,
      },
    })

    // Submit button should be disabled when name is empty
    const submitBtn = wrapper.findAll('button').find(b => b.attributes('disabled') !== undefined)
    expect(submitBtn?.exists()).toBe(true)
  })

  it('renders thinking mode buttons (auto/disabled)', () => {
    const wrapper = shallowMount(CreateAgentModal, {
      global: {
        plugins: [createTestingPinia({
          initialState: { tasks: { dbPath: '/p/.claude/db', projectPath: '/p' } },
        }), i18n],
        stubs: teleportStub,
      },
    })
    const buttons = wrapper.findAll('button')
    const autoBtn = buttons.find(b => b.text().trim() === 'Auto' || b.text().trim() === 'auto')
    expect(autoBtn?.exists()).toBe(true)
  })

  it('emits close when backdrop is clicked', async () => {
    const wrapper = shallowMount(CreateAgentModal, {
      global: {
        plugins: [createTestingPinia({
          initialState: { tasks: { dbPath: '/p/.claude/db', projectPath: '/p' } },
        }), i18n],
        stubs: teleportStub,
      },
    })

    const backdrop = wrapper.find('[data-testid="create-agent-backdrop"]')
    await backdrop.trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })
})
