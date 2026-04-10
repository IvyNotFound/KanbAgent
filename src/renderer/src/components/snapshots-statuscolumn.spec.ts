/**
 * Snapshot tests for StatusColumn (split from snapshots.spec.ts, T984/T1283)
 * Run `npx vitest run --update-snapshots` to regenerate after intentional changes.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { createTestingPinia } from '@pinia/testing'
import i18n from '@renderer/plugins/i18n'

import StatusColumn from '@renderer/components/StatusColumn.vue'
import { makeTask } from './__helpers__/snapshots.helpers'

describe('StatusColumn — snapshots', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('matches snapshot: empty column', () => {
    const wrapper = shallowMount(StatusColumn, {
      props: {
        title: 'Todo',
        statut: 'todo',
        tasks: [],
        accentColor: '#94a3b8',
      },
      global: {
        plugins: [createTestingPinia({
          initialState: { tasks: { agents: [], dbPath: '/p/db', boardAssignees: new Map() }, tabs: { tabs: [] } },
        }), i18n],
      },
    })
    expect(wrapper.html()).toMatchSnapshot()
  })

  it('matches snapshot: column with 2 tasks', () => {
    const tasks = [
      makeTask({ id: 1, title: 'Task Alpha', status: 'todo' }),
      makeTask({ id: 2, title: 'Task Beta', status: 'todo', priority: 'high' }),
    ]
    const wrapper = shallowMount(StatusColumn, {
      props: {
        title: 'Todo',
        statut: 'todo',
        tasks,
        accentColor: '#94a3b8',
      },
      global: {
        plugins: [createTestingPinia({
          initialState: { tasks: { agents: [], dbPath: '/p/db', boardAssignees: new Map() }, tabs: { tabs: [] } },
        }), i18n],
      },
    })
    expect(wrapper.html()).toMatchSnapshot()
  })

  it('matches snapshot: in_progress column (drop target)', () => {
    const tasks = [makeTask({ id: 3, title: 'Active Task', status: 'in_progress', effort: 3 })]
    const wrapper = shallowMount(StatusColumn, {
      props: {
        title: 'In Progress',
        statut: 'in_progress',
        tasks,
        accentColor: '#22d3ee',
      },
      global: {
        plugins: [createTestingPinia({
          initialState: { tasks: { agents: [], dbPath: '/p/db', boardAssignees: new Map() }, tabs: { tabs: [] } },
        }), i18n],
      },
    })
    expect(wrapper.html()).toMatchSnapshot()
  })
})
