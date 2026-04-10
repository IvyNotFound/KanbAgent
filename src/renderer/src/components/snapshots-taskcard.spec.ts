/**
 * Snapshot tests for TaskCard (split from snapshots.spec.ts, T984/T1283)
 * Run `npx vitest run --update-snapshots` to regenerate after intentional changes.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { createTestingPinia } from '@pinia/testing'
import i18n from '@renderer/plugins/i18n'

import TaskCard from '@renderer/components/TaskCard.vue'
import { makeTask } from './__helpers__/snapshots.helpers'

describe('TaskCard — snapshots', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('matches snapshot: minimal todo task', () => {
    const wrapper = shallowMount(TaskCard, {
      props: {
        task: makeTask({ id: 10, title: 'Simple Task', status: 'todo', effort: 1 }),
      },
      global: {
        plugins: [createTestingPinia({
          initialState: { tasks: { agents: [], dbPath: '/p/db', boardAssignees: new Map() }, tabs: { tabs: [] } },
        }), i18n],
      },
    })
    expect(wrapper.html()).toMatchSnapshot()
  })

  it('matches snapshot: critical in_progress task with all badges', () => {
    // started_at: null → no dynamic tooltip
    const wrapper = shallowMount(TaskCard, {
      props: {
        task: makeTask({
          id: 42,
          title: 'Urgent Fix',
          status: 'in_progress',
          effort: 3,
          priority: 'critical',
          scope: 'back-electron',
          agent_name: 'dev-back',
          started_at: null,
        }),
      },
      global: {
        plugins: [createTestingPinia({
          initialState: { tasks: { agents: [], dbPath: '/p/db', boardAssignees: new Map() }, tabs: { tabs: [] } },
        }), i18n],
      },
    })
    expect(wrapper.html()).toMatchSnapshot()
  })

  it('matches snapshot: done task without agent or perimetre', () => {
    const wrapper = shallowMount(TaskCard, {
      props: {
        task: makeTask({
          id: 99,
          title: 'Completed Task',
          status: 'done',
          effort: undefined as unknown as number,
          priority: undefined as unknown as string,
          scope: null as unknown as string,
          agent_name: null as unknown as string,
          completed_at: '2026-01-02T00:00:00Z',
        }),
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
