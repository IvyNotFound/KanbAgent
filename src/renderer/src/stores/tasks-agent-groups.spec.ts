import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { nextTick } from 'vue'
import { useTasksStore } from '@renderer/stores/tasks'

// Mock window.electronAPI
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
  agentGroupsCreate: vi.fn().mockResolvedValue({ success: true, group: { id: 1, name: 'New Group', sort_order: 0, created_at: '' } }),
  agentGroupsRename: vi.fn().mockResolvedValue({ success: true }),
  agentGroupsDelete: vi.fn().mockResolvedValue({ success: true }),
  agentGroupsSetMember: vi.fn().mockResolvedValue({ success: true }),
  agentKill: vi.fn(),
}

Object.defineProperty(window, 'electronAPI', {
  value: mockElectronAPI,
  writable: true,
})


describe('stores/tasks — auto-resume cold start', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
    mockElectronAPI.queryDb.mockResolvedValue([])
    mockElectronAPI.migrateDb.mockResolvedValue({ success: true })
    mockElectronAPI.watchDb.mockResolvedValue(undefined)
    mockElectronAPI.onDbChanged.mockReturnValue(() => {})
    mockElectronAPI.findProjectDb.mockResolvedValue('/my/project/.claude/project.db')
  })

  it('should call findProjectDb before migrateDb on cold start when projectPath is set', async () => {
    localStorage.setItem('dbPath', '/my/project/.claude/project.db')
    localStorage.setItem('projectPath', '/my/project')

    useTasksStore()
    await nextTick()
    // Let promises settle
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(mockElectronAPI.findProjectDb).toHaveBeenCalledWith('/my/project')
    expect(mockElectronAPI.migrateDb).toHaveBeenCalledWith('/my/project/.claude/project.db')
  })

  it('should call migrateDb even when findProjectDb returns null (fallback)', async () => {
    localStorage.setItem('dbPath', '/my/project/.claude/project.db')
    localStorage.setItem('projectPath', '/my/project')
    mockElectronAPI.findProjectDb.mockResolvedValue(null)

    useTasksStore()
    await nextTick()
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(mockElectronAPI.findProjectDb).toHaveBeenCalledWith('/my/project')
    expect(mockElectronAPI.migrateDb).toHaveBeenCalledWith('/my/project/.claude/project.db')
  })

  it('should skip findProjectDb and call migrateDb directly when projectPath cannot be derived', async () => {
    // Use a dbPath that doesn't match the .claude pattern so projectPath stays null
    localStorage.setItem('dbPath', '/my/project/custom.db')
    // projectPath intentionally not set, and path doesn't match .claude migration

    useTasksStore()
    await nextTick()
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(mockElectronAPI.findProjectDb).not.toHaveBeenCalled()
    expect(mockElectronAPI.migrateDb).toHaveBeenCalledWith('/my/project/custom.db')
  })

  it('should call watchDb after migrateDb and refresh on cold start', async () => {
    localStorage.setItem('dbPath', '/my/project/.claude/project.db')
    localStorage.setItem('projectPath', '/my/project')

    useTasksStore()
    await nextTick()
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(mockElectronAPI.watchDb).toHaveBeenCalledWith('/my/project/.claude/project.db')
  })
})


describe('stores/tasks — setTaskStatut TASK_BLOCKED', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('throws TASK_BLOCKED error when IPC returns TASK_BLOCKED (T553)', async () => {
    const blockers = [{ id: 5, title: 'Blocker', status: 'in_progress' }]
    ;(mockElectronAPI as Record<string, ReturnType<typeof vi.fn>>).tasksUpdateStatus =
      vi.fn().mockResolvedValue({ success: false, error: 'TASK_BLOCKED', blockers })

    const store = useTasksStore()
    store.$patch({ dbPath: '/p/db', tasks: [{ id: 1, status: 'todo', title: 'T' } as never] })

    await expect(store.setTaskStatut(1, 'in_progress')).rejects.toThrow('TASK_BLOCKED')
  })

  it('rolls back optimistic update on TASK_BLOCKED (T553)', async () => {
    const blockers = [{ id: 5, title: 'Blocker', status: 'in_progress' }]
    ;(mockElectronAPI as Record<string, ReturnType<typeof vi.fn>>).tasksUpdateStatus =
      vi.fn().mockResolvedValue({ success: false, error: 'TASK_BLOCKED', blockers })

    const store = useTasksStore()
    store.$patch({ dbPath: '/p/db', tasks: [{ id: 1, status: 'todo', title: 'T' } as never] })

    try { await store.setTaskStatut(1, 'in_progress') } catch { /* expected */ }

    expect(store.tasks.find(t => t.id === 1)?.status).toBe('todo')
  })
})


