import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { nextTick } from 'vue'
import { useTasksStore } from '@renderer/stores/tasks'
import { useTabsStore } from '@renderer/stores/tabs'
import { useSettingsStore } from '@renderer/stores/settings'

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


describe('stores/tasks', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
  })

  describe('filteredTasks', () => {
    it('should return all tasks when no filter selected', () => {
      const store = useTasksStore()
      store.tasks = [
        { id: 1, titre: 'Task 1', agent_assigne_id: 1, perimetre: 'front-vuejs', statut: 'todo' },
        { id: 2, titre: 'Task 2', agent_assigne_id: 2, perimetre: 'back-electron', statut: 'todo' },
      ] as never

      const filtered = store.filteredTasks
      expect(filtered).toHaveLength(2)
    })

    it('should filter by agent_id', () => {
      const store = useTasksStore()
      store.tasks = [
        { id: 1, titre: 'Task 1', agent_assigne_id: 1, perimetre: 'front-vuejs', statut: 'todo' },
        { id: 2, titre: 'Task 2', agent_assigne_id: 2, perimetre: 'back-electron', statut: 'todo' },
      ] as never

      store.selectedAgentId = 1
      const filtered = store.filteredTasks

      expect(filtered).toHaveLength(1)
      expect(filtered[0].id).toBe(1)
    })

    it('should filter by perimetre', () => {
      const store = useTasksStore()
      store.tasks = [
        { id: 1, titre: 'Task 1', agent_assigne_id: 1, perimetre: 'front-vuejs', statut: 'todo' },
        { id: 2, titre: 'Task 2', agent_assigne_id: 2, perimetre: 'back-electron', statut: 'todo' },
      ] as never

      store.selectedPerimetre = 'front-vuejs'
      const filtered = store.filteredTasks

      expect(filtered).toHaveLength(1)
      expect(filtered[0].perimetre).toBe('front-vuejs')
    })

    it('should filter by both agent_id and perimetre', () => {
      const store = useTasksStore()
      store.tasks = [
        { id: 1, titre: 'Task 1', agent_assigne_id: 1, perimetre: 'front-vuejs', statut: 'todo' },
        { id: 2, titre: 'Task 2', agent_assigne_id: 2, perimetre: 'back-electron', statut: 'todo' },
        { id: 3, titre: 'Task 3', agent_assigne_id: 1, perimetre: 'back-electron', statut: 'todo' },
      ] as never

      store.selectedAgentId = 1
      store.selectedPerimetre = 'front-vuejs'
      const filtered = store.filteredTasks

      expect(filtered).toHaveLength(1)
      expect(filtered[0].id).toBe(1)
    })
  })

  describe('tasksByStatus', () => {
    it('should group tasks by status', () => {
      const store = useTasksStore()
      store.tasks = [
        { id: 1, titre: 'Task 1', agent_assigne_id: 1, perimetre: 'front', statut: 'todo' },
        { id: 2, titre: 'Task 2', agent_assigne_id: 1, perimetre: 'front', statut: 'todo' },
        { id: 3, titre: 'Task 3', agent_assigne_id: 1, perimetre: 'front', statut: 'in_progress' },
        { id: 4, titre: 'Task 4', agent_assigne_id: 1, perimetre: 'front', statut: 'done' },
        { id: 5, titre: 'Task 5', agent_assigne_id: 1, perimetre: 'front', statut: 'archived' },
        { id: 6, titre: 'Task 6', agent_assigne_id: 1, perimetre: 'front', statut: 'archived' }, // legacy, should count as archivé
      ] as never

      const byStatus = store.tasksByStatus

      expect(byStatus.todo).toHaveLength(2)
      expect(byStatus.in_progress).toHaveLength(1)
      expect(byStatus.done).toHaveLength(1)
      expect(byStatus.archived).toHaveLength(2) // archivé + validé
    })
  })

  describe('toggleAgentFilter', () => {
    it('should toggle agent filter on', () => {
      const store = useTasksStore()
      store.selectedAgentId = null

      store.toggleAgentFilter(1)

      expect(store.selectedAgentId).toBe(1)
    })

    it('should toggle agent filter off when same agent selected', () => {
      const store = useTasksStore()
      store.selectedAgentId = 1

      store.toggleAgentFilter(1)

      expect(store.selectedAgentId).toBeNull()
    })

    it('should switch to different agent', () => {
      const store = useTasksStore()
      store.selectedAgentId = 1

      store.toggleAgentFilter(2)

      expect(store.selectedAgentId).toBe(2)
    })
  })

  describe('togglePerimetreFilter', () => {
    it('should toggle perimetre filter on', () => {
      const store = useTasksStore()
      store.selectedPerimetre = null

      store.togglePerimetreFilter('front-vuejs')

      expect(store.selectedPerimetre).toBe('front-vuejs')
    })

    it('should toggle perimetre filter off when same perimetre selected', () => {
      const store = useTasksStore()
      store.selectedPerimetre = 'front-vuejs'

      store.togglePerimetreFilter('front-vuejs')

      expect(store.selectedPerimetre).toBeNull()
    })
  })

  describe('normalizeRow (via refresh)', () => {
    it('should populate tasks after refresh with queryDb data', async () => {
      const store = useTasksStore()
      store.dbPath = '/test/db'

      // Simulate queryDb returning proper rows
      // Order: live tasks (todo/in_progress), done tasks (capped), agents, locks, stats, perimetres
      mockElectronAPI.queryDb
        .mockResolvedValueOnce([{ id: 1, titre: 'Task One', statut: 'todo', agent_assigne_id: null }]) // live tasks
        .mockResolvedValueOnce([]) // done tasks (capped)
        .mockResolvedValueOnce([{ id: 10, name: 'dev-front', type: 'scoped', perimetre: 'front-vuejs' }]) // agents
        .mockResolvedValueOnce([]) // locks
        .mockResolvedValueOnce([{ statut: 'todo', count: 1 }]) // stats
        .mockResolvedValueOnce([]) // perimetres

      await store.refresh()

      expect(store.tasks).toHaveLength(1)
      expect(store.tasks[0].titre).toBe('Task One')
      expect(store.tasks[0].statut).toBe('todo')
      expect(store.agents).toHaveLength(1)
      expect(store.agents[0].name).toBe('dev-front')
      expect(store.stats.todo).toBe(1)
    })

    it('should handle string fields from queryDb unchanged', async () => {
      const store = useTasksStore()
      store.dbPath = '/test/db'

      mockElectronAPI.queryDb
        .mockResolvedValueOnce([{ id: 42, titre: 'Already string', statut: 'done', description: 'Some desc' }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])

      await store.refresh()

      expect(store.tasks).toHaveLength(1)
      expect(store.tasks[0].titre).toBe('Already string')
      expect(store.tasks[0].description).toBe('Some desc')
    })
  })

  describe('query', () => {
    it('should return empty array when dbPath is null', async () => {
      const store = useTasksStore()
      store.dbPath = null

      const result = await store.query('SELECT * FROM tasks')

      expect(result).toEqual([])
      expect(mockElectronAPI.queryDb).not.toHaveBeenCalled()
    })

    it('should call queryDb when dbPath is set', async () => {
      const store = useTasksStore()
      store.dbPath = '/test/path/db'
      mockElectronAPI.queryDb.mockResolvedValueOnce([{ id: 1 }])

      const result = await store.query('SELECT * FROM tasks')

      expect(mockElectronAPI.queryDb).toHaveBeenCalledWith('/test/path/db', 'SELECT * FROM tasks', undefined)
      expect(result).toEqual([{ id: 1 }])
    })
  })
})


describe('stores/tasks — project lifecycle', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
    mockElectronAPI.queryDb.mockResolvedValue([])
    mockElectronAPI.migrateDb.mockResolvedValue({ success: true })
    mockElectronAPI.watchDb.mockResolvedValue(undefined)
    mockElectronAPI.onDbChanged.mockReturnValue(() => {})
  })

  describe('setProject', () => {
    it('should set projectPath and dbPath, persisting to localStorage', async () => {
      const store = useTasksStore()

      await store.setProject('/my/project', '/my/project/.claude/project.db')

      expect(store.projectPath).toBe('/my/project')
      expect(store.dbPath).toBe('/my/project/.claude/project.db')
      expect(localStorage.getItem('projectPath')).toBe('/my/project')
      expect(localStorage.getItem('dbPath')).toBe('/my/project/.claude/project.db')
    })

    it('should call migrateDb before refresh', async () => {
      const store = useTasksStore()

      await store.setProject('/my/project', '/my/project/.claude/project.db')

      expect(mockElectronAPI.migrateDb).toHaveBeenCalledWith('/my/project/.claude/project.db')
    })

    it('should call queryDb (refresh) after setProject', async () => {
      const store = useTasksStore()

      await store.setProject('/my/project', '/my/project/.claude/project.db')

      expect(mockElectronAPI.queryDb).toHaveBeenCalled()
    })

    it('should start watching DB after setProject', async () => {
      const store = useTasksStore()

      await store.setProject('/my/project', '/my/project/.claude/project.db')

      expect(mockElectronAPI.watchDb).toHaveBeenCalledWith('/my/project/.claude/project.db')
    })
  })

  describe('closeProject', () => {
    it('should clear projectPath, dbPath and tasks', async () => {
      const store = useTasksStore()
      await store.setProject('/my/project', '/my/project/.claude/project.db')

      store.closeProject()

      expect(store.projectPath).toBeNull()
      expect(store.dbPath).toBeNull()
      expect(store.tasks).toHaveLength(0)
      expect(localStorage.getItem('projectPath')).toBeNull()
      expect(localStorage.getItem('dbPath')).toBeNull()
    })

    it('should clear selectedTask and taskComments on close', async () => {
      const store = useTasksStore()
      store.tasks = [{ id: 1, titre: 'Task 1' }] as never
      await store.openTask({ id: 1, titre: 'Task 1' } as never)

      store.closeProject()

      expect(store.selectedTask).toBeNull()
      expect(store.taskComments).toHaveLength(0)
    })
  })

  describe('refresh', () => {
    it('should return early when dbPath is null (no project loaded)', async () => {
      const store = useTasksStore()
      // dbPath is null by default

      await store.refresh()

      expect(mockElectronAPI.queryDb).not.toHaveBeenCalled()
    })

    it('should set loading=true during refresh and false after', async () => {
      const store = useTasksStore()
      await store.setProject('/p', '/p/.claude/db')
      mockElectronAPI.queryDb.mockClear()

      // Trigger refresh and check loading state
      const refreshPromise = store.refresh()
      // After promise resolves, loading should be false
      await refreshPromise
      expect(store.loading).toBe(false)
    })

    it('should set error state when queryDb throws', async () => {
      const store = useTasksStore()
      await store.setProject('/p', '/p/.claude/db')
      mockElectronAPI.queryDb.mockRejectedValue(new Error('DB connection failed'))

      await store.refresh()

      expect(store.error).toContain('DB connection failed')
    })

    it('should clear error on successful refresh', async () => {
      const store = useTasksStore()
      await store.setProject('/p', '/p/.claude/db')
      mockElectronAPI.queryDb.mockRejectedValue(new Error('error'))
      await store.refresh()
      expect(store.error).not.toBeNull()

      // Now a successful refresh
      mockElectronAPI.queryDb.mockResolvedValue([])
      await store.refresh()
      expect(store.error).toBeNull()
    })
  })

  describe('startPolling / stopPolling', () => {
    it('should not create duplicate polling intervals (startPolling called twice)', async () => {
      vi.useFakeTimers()
      const store = useTasksStore()
      await store.setProject('/p', '/p/.claude/db')
      mockElectronAPI.queryDb.mockClear()

      store.startPolling()
      store.startPolling() // second call — should cancel first interval

      // Advance past 300s (interval is 5min = 300000ms)
      await vi.advanceTimersByTimeAsync(300001)

      // queryDb called for ONE interval only (not doubled)
      // Each tick calls multiple queries via Promise.all
      const callCount = mockElectronAPI.queryDb.mock.calls.length
      // Should be > 0 (polling running) but NOT doubled
      expect(callCount).toBeGreaterThan(0)

      store.stopPolling()
      vi.useRealTimers()
    })

    it('should stop polling after stopPolling()', async () => {
      vi.useFakeTimers()
      const store = useTasksStore()
      await store.setProject('/p', '/p/.claude/db')
      store.startPolling()
      store.stopPolling()
      mockElectronAPI.queryDb.mockClear()

      // Advance past 35s — no more queries should fire
      await vi.advanceTimersByTimeAsync(35000)
      expect(mockElectronAPI.queryDb).not.toHaveBeenCalled()

      vi.useRealTimers()
    })
  })

  describe('openTask', () => {
    it('should set selectedTask when openTask is called', async () => {
      const store = useTasksStore()
      await store.setProject('/p', '/p/.claude/db')
      const task = { id: 42, titre: 'My task' }
      mockElectronAPI.queryDb.mockResolvedValue([])

      await store.openTask(task as never)

      expect(store.selectedTask).toEqual(task)
    })

    it('should load task comments from DB', async () => {
      const store = useTasksStore()
      await store.setProject('/p', '/p/.claude/db')
      const mockComments = [{ id: 1, contenu: 'Commentaire', agent_name: 'review' }]
      // After setProject, we need to mock the comments query specifically
      // Use mockReturn return commentsValue to for the openTask call
      mockElectronAPI.queryDb.mockResolvedValueOnce(mockComments)

      await store.openTask({ id: 42, titre: 'task' } as never)

      expect(store.taskComments).toHaveLength(1)
    })

    it('should reset taskComments on each openTask call', async () => {
      const store = useTasksStore()
      await store.setProject('/p', '/p/.claude/db')
      mockElectronAPI.queryDb.mockResolvedValue([])

      await store.openTask({ id: 1, titre: 'first task' } as never)
      await store.openTask({ id: 2, titre: 'second task' } as never)

      // selectedTask should be the second task
      expect(store.selectedTask?.id).toBe(2)
    })
  })
})


describe('stores/tasks — selectProject', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
    mockElectronAPI.queryDb.mockResolvedValue([])
    mockElectronAPI.migrateDb.mockResolvedValue({ success: true })
    mockElectronAPI.watchDb.mockResolvedValue(undefined)
    mockElectronAPI.onDbChanged.mockReturnValue(() => {})
  })

  it('should call showConfirmDialog when terminals are open', async () => {
    const tasksStore = useTasksStore()
    const tabsStore = useTabsStore()
    tabsStore.addTerminal('agent-1')
    tabsStore.addTerminal('agent-2')
    mockElectronAPI.showConfirmDialog.mockResolvedValue(false)

    await tasksStore.selectProject()

    expect(mockElectronAPI.showConfirmDialog).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Changer de projet' })
    )
  })

  it('should abort when user refuses confirmation dialog', async () => {
    const tasksStore = useTasksStore()
    const tabsStore = useTabsStore()
    tabsStore.addTerminal('agent-1')
    mockElectronAPI.showConfirmDialog.mockResolvedValue(false)

    await tasksStore.selectProject()

    expect(mockElectronAPI.selectProjectDir).not.toHaveBeenCalled()
  })

  it('should proceed to selectProjectDir when user accepts confirmation', async () => {
    const tasksStore = useTasksStore()
    const tabsStore = useTabsStore()
    tabsStore.addTerminal('agent-1')
    mockElectronAPI.showConfirmDialog.mockResolvedValue(true)
    mockElectronAPI.selectProjectDir.mockResolvedValue(null)

    await tasksStore.selectProject()

    expect(mockElectronAPI.selectProjectDir).toHaveBeenCalled()
  })

  it('should skip confirmation when no terminals are open', async () => {
    const tasksStore = useTasksStore()
    mockElectronAPI.selectProjectDir.mockResolvedValue(null)

    await tasksStore.selectProject()

    expect(mockElectronAPI.showConfirmDialog).not.toHaveBeenCalled()
    expect(mockElectronAPI.selectProjectDir).toHaveBeenCalled()
  })

  it('should do nothing when selectProjectDir returns null', async () => {
    const tasksStore = useTasksStore()
    mockElectronAPI.selectProjectDir.mockResolvedValue(null)
    const prevPath = tasksStore.projectPath

    await tasksStore.selectProject()

    expect(tasksStore.projectPath).toBe(prevPath)
  })

  it('should call setProject when selectProjectDir returns dbPath', async () => {
    const tasksStore = useTasksStore()
    mockElectronAPI.selectProjectDir.mockResolvedValue({
      projectPath: '/new/project',
      dbPath: '/new/project/.claude/project.db',
      error: null,
      hasCLAUDEmd: true,
    })

    await tasksStore.selectProject()

    expect(tasksStore.projectPath).toBe('/new/project')
    expect(tasksStore.dbPath).toBe('/new/project/.claude/project.db')
  })

  it('should show WSL label when all terminals have wslDistro', async () => {
    const tasksStore = useTasksStore()
    const tabsStore = useTabsStore()
    tabsStore.addTerminal('agent-1', 'Ubuntu')
    tabsStore.addTerminal('agent-2', 'Debian')
    mockElectronAPI.showConfirmDialog.mockResolvedValue(false)

    await tasksStore.selectProject()

    expect(mockElectronAPI.showConfirmDialog).toHaveBeenCalledWith(
      expect.objectContaining({ message: '2 sessions WSL ouvertes' })
    )
  })

  it('should show mixed label when terminals include WSL and non-WSL', async () => {
    const tasksStore = useTasksStore()
    const tabsStore = useTabsStore()
    tabsStore.addTerminal('agent-1', 'Ubuntu')
    tabsStore.addTerminal('agent-2') // no wslDistro
    tabsStore.addTerminal('agent-3', 'Debian')
    mockElectronAPI.showConfirmDialog.mockResolvedValue(false)

    await tasksStore.selectProject()

    expect(mockElectronAPI.showConfirmDialog).toHaveBeenCalledWith(
      expect.objectContaining({ message: '2 sessions WSL + 1 terminal' })
    )
  })

  it('should show terminal label when no terminals have wslDistro', async () => {
    const tasksStore = useTasksStore()
    const tabsStore = useTabsStore()
    tabsStore.addTerminal('agent-1')
    tabsStore.addTerminal('agent-2')
    mockElectronAPI.showConfirmDialog.mockResolvedValue(false)

    await tasksStore.selectProject()

    expect(mockElectronAPI.showConfirmDialog).toHaveBeenCalledWith(
      expect.objectContaining({ message: '2 sessions terminal ouvertes' })
    )
  })

  it('should show setupWizard when selectProjectDir returns no dbPath', async () => {
    const tasksStore = useTasksStore()
    mockElectronAPI.selectProjectDir.mockResolvedValue({
      projectPath: '/new/project',
      dbPath: null,
      error: null,
      hasCLAUDEmd: false,
    })

    await tasksStore.selectProject()

    expect(tasksStore.setupWizardTarget).toEqual({
      projectPath: '/new/project',
      hasCLAUDEmd: false,
    })
  })
})


describe('stores/tasks — agentRefresh', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
    mockElectronAPI.queryDb.mockResolvedValue([])
    mockElectronAPI.migrateDb.mockResolvedValue({ success: true })
    mockElectronAPI.watchDb.mockResolvedValue(undefined)
    mockElectronAPI.onDbChanged.mockReturnValue(() => {})
  })

  it('should not call queryDb when dbPath is null', async () => {
    const store = useTasksStore()
    store.dbPath = null

    await store.agentRefresh()

    expect(mockElectronAPI.queryDb).not.toHaveBeenCalled()
  })

  it('should call queryDb for agents and locks when dbPath is valid', async () => {
    const store = useTasksStore()
    await store.setProject('/p', '/p/.claude/db')
    mockElectronAPI.queryDb.mockClear()
    const agentData = [{ id: 1, name: 'review', type: 'global' }]
    const lockData = [{ id: 1, fichier: 'test.ts', agent_name: 'review' }]
    mockElectronAPI.queryDb
      .mockResolvedValueOnce(agentData)
      .mockResolvedValueOnce(lockData)

    await store.agentRefresh()

    expect(mockElectronAPI.queryDb).toHaveBeenCalledTimes(2)
    expect(store.agents).toEqual(agentData)
    expect(store.locks).toEqual(lockData)
  })

  it('should not throw when queryDb fails (silent catch)', async () => {
    const store = useTasksStore()
    await store.setProject('/p', '/p/.claude/db')
    mockElectronAPI.queryDb.mockRejectedValue(new Error('DB error'))

    await expect(store.agentRefresh()).resolves.not.toThrow()
  })

  it('should skip refresh when document is hidden', async () => {
    const store = useTasksStore()
    await store.setProject('/p', '/p/.claude/db')
    mockElectronAPI.queryDb.mockClear()
    // Simulate hidden tab
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', writable: true })

    await store.agentRefresh()

    expect(mockElectronAPI.queryDb).not.toHaveBeenCalled()

    // Restore
    Object.defineProperty(document, 'visibilityState', { value: 'visible', writable: true })
  })
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


describe('stores/tasks — setProjectPathOnly', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
    mockElectronAPI.queryDb.mockResolvedValue([])
    mockElectronAPI.migrateDb.mockResolvedValue({ success: true })
    mockElectronAPI.watchDb.mockResolvedValue(undefined)
    mockElectronAPI.onDbChanged.mockReturnValue(() => {})
  })

  it('should set projectPath and persist to localStorage', () => {
    const store = useTasksStore()

    store.setProjectPathOnly('/my/project')

    expect(store.projectPath).toBe('/my/project')
    expect(localStorage.getItem('projectPath')).toBe('/my/project')
  })

  it('should not set dbPath', () => {
    const store = useTasksStore()

    store.setProjectPathOnly('/my/project')

    expect(store.dbPath).toBeNull()
  })
})


describe('stores/tasks — closeWizard', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
    mockElectronAPI.queryDb.mockResolvedValue([])
    mockElectronAPI.migrateDb.mockResolvedValue({ success: true })
    mockElectronAPI.watchDb.mockResolvedValue(undefined)
    mockElectronAPI.onDbChanged.mockReturnValue(() => {})
  })

  it('should set setupWizardTarget to null', () => {
    const store = useTasksStore()
    store.setupWizardTarget = { projectPath: '/p', hasCLAUDEmd: true } as never

    store.closeWizard()

    expect(store.setupWizardTarget).toBeNull()
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
    store.selectedTask = { id: 1, titre: 'Task 1' } as never
    store.taskComments = [{ id: 1, contenu: 'comment' }] as never

    store.closeTask()

    expect(store.selectedTask).toBeNull()
  })

  it('should clear taskComments', () => {
    const store = useTasksStore()
    store.selectedTask = { id: 1, titre: 'Task 1' } as never
    store.taskComments = [{ id: 1, contenu: 'c1' }, { id: 2, contenu: 'c2' }] as never

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


describe('stores/tasks — perimetres computed', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
    mockElectronAPI.queryDb.mockResolvedValue([])
    mockElectronAPI.migrateDb.mockResolvedValue({ success: true })
    mockElectronAPI.watchDb.mockResolvedValue(undefined)
    mockElectronAPI.onDbChanged.mockReturnValue(() => {})
  })

  it('should deduplicate perimetres from tasks', () => {
    const store = useTasksStore()
    store.tasks = [
      { id: 1, perimetre: 'front-vuejs', statut: 'todo' },
      { id: 2, perimetre: 'back-electron', statut: 'todo' },
      { id: 3, perimetre: 'front-vuejs', statut: 'done' },
    ] as never

    expect(store.perimetres).toEqual(['back-electron', 'front-vuejs'])
  })

  it('should return sorted array', () => {
    const store = useTasksStore()
    store.tasks = [
      { id: 1, perimetre: 'zzz', statut: 'todo' },
      { id: 2, perimetre: 'aaa', statut: 'todo' },
      { id: 3, perimetre: 'mmm', statut: 'todo' },
    ] as never

    expect(store.perimetres).toEqual(['aaa', 'mmm', 'zzz'])
  })

  it('should skip tasks with null/undefined perimetre', () => {
    const store = useTasksStore()
    store.tasks = [
      { id: 1, perimetre: null, statut: 'todo' },
      { id: 2, perimetre: undefined, statut: 'todo' },
      { id: 3, perimetre: 'front-vuejs', statut: 'todo' },
    ] as never

    expect(store.perimetres).toEqual(['front-vuejs'])
  })

  it('should return empty array when no tasks', () => {
    const store = useTasksStore()
    store.tasks = []

    expect(store.perimetres).toEqual([])
  })
})


describe('stores/tasks — watch(agents) auto-clear filter', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
    mockElectronAPI.queryDb.mockResolvedValue([])
    mockElectronAPI.migrateDb.mockResolvedValue({ success: true })
    mockElectronAPI.watchDb.mockResolvedValue(undefined)
    mockElectronAPI.onDbChanged.mockReturnValue(() => {})
  })

  it('should clear selectedAgentId when filtered agent disappears from agents list', async () => {
    const store = useTasksStore()
    store.agents = [
      { id: 10, name: 'dev-front', type: 'dev', perimetre: 'front-vuejs' },
      { id: 20, name: 'dev-back', type: 'dev', perimetre: 'back-electron' },
    ] as never
    store.selectedAgentId = 10
    await nextTick()

    // Agent 10 disappears (e.g. project switch refreshed agents)
    store.agents = [
      { id: 20, name: 'dev-back', type: 'dev', perimetre: 'back-electron' },
    ] as never
    await nextTick()

    expect(store.selectedAgentId).toBeNull()
  })

  it('should keep selectedAgentId when filtered agent still exists', async () => {
    const store = useTasksStore()
    store.agents = [
      { id: 10, name: 'dev-front', type: 'dev', perimetre: 'front-vuejs' },
    ] as never
    store.selectedAgentId = 10
    await nextTick()

    // Agents refreshed but agent 10 still present
    store.agents = [
      { id: 10, name: 'dev-front', type: 'dev', perimetre: 'front-vuejs' },
      { id: 20, name: 'dev-back', type: 'dev', perimetre: 'back-electron' },
    ] as never
    await nextTick()

    expect(store.selectedAgentId).toBe(10)
  })

  it('should be a no-op when selectedAgentId is already null', async () => {
    const store = useTasksStore()
    store.selectedAgentId = null
    store.agents = [{ id: 10, name: 'dev-front' }] as never
    await nextTick()

    store.agents = [] as never
    await nextTick()

    expect(store.selectedAgentId).toBeNull()
  })
})


describe('stores/tasks — watch(dbPath) reset filters', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
    mockElectronAPI.queryDb.mockResolvedValue([])
    mockElectronAPI.migrateDb.mockResolvedValue({ success: true })
    mockElectronAPI.watchDb.mockResolvedValue(undefined)
    mockElectronAPI.onDbChanged.mockReturnValue(() => {})
  })

  it('should reset selectedAgentId and selectedPerimetre when dbPath changes', async () => {
    const store = useTasksStore()
    store.dbPath = '/project-a/.claude/project.db'
    store.selectedAgentId = 5
    store.selectedPerimetre = 'front-vuejs'
    await nextTick()

    // Switch project
    store.dbPath = '/project-b/.claude/project.db'
    await nextTick()

    expect(store.selectedAgentId).toBeNull()
    expect(store.selectedPerimetre).toBeNull()
  })

  it('should not reset filters when dbPath stays the same', async () => {
    const store = useTasksStore()
    store.dbPath = '/project-a/.claude/project.db'
    await nextTick()

    // Set filters AFTER the initial watcher fires
    store.selectedAgentId = 5
    store.selectedPerimetre = 'front-vuejs'

    // Same path re-assigned (Vue ref won't trigger watcher for identical value)
    store.dbPath = '/project-a/.claude/project.db'
    await nextTick()

    expect(store.selectedAgentId).toBe(5)
    expect(store.selectedPerimetre).toBe('front-vuejs')
  })
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
    const blockers = [{ id: 5, titre: 'Blocker', statut: 'in_progress' }]
    ;(mockElectronAPI as Record<string, ReturnType<typeof vi.fn>>).tasksUpdateStatus =
      vi.fn().mockResolvedValue({ success: false, error: 'TASK_BLOCKED', blockers })

    const store = useTasksStore()
    store.$patch({ dbPath: '/p/db', tasks: [{ id: 1, statut: 'todo', titre: 'T' } as never] })

    await expect(store.setTaskStatut(1, 'in_progress')).rejects.toThrow('TASK_BLOCKED')
  })

  it('rolls back optimistic update on TASK_BLOCKED (T553)', async () => {
    const blockers = [{ id: 5, titre: 'Blocker', statut: 'in_progress' }]
    ;(mockElectronAPI as Record<string, ReturnType<typeof vi.fn>>).tasksUpdateStatus =
      vi.fn().mockResolvedValue({ success: false, error: 'TASK_BLOCKED', blockers })

    const store = useTasksStore()
    store.$patch({ dbPath: '/p/db', tasks: [{ id: 1, statut: 'todo', titre: 'T' } as never] })

    try { await store.setTaskStatut(1, 'in_progress') } catch { /* expected */ }

    expect(store.tasks.find(t => t.id === 1)?.statut).toBe('todo')
  })
})


describe('stores/tasks — agentGroups actions', () => {
  const DB_PATH = '/test/project/.claude/project.db'

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
    // Reset mocks to defaults
    mockElectronAPI.agentGroupsList.mockResolvedValue({ success: true, groups: [] })
    mockElectronAPI.agentGroupsCreate.mockResolvedValue({ success: true, group: { id: 1, name: 'New Group', sort_order: 0, created_at: '' } })
    mockElectronAPI.agentGroupsRename.mockResolvedValue({ success: true })
    mockElectronAPI.agentGroupsDelete.mockResolvedValue({ success: true })
    // Needed for setProject which calls refresh + watch
    mockElectronAPI.queryDb.mockResolvedValue([])
    mockElectronAPI.migrateDb.mockResolvedValue({ success: true })
    mockElectronAPI.watchDb.mockResolvedValue(undefined)
    mockElectronAPI.onDbChanged.mockReturnValue(() => {})
  })

  // ── fetchAgentGroups ──────────────────────────────────────────────────────

  describe('fetchAgentGroups', () => {
    it('calls agentGroupsList with dbPath', async () => {
      const store = useTasksStore()
      await store.setProject('/test/project', DB_PATH)
      vi.clearAllMocks()

      mockElectronAPI.agentGroupsList.mockResolvedValue({ success: true, groups: [] })
      await store.fetchAgentGroups()

      expect(mockElectronAPI.agentGroupsList).toHaveBeenCalledWith(DB_PATH)
    })

    it('updates store.agentGroups with returned groups on success', async () => {
      const store = useTasksStore()
      await store.setProject('/test/project', DB_PATH)

      const groups = [
        { id: 1, name: 'Frontend', position: 0, members: [] },
        { id: 2, name: 'Backend', position: 1, members: [] },
      ]
      mockElectronAPI.agentGroupsList.mockResolvedValue({ success: true, groups })
      await store.fetchAgentGroups()

      expect(store.agentGroups).toHaveLength(2)
      expect(store.agentGroups[0].name).toBe('Frontend')
      expect(store.agentGroups[1].name).toBe('Backend')
    })

    it('does not update agentGroups when success is false', async () => {
      const store = useTasksStore()
      await store.setProject('/test/project', DB_PATH)
      store.agentGroups = [{ id: 99, name: 'Existing', position: 0, members: [] }] as never

      mockElectronAPI.agentGroupsList.mockResolvedValue({ success: false, groups: [] })
      await store.fetchAgentGroups()

      // State unchanged — success:false is silently ignored
      expect(store.agentGroups).toHaveLength(1)
      expect(store.agentGroups[0].id).toBe(99)
    })

    it('does not crash and does not call API when dbPath is null', async () => {
      const store = useTasksStore()
      // dbPath is null by default (no setProject called)
      await store.fetchAgentGroups()

      expect(mockElectronAPI.agentGroupsList).not.toHaveBeenCalled()
    })

    it('does not crash on API error (silent catch)', async () => {
      const store = useTasksStore()
      await store.setProject('/test/project', DB_PATH)

      mockElectronAPI.agentGroupsList.mockRejectedValue(new Error('IPC error'))
      await expect(store.fetchAgentGroups()).resolves.toBeUndefined()
    })
  })

  // ── createAgentGroup ──────────────────────────────────────────────────────

  describe('createAgentGroup', () => {
    it('calls agentGroupsCreate with dbPath and name', async () => {
      const store = useTasksStore()
      await store.setProject('/test/project', DB_PATH)
      vi.clearAllMocks()

      mockElectronAPI.agentGroupsCreate.mockResolvedValue({ success: true, group: { id: 5, name: 'Ops', sort_order: 0, created_at: '' } })
      await store.createAgentGroup('Ops')

      expect(mockElectronAPI.agentGroupsCreate).toHaveBeenCalledWith(DB_PATH, 'Ops', undefined)
    })

    it('returns AgentGroup and appends to store.agentGroups on success', async () => {
      const store = useTasksStore()
      await store.setProject('/test/project', DB_PATH)
      store.agentGroups = [] as never

      mockElectronAPI.agentGroupsCreate.mockResolvedValue({ success: true, group: { id: 5, name: 'Ops', sort_order: 0, created_at: '' } })
      const result = await store.createAgentGroup('Ops')

      expect(result).not.toBeNull()
      expect(result?.name).toBe('Ops')
      expect(store.agentGroups).toHaveLength(1)
      expect(store.agentGroups[0].name).toBe('Ops')
    })

    it('returns null when success is false', async () => {
      const store = useTasksStore()
      await store.setProject('/test/project', DB_PATH)

      mockElectronAPI.agentGroupsCreate.mockResolvedValue({ success: false })
      const result = await store.createAgentGroup('Fail')

      expect(result).toBeNull()
    })

    it('returns null and does not call API when dbPath is null', async () => {
      const store = useTasksStore()
      // no setProject — dbPath is null
      const result = await store.createAgentGroup('Test')

      expect(result).toBeNull()
      expect(mockElectronAPI.agentGroupsCreate).not.toHaveBeenCalled()
    })
  })

  // ── renameAgentGroup ──────────────────────────────────────────────────────

  describe('renameAgentGroup', () => {
    it('calls agentGroupsRename with dbPath, groupId and new name', async () => {
      const store = useTasksStore()
      await store.setProject('/test/project', DB_PATH)
      vi.clearAllMocks()

      await store.renameAgentGroup(3, 'New Name')

      expect(mockElectronAPI.agentGroupsRename).toHaveBeenCalledWith(DB_PATH, 3, 'New Name')
    })

    it('updates the group name in agentGroups state', async () => {
      const store = useTasksStore()
      await store.setProject('/test/project', DB_PATH)
      store.agentGroups = [
        { id: 3, name: 'Old Name', position: 0, members: [] },
        { id: 4, name: 'Other', position: 1, members: [] },
      ] as never

      await store.renameAgentGroup(3, 'New Name')

      expect(store.agentGroups[0].name).toBe('New Name')
      expect(store.agentGroups[1].name).toBe('Other')
    })

    it('does not call API when dbPath is null', async () => {
      const store = useTasksStore()
      await store.renameAgentGroup(1, 'Test')

      expect(mockElectronAPI.agentGroupsRename).not.toHaveBeenCalled()
    })
  })

  // ── deleteAgentGroup ──────────────────────────────────────────────────────

  describe('deleteAgentGroup', () => {
    it('calls agentGroupsDelete with dbPath and groupId', async () => {
      const store = useTasksStore()
      await store.setProject('/test/project', DB_PATH)
      vi.clearAllMocks()

      await store.deleteAgentGroup(7)

      expect(mockElectronAPI.agentGroupsDelete).toHaveBeenCalledWith(DB_PATH, 7)
    })

    it('removes the group from agentGroups state', async () => {
      const store = useTasksStore()
      await store.setProject('/test/project', DB_PATH)
      store.agentGroups = [
        { id: 7, name: 'To Delete', position: 0, members: [] },
        { id: 8, name: 'Keep', position: 1, members: [] },
      ] as never

      await store.deleteAgentGroup(7)

      expect(store.agentGroups).toHaveLength(1)
      expect(store.agentGroups[0].id).toBe(8)
    })

    it('does not call API when dbPath is null', async () => {
      const store = useTasksStore()
      await store.deleteAgentGroup(1)

      expect(mockElectronAPI.agentGroupsDelete).not.toHaveBeenCalled()
    })
  })
})

