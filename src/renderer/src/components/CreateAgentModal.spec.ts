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

    // Find the close button by data-testid (v-btn with icon="mdi-close")
    const closeBtn = wrapper.find('[data-testid="btn-close"]')
    expect(closeBtn?.exists()).toBe(true)
    await closeBtn!.trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('shows submit button disabled when name is empty', async () => {
    const wrapper = shallowMount(CreateAgentModal, {
      global: {
        plugins: [createTestingPinia({
          initialState: { tasks: { dbPath: '/p/.claude/db', projectPath: '/p' } },
        }), i18n],
        stubs: teleportStub,
      },
    })

    // Submit v-btn should be disabled when name is empty
    const submitBtn = wrapper.find('[data-testid="btn-submit"]')
    expect(submitBtn.exists()).toBe(true)
    expect(submitBtn.attributes('disabled')).toBeDefined()
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
    // v-btn elements are custom elements in test context (isCustomElement: tag => tag.startsWith('v-'))
    const vBtns = wrapper.findAll('v-btn')
    const autoBtn = vBtns.find(b => b.text().trim() === 'Auto' || b.text().trim() === 'auto')
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
