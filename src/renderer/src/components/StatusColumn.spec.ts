import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { shallowMount } from '@vue/test-utils'
import type { Task } from '@renderer/types'
import StatusColumn from '@renderer/components/StatusColumn.vue'
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
    agent_validator_id: null,
    priority: 'normal',
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

describe('StatusColumn', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('renders the column title', () => {
    const wrapper = shallowMount(StatusColumn, {
      props: { title: 'À faire', statut: 'todo', tasks: [], accentColor: '#f59e0b' },
      global: { plugins: [i18n] },
    })
    expect(wrapper.text()).toContain('À faire')
  })

  it('shows correct task count badge', () => {
    const tasks = [makeTask({ id: 1 }), makeTask({ id: 2 })]
    const wrapper = shallowMount(StatusColumn, {
      props: { title: 'À faire', statut: 'todo', tasks, accentColor: '#f59e0b' },
      global: { plugins: [i18n] },
    })
    // The count badge shows tasks.length
    expect(wrapper.text()).toContain('2')
  })


  it('shows empty state message when tasks array is empty', () => {
    const wrapper = shallowMount(StatusColumn, {
      props: { title: 'À faire', statut: 'todo', tasks: [], accentColor: '#f59e0b' },
      global: { plugins: [i18n] },
    })
    expect(wrapper.text()).toContain('Aucune tâche')
  })

  it('does not show empty state when there are tasks', () => {
    const tasks = [makeTask()]
    const wrapper = shallowMount(StatusColumn, {
      props: { title: 'À faire', statut: 'todo', tasks, accentColor: '#f59e0b' },
      global: { plugins: [i18n] },
    })
    expect(wrapper.text()).not.toContain('Aucune tâche')
  })

  it('renders one task-card stub per task', () => {
    const tasks = [makeTask({ id: 1 }), makeTask({ id: 2 }), makeTask({ id: 3 })]
    const wrapper = shallowMount(StatusColumn, {
      props: { title: 'En cours', statut: 'in_progress', tasks, accentColor: '#3b82f6' },
      global: { plugins: [i18n] },
    })
    // shallowMount stubs TaskCard — count stubs
    const cards = wrapper.findAllComponents({ name: 'TaskCard' })
    expect(cards).toHaveLength(3)
  })

  it('applies accent color to the indicator dot via inline style', () => {
    const wrapper = shallowMount(StatusColumn, {
      props: { title: 'Terminé', statut: 'done', tasks: [], accentColor: '#22c55e' },
      global: { plugins: [i18n] },
    })
    const dot = wrapper.find('.column-accent')
    expect(dot.exists()).toBe(true)
    // JSDOM converts hex to rgb — check for the rgb equivalent of #22c55e
    expect(dot.attributes('style')).toMatch(/background-color/)
  })
})
