import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount, shallowMount, flushPromises } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import CommandPalette from '@renderer/components/CommandPalette.vue'
import i18n from '@renderer/plugins/i18n'

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    title: 'Fix login bug',
    description: 'Users cannot login with special chars',
    status: 'todo',
    scope: 'front-vuejs',
    effort: 2,
    agent_assigned_id: 1,
    agent_name: 'dev-front',
    agent_creator_id: null,
    agent_creator_name: null,
    agent_scope: null,
    parent_task_id: null,
    session_id: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    started_at: null,
    completed_at: null,
    validated_at: null,
    ...overrides,
  } as Task
}

// ── StatusColumn ──────────────────────────────────────────────────────────────

describe('CommandPalette', () => {
  const teleportStub = {
    Teleport: { template: '<div><slot /></div>' },
    Transition: { template: '<div><slot /></div>' },
  }

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('renders nothing when modelValue is false', () => {
    const wrapper = shallowMount(CommandPalette, {
      props: { modelValue: false },
      global: {
        plugins: [createTestingPinia(), i18n],
        stubs: teleportStub,
      },
    })
    // With modelValue=false, v-if on the inner wrapper hides all palette content
    const input = wrapper.find('[data-testid="search-input"]')
    expect(input.exists()).toBe(false)
  })

  it('renders search input when modelValue is true', () => {
    const wrapper = shallowMount(CommandPalette, {
      props: { modelValue: true },
      global: {
        plugins: [createTestingPinia(), i18n],
        stubs: teleportStub,
      },
    })
    const input = wrapper.find('[data-testid="search-input"]')
    expect(input.exists()).toBe(true)
  })

  it('emits update:modelValue false when backdrop is clicked', async () => {
    const wrapper = shallowMount(CommandPalette, {
      props: { modelValue: true },
      global: {
        plugins: [createTestingPinia(), i18n],
        stubs: teleportStub,
      },
    })

    // v-dialog handles the overlay click; the inner wrapper has @click.self as a test-compat fallback
    const backdrop = wrapper.find('[data-testid="palette-backdrop"]')
    await backdrop.trigger('click')
    expect(wrapper.emitted('update:modelValue')).toHaveLength(1)
    expect(wrapper.emitted('update:modelValue')![0]).toEqual([false])
  })

  it('shows empty state when no tasks are loaded', () => {
    const wrapper = shallowMount(CommandPalette, {
      props: { modelValue: true },
      global: {
        plugins: [createTestingPinia({ initialState: { tasks: { tasks: [] } } }), i18n],
        stubs: teleportStub,
      },
    })
    // Should display "no tasks loaded" message (i18n fr: "Aucune tâche chargée")
    const text = wrapper.text()
    expect(text).toContain('Aucune')
  })

  it('displays tasks from store when tasks are present', () => {
    const tasks = [makeTask({ id: 1, title: 'Fix login bug' }), makeTask({ id: 2, title: 'Add dark mode' })]
    const wrapper = shallowMount(CommandPalette, {
      props: { modelValue: true },
      global: {
        plugins: [createTestingPinia({ initialState: { tasks: { tasks } } }), i18n],
        stubs: teleportStub,
      },
    })
    expect(wrapper.text()).toContain('Fix login bug')
    expect(wrapper.text()).toContain('Add dark mode')
  })
})
