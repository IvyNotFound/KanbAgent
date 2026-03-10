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


describe('stores/tasks — watchForDb', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
    mockElectronAPI.queryDb.mockResolvedValue([])
    mockElectronAPI.migrateDb.mockResolvedValue({ success: true })
    mockElectronAPI.watchDb.mockResolvedValue(undefined)
    mockElectronAPI.onDbChanged.mockReturnValue(() => {})
  })

  it('should call findProjectDb on interval tick', async () => {
    vi.useFakeTimers()
    const store = useTasksStore()
    mockElectronAPI.findProjectDb.mockResolvedValue(null)

    store.watchForDb('/my/project')

    await vi.advanceTimersByTimeAsync(2000)

    expect(mockElectronAPI.findProjectDb).toHaveBeenCalledWith('/my/project')

    vi.useRealTimers()
  })

  it('should call setProject when findProjectDb returns a db path', async () => {
    vi.useFakeTimers()
    const store = useTasksStore()
    mockElectronAPI.findProjectDb.mockResolvedValue('/my/project/.claude/project.db')

    store.watchForDb('/my/project')

    await vi.advanceTimersByTimeAsync(2000)

    expect(store.projectPath).toBe('/my/project')
    expect(store.dbPath).toBe('/my/project/.claude/project.db')

    vi.useRealTimers()
  })

  it('should stop polling once db is found', async () => {
    vi.useFakeTimers()
    const store = useTasksStore()
    mockElectronAPI.findProjectDb.mockResolvedValueOnce('/my/project/.claude/project.db')

    store.watchForDb('/my/project')

    await vi.advanceTimersByTimeAsync(2000)
    mockElectronAPI.findProjectDb.mockClear()

    await vi.advanceTimersByTimeAsync(4000)

    // findProjectDb should not be called again after db was found
    expect(mockElectronAPI.findProjectDb).not.toHaveBeenCalled()

    vi.useRealTimers()
  })

  it('should clear previous interval when called again', async () => {
    vi.useFakeTimers()
    const store = useTasksStore()
    mockElectronAPI.findProjectDb.mockResolvedValue(null)

    store.watchForDb('/first')
    store.watchForDb('/second')

    await vi.advanceTimersByTimeAsync(2000)

    // Should only call with '/second' (not '/first') — first interval was cleared
    expect(mockElectronAPI.findProjectDb).toHaveBeenCalledWith('/second')
    expect(mockElectronAPI.findProjectDb).not.toHaveBeenCalledWith('/first')

    vi.useRealTimers()
  })
})


describe('stores/tasks — startWatching', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
    mockElectronAPI.queryDb.mockResolvedValue([])
    mockElectronAPI.migrateDb.mockResolvedValue({ success: true })
    mockElectronAPI.watchDb.mockResolvedValue(undefined)
    mockElectronAPI.onDbChanged.mockReturnValue(() => {})
  })

  it('should register onDbChanged callback via setProject', async () => {
    const store = useTasksStore()

    await store.setProject('/p', '/p/.claude/db')

    expect(mockElectronAPI.onDbChanged).toHaveBeenCalled()
  })

  it('should call refresh when onDbChanged callback fires', async () => {
    const store = useTasksStore()
    let dbChangedCallback: (() => void) | null = null
    mockElectronAPI.onDbChanged.mockImplementation((cb: () => void) => {
      dbChangedCallback = cb
      return () => {}
    })

    await store.setProject('/p', '/p/.claude/db')
    mockElectronAPI.queryDb.mockClear()

    // Simulate DB change event
    dbChangedCallback!()
    // Give the async refresh a tick to fire
    await vi.waitFor(() => {
      expect(mockElectronAPI.queryDb).toHaveBeenCalled()
    })
  })
})


describe('stores/tasks — closeTask', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
    mockElectronAPI.queryDb.mockResolvedValue([])
    mockElectronAPI.migrateDb.mockResolvedValue({ success: true })
    mockElectronAPI.watchDb.mockResolvedValue(undefined)
    mockElectronAPI.onDbChanged.mockReturnValue(() => {})
  })

  it('should set selectedTask to null', () => {
    const store = useTasksStore()
    store.selectedTask = { id: 1, title: 'Task 1' } as never
    store.taskComments = [{ id: 1, content: 'comment' }] as never

    store.closeTask()

    expect(store.selectedTask).toBeNull()
  })

  it('should clear taskComments', () => {
    const store = useTasksStore()
    store.selectedTask = { id: 1, title: 'Task 1' } as never
    store.taskComments = [{ id: 1, content: 'c1' }, { id: 2, content: 'c2' }] as never

    store.closeTask()

    expect(store.taskComments).toHaveLength(0)
  })

  it('should be a no-op when already closed', () => {
    const store = useTasksStore()
    expect(store.selectedTask).toBeNull()
    expect(store.taskComments).toHaveLength(0)

    store.closeTask()

    expect(store.selectedTask).toBeNull()
    expect(store.taskComments).toHaveLength(0)
  })
})


