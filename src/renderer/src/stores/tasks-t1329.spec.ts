/**
 * tasks-t1329.spec.ts
 * Targets surviving mutants T1329:
 * - L149: WSL mixed label plural (wslCount === 1 in else branch — 's' vs '')
 * - L199: rollback guard `previousStatus !== undefined` (IPC throw path)
 * - L203: rollback guard `previousStatus !== undefined` (res.success=false path)
 * - tasksByStatus: t.status absent from groups → ignored silently
 * - tasksByStatus: t.status present in groups → task in correct group
 * - updateTaskStatus success → previousStatus cleared (task keeps new status)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useTasksStore } from '@renderer/stores/tasks'
import { useTabsStore } from '@renderer/stores/tabs'

const mockElectronAPI = {
  queryDb: vi.fn().mockResolvedValue([]),
  watchDb: vi.fn().mockResolvedValue(undefined),
  unwatchDb: vi.fn().mockResolvedValue(undefined),
  onDbChanged: vi.fn().mockReturnValue(() => {}),
  selectProjectDir: vi.fn().mockResolvedValue(null),
  showConfirmDialog: vi.fn().mockResolvedValue(true),
  migrateDb: vi.fn().mockResolvedValue({ success: true }),
  terminalKill: vi.fn(),
  findProjectDb: vi.fn().mockResolvedValue(null),
  getTaskLinks: vi.fn().mockResolvedValue({ success: true, links: [] }),
  getTaskAssignees: vi.fn().mockResolvedValue({ success: true, assignees: [] }),
  agentGroupsList: vi.fn().mockResolvedValue({ success: true, groups: [] }),
  agentGroupsCreate: vi.fn().mockResolvedValue({ success: true, group: { id: 1, name: 'G', sort_order: 0, created_at: '' } }),
  agentGroupsRename: vi.fn().mockResolvedValue({ success: true }),
  agentGroupsDelete: vi.fn().mockResolvedValue({ success: true }),
  agentGroupsSetMember: vi.fn().mockResolvedValue({ success: true }),
  agentGroupsSetParent: vi.fn().mockResolvedValue({ success: true }),
  getConfigValue: vi.fn().mockResolvedValue({ success: false, value: null }),
  agentKill: vi.fn(),
  tasksUpdateStatus: vi.fn().mockResolvedValue({ success: true }),
}

Object.defineProperty(window, 'electronAPI', {
  value: mockElectronAPI,
  writable: true,
})


// ─── L149: WSL mixed label — singular wslCount (mutant: wslCount > 1 → >= 1) ──

describe('tasks — selectProject WSL mixed label singular wslCount (L149)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
    mockElectronAPI.queryDb.mockResolvedValue([])
    mockElectronAPI.migrateDb.mockResolvedValue({ success: true })
    mockElectronAPI.watchDb.mockResolvedValue(undefined)
    mockElectronAPI.onDbChanged.mockReturnValue(() => {})
  })

  it('uses singular "session" for wslCount=1 in mixed label (wslCount > 1 is false)', async () => {
    const tasksStore = useTasksStore()
    const tabsStore = useTabsStore()
    // 1 WSL + 1 non-WSL → else branch, wslCount=1, nonWslCount=1
    tabsStore.addTerminal('agent-wsl', 'Ubuntu')
    tabsStore.addTerminal('agent-native') // no wslDistro
    mockElectronAPI.showConfirmDialog.mockResolvedValue(false)

    await tasksStore.selectProject()

    // wslCount (1) > 1 is false → no 's' after "session"
    expect(mockElectronAPI.showConfirmDialog).toHaveBeenCalledWith(
      expect.objectContaining({ message: '1 session WSL + 1 terminal' })
    )
  })

  it('uses plural "sessions" for wslCount=2 in mixed label (wslCount > 1 is true)', async () => {
    const tasksStore = useTasksStore()
    const tabsStore = useTabsStore()
    // 2 WSL + 1 non-WSL → else branch, wslCount=2, nonWslCount=1
    tabsStore.addTerminal('agent-wsl-1', 'Ubuntu')
    tabsStore.addTerminal('agent-wsl-2', 'Debian')
    tabsStore.addTerminal('agent-native')
    mockElectronAPI.showConfirmDialog.mockResolvedValue(false)

    await tasksStore.selectProject()

    // wslCount (2) > 1 is true → plural "sessions"
    expect(mockElectronAPI.showConfirmDialog).toHaveBeenCalledWith(
      expect.objectContaining({ message: '2 sessions WSL + 1 terminal' })
    )
  })

  it('nonWslCount is n - wslCount (not n + wslCount) in mixed label', async () => {
    const tasksStore = useTasksStore()
    const tabsStore = useTabsStore()
    // 1 WSL + 2 non-WSL → wslCount=1, n=3, nonWslCount=2
    tabsStore.addTerminal('agent-wsl', 'Ubuntu')
    tabsStore.addTerminal('agent-native-1')
    tabsStore.addTerminal('agent-native-2')
    mockElectronAPI.showConfirmDialog.mockResolvedValue(false)

    await tasksStore.selectProject()

    expect(mockElectronAPI.showConfirmDialog).toHaveBeenCalledWith(
      expect.objectContaining({ message: '1 session WSL + 2 terminal' })
    )
  })
})


// ─── L199: rollback guard `previousStatus !== undefined` (IPC throw path) ────

describe('tasks — setTaskStatut rollback guard previousStatus === undefined (L199)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('does NOT rollback when task has no status property (previousStatus === undefined) — IPC throw', async () => {
    // Task object without a `status` field → task?.status is undefined
    mockElectronAPI.tasksUpdateStatus = vi.fn().mockRejectedValue(new Error('IPC error'))

    const store = useTasksStore()
    store.$patch({
      dbPath: '/p/db',
      // task has no `status` key → task?.status = undefined → previousStatus = undefined
      tasks: [{ id: 1, title: 'Task without status' }] as never,
    })

    // setTaskStatut does optimistic update: task.status = 'in_progress'
    // On IPC throw: guard `previousStatus !== undefined` is false → NO rollback
    await expect(store.setTaskStatut(1, 'in_progress')).rejects.toThrow()

    // status stays at 'in_progress' (optimistic) — not rolled back
    expect(store.tasks[0].status).toBe('in_progress')
  })

  it('DOES rollback when task has a defined previousStatus — IPC throw', async () => {
    mockElectronAPI.tasksUpdateStatus = vi.fn().mockRejectedValue(new Error('IPC error'))

    const store = useTasksStore()
    store.$patch({
      dbPath: '/p/db',
      tasks: [{ id: 1, title: 'Task', status: 'todo' }] as never,
    })

    await expect(store.setTaskStatut(1, 'in_progress')).rejects.toThrow()

    // previousStatus was 'todo' (defined) → rollback executed
    expect(store.tasks[0].status).toBe('todo')
  })
})


// ─── L203: rollback guard `previousStatus !== undefined` (res.success=false) ──

describe('tasks — setTaskStatut rollback guard previousStatus === undefined (L203)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('does NOT rollback when previousStatus === undefined — res.success=false', async () => {
    mockElectronAPI.tasksUpdateStatus = vi.fn().mockResolvedValue({ success: false, error: 'UPDATE_FAILED' })

    const store = useTasksStore()
    store.$patch({
      dbPath: '/p/db',
      tasks: [{ id: 1, title: 'Task without status' }] as never,
    })

    try {
      await store.setTaskStatut(1, 'in_progress')
    } catch { /* expected */ }

    // guard `previousStatus !== undefined` is false → no rollback → stays 'in_progress'
    expect(store.tasks[0].status).toBe('in_progress')
  })

  it('DOES rollback when previousStatus is defined — res.success=false', async () => {
    mockElectronAPI.tasksUpdateStatus = vi.fn().mockResolvedValue({ success: false, error: 'UPDATE_FAILED' })

    const store = useTasksStore()
    store.$patch({
      dbPath: '/p/db',
      tasks: [{ id: 1, title: 'Task', status: 'in_progress' }] as never,
    })

    try {
      await store.setTaskStatut(1, 'in_progress')
    } catch { /* expected */ }

    // previousStatus was 'in_progress' (defined) → rollback → stays 'in_progress'
    expect(store.tasks[0].status).toBe('in_progress')
  })

  it('rollback restores exact previous status value on res.success=false', async () => {
    mockElectronAPI.tasksUpdateStatus = vi.fn().mockResolvedValue({ success: false, error: 'BLOCKED' })

    const store = useTasksStore()
    store.$patch({
      dbPath: '/p/db',
      tasks: [{ id: 5, title: 'Blocked Task', status: 'done' }] as never,
    })

    try {
      await store.setTaskStatut(5, 'in_progress')
    } catch { /* expected */ }

    expect(store.tasks[0].status).toBe('done')
  })
})


// ─── updateTaskStatus success → task keeps new status ────────────────────────

describe('tasks — setTaskStatut success: new status persists (no rollback)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('task keeps updated status after successful IPC call', async () => {
    mockElectronAPI.tasksUpdateStatus = vi.fn().mockResolvedValue({ success: true })

    const store = useTasksStore()
    store.$patch({
      dbPath: '/p/db',
      tasks: [{ id: 1, title: 'Task', status: 'todo' }] as never,
    })

    await store.setTaskStatut(1, 'in_progress')

    expect(store.tasks[0].status).toBe('in_progress')
  })

  it('other tasks are unaffected after successful setTaskStatut', async () => {
    mockElectronAPI.tasksUpdateStatus = vi.fn().mockResolvedValue({ success: true })

    const store = useTasksStore()
    store.$patch({
      dbPath: '/p/db',
      tasks: [
        { id: 1, title: 'Task A', status: 'todo' },
        { id: 2, title: 'Task B', status: 'todo' },
      ] as never,
    })

    await store.setTaskStatut(2, 'in_progress')

    expect(store.tasks[0].status).toBe('todo')   // Task A unchanged
    expect(store.tasks[1].status).toBe('in_progress') // Task B updated
  })
})


// ─── tasksByStatus: t.status in groups vs absent from groups ──────────────────

describe('tasks — tasksByStatus grouping (t.status in groups)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('task with valid status is placed in the correct group', () => {
    const store = useTasksStore()
    store.$patch({
      tasks: [
        { id: 1, title: 'T1', status: 'todo', agent_assigned_id: null },
        { id: 2, title: 'T2', status: 'in_progress', agent_assigned_id: null },
        { id: 3, title: 'T3', status: 'done', agent_assigned_id: null },
        { id: 4, title: 'T4', status: 'archived', agent_assigned_id: null },
      ] as never,
    })

    const groups = store.tasksByStatus

    expect(groups.todo).toHaveLength(1)
    expect(groups.todo[0].id).toBe(1)
    expect(groups.in_progress).toHaveLength(1)
    expect(groups.in_progress[0].id).toBe(2)
    expect(groups.done).toHaveLength(1)
    expect(groups.done[0].id).toBe(3)
    expect(groups.archived).toHaveLength(1)
    expect(groups.archived[0].id).toBe(4)
  })

  it('task with status absent from groups is silently ignored (not pushed to any group)', () => {
    const store = useTasksStore()
    store.$patch({
      tasks: [
        { id: 1, title: 'Valid', status: 'todo', agent_assigned_id: null },
        // 'rejected' is not a key in groups
        { id: 2, title: 'Invalid', status: 'rejected', agent_assigned_id: null },
        // empty string is also not a key in groups
        { id: 3, title: 'Empty', status: '', agent_assigned_id: null },
      ] as never,
    })

    const groups = store.tasksByStatus

    expect(groups.todo).toHaveLength(1)
    expect(groups.todo[0].id).toBe(1)
    // id=2 and id=3 are not present in any group
    const allGroupedIds = [
      ...groups.todo,
      ...groups.in_progress,
      ...groups.done,
      ...groups.archived,
    ].map(t => t.id)
    expect(allGroupedIds).not.toContain(2)
    expect(allGroupedIds).not.toContain(3)
  })

  it('empty tasks array produces all empty groups', () => {
    const store = useTasksStore()
    store.$patch({ tasks: [] as never })

    const groups = store.tasksByStatus

    expect(groups.todo).toHaveLength(0)
    expect(groups.in_progress).toHaveLength(0)
    expect(groups.done).toHaveLength(0)
    expect(groups.archived).toHaveLength(0)
  })
})
