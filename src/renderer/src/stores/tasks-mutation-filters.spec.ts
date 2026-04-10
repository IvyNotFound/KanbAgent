/**
 * tasks-mutation-filters.spec.ts
 * Targets surviving EqualityOperator mutations in tasks.ts.
 * Focus: tasksByStatus grouping, filteredTasks agent/scope filter precision.
 * Split from tasks-mutation.spec.ts (T1348)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useTasksStore } from '@renderer/stores/tasks'
import { installMockElectronAPI } from './__helpers__/tasks-mutation.helpers'

installMockElectronAPI()


// ─── EqualityOperator: status in tasksByStatus grouping ──────────────────────
// Mutation target: replace 'done' === status with !== → task ends in wrong bucket

describe('tasks — tasksByStatus status equality grouping', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('task with status "done" goes into done bucket only (not in todo/in_progress/archived)', () => {
    const store = useTasksStore()
    store.tasks = [{ id: 1, title: 'Done T', status: 'done', agent_assigned_id: null }] as never

    const byStatus = store.tasksByStatus

    expect(byStatus.done).toHaveLength(1)
    expect(byStatus.todo).toHaveLength(0)
    expect(byStatus.in_progress).toHaveLength(0)
    expect(byStatus.archived).toHaveLength(0)
  })

  it('task with status "todo" goes into todo bucket only', () => {
    const store = useTasksStore()
    store.tasks = [{ id: 2, title: 'Todo T', status: 'todo', agent_assigned_id: null }] as never

    const byStatus = store.tasksByStatus

    expect(byStatus.todo).toHaveLength(1)
    expect(byStatus.done).toHaveLength(0)
  })

  it('task with status "in_progress" goes into in_progress bucket only', () => {
    const store = useTasksStore()
    store.tasks = [{ id: 3, title: 'WIP T', status: 'in_progress', agent_assigned_id: null }] as never

    const byStatus = store.tasksByStatus

    expect(byStatus.in_progress).toHaveLength(1)
    expect(byStatus.todo).toHaveLength(0)
    expect(byStatus.done).toHaveLength(0)
  })

  it('task with status "archived" goes into archived bucket only', () => {
    const store = useTasksStore()
    store.tasks = [{ id: 4, title: 'Arch T', status: 'archived', agent_assigned_id: null }] as never

    const byStatus = store.tasksByStatus

    expect(byStatus.archived).toHaveLength(1)
    expect(byStatus.todo).toHaveLength(0)
  })

  it('different statuses are mutually exclusive — 4 tasks one per bucket', () => {
    const store = useTasksStore()
    store.tasks = [
      { id: 10, title: 'T', status: 'todo' },
      { id: 11, title: 'T', status: 'in_progress' },
      { id: 12, title: 'T', status: 'done' },
      { id: 13, title: 'T', status: 'archived' },
    ] as never

    const byStatus = store.tasksByStatus

    expect(byStatus.todo).toHaveLength(1)
    expect(byStatus.in_progress).toHaveLength(1)
    expect(byStatus.done).toHaveLength(1)
    expect(byStatus.archived).toHaveLength(1)
    // Total = 4 — no duplicates across buckets
    const total = byStatus.todo.length + byStatus.in_progress.length + byStatus.done.length + byStatus.archived.length + byStatus.rejected.length
    expect(total).toBe(4)
  })

  it('task with unknown status does not appear in any bucket', () => {
    const store = useTasksStore()
    store.tasks = [{ id: 99, title: 'Unknown', status: 'unknown_status' }] as never

    const byStatus = store.tasksByStatus

    expect(byStatus.todo).toHaveLength(0)
    expect(byStatus.in_progress).toHaveLength(0)
    expect(byStatus.done).toHaveLength(0)
    expect(byStatus.archived).toHaveLength(0)
  })
})


// ─── EqualityOperator: filteredTasks agent and scope filters ─────────────────
// Mutation target: !== becomes === or === becomes !== in filter predicates

describe('tasks — filteredTasks agent filter equality (EqualityOperator)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('selectedAgentId=5 keeps only tasks with agent_assigned_id=5, excludes agent=6', () => {
    const store = useTasksStore()
    store.tasks = [
      { id: 1, agent_assigned_id: 5, scope: null, status: 'todo' },
      { id: 2, agent_assigned_id: 6, scope: null, status: 'todo' },
      { id: 3, agent_assigned_id: 5, scope: null, status: 'done' },
    ] as never
    store.selectedAgentId = 5

    const filtered = store.filteredTasks
    expect(filtered.map(t => t.id)).toEqual([1, 3])
    // Mutation kill: must NOT include agent=6 (id=2)
    expect(filtered.find(t => t.id === 2)).toBeUndefined()
  })

  it('selectedAgentId=null includes all agents', () => {
    const store = useTasksStore()
    store.tasks = [
      { id: 1, agent_assigned_id: 5, status: 'todo' },
      { id: 2, agent_assigned_id: 6, status: 'todo' },
    ] as never
    store.selectedAgentId = null

    expect(store.filteredTasks).toHaveLength(2)
  })

  it('toggleAgentFilter sets the filter and a second call with same id clears it', () => {
    const store = useTasksStore()
    store.toggleAgentFilter(10)
    expect(store.selectedAgentId).toBe(10)

    store.toggleAgentFilter(10) // toggle off
    expect(store.selectedAgentId).toBeNull()
  })

  it('toggleAgentFilter with different id replaces the filter', () => {
    const store = useTasksStore()
    store.toggleAgentFilter(10)
    store.toggleAgentFilter(20)

    expect(store.selectedAgentId).toBe(20)
  })
})


// ─── EqualityOperator: filteredTasks scope filter ────────────────────────────

describe('tasks — filteredTasks scope filter equality (EqualityOperator)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('selectedPerimetre="front-vuejs" excludes tasks with scope="back-electron"', () => {
    const store = useTasksStore()
    store.tasks = [
      { id: 1, scope: 'front-vuejs', agent_assigned_id: null, status: 'todo' },
      { id: 2, scope: 'back-electron', agent_assigned_id: null, status: 'todo' },
    ] as never
    store.selectedPerimetre = 'front-vuejs'

    const filtered = store.filteredTasks
    expect(filtered).toHaveLength(1)
    expect(filtered[0].id).toBe(1)
    // Mutation kill: must NOT include scope="back-electron"
    expect(filtered.find(t => t.id === 2)).toBeUndefined()
  })

  it('agent filter AND scope filter are both applied (combined AND)', () => {
    const store = useTasksStore()
    store.tasks = [
      { id: 1, agent_assigned_id: 5, scope: 'front-vuejs', status: 'todo' },
      { id: 2, agent_assigned_id: 5, scope: 'back-electron', status: 'todo' },
      { id: 3, agent_assigned_id: 6, scope: 'front-vuejs', status: 'todo' },
    ] as never
    store.selectedAgentId = 5
    store.selectedPerimetre = 'front-vuejs'

    const filtered = store.filteredTasks
    expect(filtered).toHaveLength(1)
    expect(filtered[0].id).toBe(1)
  })
})
