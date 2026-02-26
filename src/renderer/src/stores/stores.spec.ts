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
      mockElectronAPI.queryDb
        .mockResolvedValueOnce([{ id: 1, titre: 'Task One', statut: 'todo', agent_assigne_id: null }]) // tasks
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

describe('stores/tabs', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  describe('addTerminal', () => {
    it('should add a new terminal tab', () => {
      const store = useTabsStore()
      const initialCount = store.tabs.filter(t => t.type === 'terminal').length

      store.addTerminal('test-agent')

      expect(store.tabs.filter(t => t.type === 'terminal')).toHaveLength(initialCount + 1)
      expect(store.activeTabId).toContain('term-')
    })

    it('should set the new terminal as active', () => {
      const store = useTabsStore()
      store.addTerminal('test-agent')

      expect(store.activeTabId).toContain('term-')
    })
  })

  describe('closeTab', () => {
    it('should remove a non-permanent tab', () => {
      const store = useTabsStore()
      store.addTerminal('test-agent')
      const tabId = store.tabs.find(t => t.type === 'terminal')!.id

      store.closeTab(tabId)

      expect(store.tabs.find(t => t.id === tabId)).toBeUndefined()
    })

    it('should not remove permanent tabs', () => {
      const store = useTabsStore()
      const backlogId = store.tabs[0].id

      store.closeTab(backlogId)

      expect(store.tabs.find(t => t.id === backlogId)).toBeDefined()
    })

    it('should switch to previous tab when closing active', () => {
      const store = useTabsStore()
      store.addTerminal('agent1')
      store.addTerminal('agent2')
      const firstTabId = store.tabs[1].id // First terminal
      store.setActive(firstTabId)
      const secondTabId = store.tabs[2].id // Second terminal

      store.closeTab(secondTabId)

      expect(store.activeTabId).toBe(firstTabId)
    })
  })

  describe('setActive', () => {
    it('should change active tab', () => {
      const store = useTabsStore()
      store.addTerminal('agent1')
      const tabId = store.tabs.find(t => t.type === 'terminal')!.id

      store.setActive(tabId)

      expect(store.activeTabId).toBe(tabId)
    })
  })

  describe('markTabActive', () => {
    it('should set tab as active', () => {
      const store = useTabsStore()
      const tabId = 'test-tab'

      store.markTabActive(tabId)

      expect(store.tabActivity[tabId]).toBe(true)
    })

    it('should clear previous timeout', () => {
      const store = useTabsStore()
      const tabId = 'test-tab'

      store.markTabActive(tabId)
      store.markTabActive(tabId)

      // Should not throw - indicates timeout was cleared
      expect(store.tabActivity[tabId]).toBe(true)
    })

    it('should set tab inactive after timeout', async () => {
      const store = useTabsStore()
      const tabId = 'test-tab'
      vi.useFakeTimers()

      store.markTabActive(tabId)

      expect(store.tabActivity[tabId]).toBe(true)

      vi.advanceTimersByTime(5000)

      expect(store.tabActivity[tabId]).toBe(false)

      vi.useRealTimers()
    })
  })

  describe('hasAgentTerminal', () => {
    it('should return true when agent has terminal', () => {
      const store = useTabsStore()
      store.addTerminal('test-agent')

      expect(store.hasAgentTerminal('test-agent')).toBe(true)
    })

    it('should return false when agent has no terminal', () => {
      const store = useTabsStore()

      expect(store.hasAgentTerminal('nonexistent')).toBe(false)
    })
  })

  describe('isAgentActive', () => {
    it('should return true when agent terminal is active', () => {
      const store = useTabsStore()
      store.addTerminal('test-agent')
      const tab = store.tabs.find(t => t.agentName === 'test-agent')!

      store.markTabActive(tab.id)

      expect(store.isAgentActive('test-agent')).toBe(true)
    })

    it('should return false when agent terminal is not active', () => {
      const store = useTabsStore()
      store.addTerminal('test-agent')

      expect(store.isAgentActive('test-agent')).toBe(false)
    })
  })
})

describe('stores/settings', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
    // Reset document class
    document.documentElement.className = ''
  })

  describe('setTheme', () => {
    it('should set theme to dark', () => {
      const store = useSettingsStore()

      store.setTheme('dark')

      expect(store.theme).toBe('dark')
      expect(localStorage.getItem('theme')).toBe('dark')
      expect(document.documentElement.classList.contains('dark')).toBe(true)
    })

    it('should set theme to light', () => {
      const store = useSettingsStore()

      store.setTheme('light')

      expect(store.theme).toBe('light')
      expect(localStorage.getItem('theme')).toBe('light')
      expect(document.documentElement.classList.contains('dark')).toBe(false)
    })
  })

  describe('applyTheme', () => {
    it('should add dark class for dark theme', () => {
      const store = useSettingsStore()

      store.applyTheme('dark')

      expect(document.documentElement.classList.contains('dark')).toBe(true)
    })

    it('should remove dark class for light theme', () => {
      document.documentElement.classList.add('dark')
      const store = useSettingsStore()

      store.applyTheme('light')

      expect(document.documentElement.classList.contains('dark')).toBe(false)
    })
  })

  describe('setLanguage', () => {
    it('should set language to fr', () => {
      const store = useSettingsStore()

      store.setLanguage('fr')

      expect(store.language).toBe('fr')
      expect(localStorage.getItem('language')).toBe('fr')
    })

    it('should set language to en', () => {
      const store = useSettingsStore()

      store.setLanguage('en')

      expect(store.language).toBe('en')
      expect(localStorage.getItem('language')).toBe('en')
    })
  })

  describe('setGitHubRepo', () => {
    it('should parse owner and repo from HTTPS URL', () => {
      const store = useSettingsStore()

      store.setGitHubRepo('https://github.com/owner/repo')

      expect(store.github.owner).toBe('owner')
      expect(store.github.repo).toBe('repo')
      expect(store.github.repoUrl).toBe('https://github.com/owner/repo')
    })

    it('should parse owner and repo from SSH URL', () => {
      const store = useSettingsStore()

      store.setGitHubRepo('git@github.com:owner/repo.git')

      expect(store.github.owner).toBe('owner')
      expect(store.github.repo).toBe('repo')
    })

    it('should remove .git suffix', () => {
      const store = useSettingsStore()

      store.setGitHubRepo('https://github.com/owner/repo.git')

      expect(store.github.repo).toBe('repo')
    })

    it('should handle invalid URL gracefully', () => {
      const store = useSettingsStore()

      store.setGitHubRepo('invalid-url')

      expect(store.github.owner).toBe('')
      expect(store.github.repo).toBe('')
    })
  })

  describe('setGitHubToken', () => {
    it('should set the token and persist to localStorage', () => {
      const store = useSettingsStore()

      store.setGitHubToken('ghp_mytoken123')

      expect(store.github.token).toBe('ghp_mytoken123')
      expect(localStorage.getItem('github_token')).toBe('ghp_mytoken123')
    })

    it('should allow clearing the token with empty string', () => {
      const store = useSettingsStore()
      store.setGitHubToken('ghp_existing')
      store.setGitHubToken('')

      expect(store.github.token).toBe('')
      expect(localStorage.getItem('github_token')).toBe('')
    })
  })

  describe('setGitHubConnected', () => {
    it('should set connected to true and update lastCheck', () => {
      const store = useSettingsStore()
      store.setGitHubConnected(true)

      expect(store.github.connected).toBe(true)
      expect(store.github.lastCheck).not.toBeNull()
    })

    it('should set connected to false without updating lastCheck', () => {
      const store = useSettingsStore()
      store.setGitHubConnected(true)
      const lastCheck = store.github.lastCheck

      store.setGitHubConnected(false)

      expect(store.github.connected).toBe(false)
      // lastCheck should not change when disconnecting
      expect(store.github.lastCheck).toBe(lastCheck)
    })
  })

  describe('setClaudeMdInfo', () => {
    it('should update claudeMdInfo fields partially', () => {
      const store = useSettingsStore()

      store.setClaudeMdInfo({ sha: 'abc123', hasUpdate: true })

      expect(store.claudeMdInfo.sha).toBe('abc123')
      expect(store.claudeMdInfo.hasUpdate).toBe(true)
    })

    it('should not crash with empty object', () => {
      const store = useSettingsStore()
      expect(() => store.setClaudeMdInfo({})).not.toThrow()
    })

    it('should merge partial updates without losing existing fields', () => {
      const store = useSettingsStore()
      store.setClaudeMdInfo({ sha: 'abc', hasUpdate: false })
      store.setClaudeMdInfo({ hasUpdate: true })

      // sha should be preserved, hasUpdate updated
      expect(store.claudeMdInfo.sha).toBe('abc')
      expect(store.claudeMdInfo.hasUpdate).toBe(true)
    })
  })
})

// ── Extended tests: stores/tasks (project lifecycle, polling, openTask) ────────

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

// ── Extended tests: stores/tabs — missing actions ─────────────────────────────

describe('stores/tabs — missing actions', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  describe('addExplorer', () => {
    it('should add an explorer tab and activate it', () => {
      const store = useTabsStore()

      store.addExplorer()

      const explorerTab = store.tabs.find(t => t.type === 'explorer')
      expect(explorerTab).toBeDefined()
      expect(explorerTab?.id).toBe('explorer')
      expect(store.activeTabId).toBe('explorer')
    })

    it('should NOT add duplicate explorer tab (reuse existing)', () => {
      const store = useTabsStore()
      store.addExplorer()
      const tabCountAfterFirst = store.tabs.length

      store.addExplorer() // second call

      expect(store.tabs.length).toBe(tabCountAfterFirst)
      expect(store.tabs.filter(t => t.type === 'explorer')).toHaveLength(1)
    })
  })

  describe('openFile', () => {
    it('should add a file tab and activate it', () => {
      const store = useTabsStore()

      store.openFile('/path/to/file.ts', 'file.ts')

      const fileTab = store.tabs.find(t => t.type === 'file')
      expect(fileTab).toBeDefined()
      expect(fileTab?.title).toBe('file.ts')
      expect(store.activeTabId).toBe(fileTab?.id)
    })

    it('should NOT add duplicate for same filePath (reuse existing)', () => {
      const store = useTabsStore()
      store.openFile('/path/file.ts', 'file.ts')
      const tabCountAfterFirst = store.tabs.length

      store.openFile('/path/file.ts', 'file.ts') // same path

      expect(store.tabs.filter(t => t.type === 'file')).toHaveLength(1)
      expect(store.tabs.length).toBe(tabCountAfterFirst)
    })

    it('should add separate tabs for different file paths', () => {
      const store = useTabsStore()
      store.openFile('/path/file1.ts', 'file1.ts')
      store.openFile('/path/file2.ts', 'file2.ts')

      expect(store.tabs.filter(t => t.type === 'file')).toHaveLength(2)
    })
  })

  describe('closeAllTerminals', () => {
    it('should remove all terminal tabs but keep others', () => {
      const store = useTabsStore()
      store.addTerminal('agent-1')
      store.addTerminal('agent-2')
      store.addExplorer()

      store.closeAllTerminals()

      expect(store.tabs.filter(t => t.type === 'terminal')).toHaveLength(0)
      expect(store.tabs.find(t => t.type === 'explorer')).toBeDefined()
    })

    it('should call terminalKill for each terminal with a ptyId', () => {
      const store = useTabsStore()
      store.addTerminal('agent-1')
      // Set a ptyId on the terminal tab
      const termTab = store.tabs.find(t => t.type === 'terminal')
      if (termTab) store.setPtyId(termTab.id, 'pty-123')

      store.closeAllTerminals()

      expect(mockElectronAPI.terminalKill).toHaveBeenCalledWith('pty-123')
    })

    it('should reset activeTabId to backlog after closing active terminal', () => {
      const store = useTabsStore()
      store.addTerminal('agent-x')
      // Active tab is now the terminal

      store.closeAllTerminals()

      expect(store.activeTabId).toBe('backlog')
    })
  })

  describe('renameTab', () => {
    it('should rename an existing tab', () => {
      const store = useTabsStore()
      store.addTerminal('old-name')
      const termTab = store.tabs.find(t => t.type === 'terminal')!

      store.renameTab(termTab.id, 'new-name')

      expect(termTab.title).toBe('new-name')
    })

    it('should not rename with empty or whitespace-only name', () => {
      const store = useTabsStore()
      store.addTerminal('original')
      const termTab = store.tabs.find(t => t.type === 'terminal')!

      store.renameTab(termTab.id, '   ')

      expect(termTab.title).toBe('original')
    })

    it('should be a no-op for non-existent tab id', () => {
      const store = useTabsStore()
      expect(() => store.renameTab('nonexistent-id', 'new name')).not.toThrow()
    })
  })

  describe('reorderTab', () => {
    it('should handle valid from and to IDs without throwing', () => {
      const store = useTabsStore()
      store.addTerminal('agent-A')
      store.addTerminal('agent-B')

      const termTabs = store.tabs.filter(t => t.type === 'terminal')
      // Should not throw with valid IDs
      expect(() => store.reorderTab(termTabs[0].id, termTabs[1].id)).not.toThrow()
    })

    it('should be a no-op when fromId does not exist', () => {
      const store = useTabsStore()
      store.addTerminal('agent-A')
      const tabsBefore = store.tabs.map(t => t.id)

      store.reorderTab('nonexistent', store.tabs[0].id)

      expect(store.tabs.map(t => t.id)).toEqual(tabsBefore)
    })

    it('should be a no-op when toId does not exist', () => {
      const store = useTabsStore()
      store.addTerminal('agent-A')
      const tabsBefore = store.tabs.map(t => t.id)

      store.reorderTab(store.tabs[0].id, 'nonexistent')

      expect(store.tabs.map(t => t.id)).toEqual(tabsBefore)
    })

    it('should be a no-op when fromId === toId', () => {
      const store = useTabsStore()
      store.addTerminal('agent-A')
      const [tabA] = store.tabs.filter(t => t.type === 'terminal')
      const tabsBefore = [...store.tabs.map(t => t.id)]

      store.reorderTab(tabA.id, tabA.id)

      expect(store.tabs.map(t => t.id)).toEqual(tabsBefore)
    })

    it('should be a no-op when either ID does not exist', () => {
      const store = useTabsStore()
      store.addTerminal('agent-A')
      const tabsBefore = [...store.tabs.map(t => t.id)]

      store.reorderTab('nonexistent', store.tabs[0].id)
      store.reorderTab(store.tabs[0].id, 'nonexistent')

      expect(store.tabs.map(t => t.id)).toEqual(tabsBefore)
    })
  })

  describe('addLogs', () => {
    it('should activate the logs tab', () => {
      const store = useTabsStore()
      // logs tab is permanent (id='logs' exists by default)

      store.addLogs()

      expect(store.activeTabId).toBe('logs')
    })

    it('should set logsAgentId when agentId is provided', () => {
      const store = useTabsStore()

      store.addLogs(42)

      const logsTab = store.tabs.find(t => t.type === 'logs')
      expect(logsTab?.logsAgentId).toBe(42)
    })
  })
})

// ── Extended tests: stores/tasks — uncovered actions (T229) ───────────────────

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

// ── useToast composable (T246) ────────────────────────────────────────────────

describe('composables/useToast', () => {
  let useToast: typeof import('@renderer/composables/useToast').useToast

  beforeEach(async () => {
    vi.useFakeTimers()
    // Reset module to get a fresh singleton each test
    vi.resetModules()
    const mod = await import('@renderer/composables/useToast')
    useToast = mod.useToast
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('push() adds a toast with incremental id and default type error', () => {
    const { toasts, push } = useToast()
    push('Something failed')
    expect(toasts.value).toHaveLength(1)
    expect(toasts.value[0].message).toBe('Something failed')
    expect(toasts.value[0].type).toBe('error')
    expect(toasts.value[0].id).toBeGreaterThan(0)
  })

  it('push() with type warn sets toast.type to warn', () => {
    const { toasts, push } = useToast()
    push('Watch out', 'warn')
    expect(toasts.value[0].type).toBe('warn')
  })

  it('push() limits to 5 toasts — shifts oldest when full', () => {
    const { toasts, push } = useToast()
    for (let i = 0; i < 6; i++) push(`msg${i}`)
    expect(toasts.value).toHaveLength(5)
    // First message should have been shifted out
    expect(toasts.value[0].message).toBe('msg1')
    expect(toasts.value[4].message).toBe('msg5')
  })

  it('push() auto-dismisses after duration via setTimeout', () => {
    const { toasts, push } = useToast()
    push('temp', 'info', 3000)
    expect(toasts.value).toHaveLength(1)
    vi.advanceTimersByTime(3000)
    expect(toasts.value).toHaveLength(0)
  })

  it('dismiss(id) removes the matching toast', () => {
    const { toasts, push, dismiss } = useToast()
    push('a')
    push('b')
    const idA = toasts.value[0].id
    dismiss(idA)
    expect(toasts.value).toHaveLength(1)
    expect(toasts.value[0].message).toBe('b')
  })

  it('dismiss(nonexistent id) is a no-op', () => {
    const { toasts, push, dismiss } = useToast()
    push('a')
    dismiss(99999)
    expect(toasts.value).toHaveLength(1)
  })

  it('singleton: two useToast() calls share the same toasts array', () => {
    const t1 = useToast()
    const t2 = useToast()
    t1.push('from t1')
    expect(t2.toasts.value).toHaveLength(1)
    expect(t2.toasts.value[0].message).toBe('from t1')
  })
})

// ── T352: stores/tasks — closeTask, perimetres computed ──────────────────────

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

// ── T352: stores/tabs — setTabDirty, setPtyId, addTerminal title numbering ───

describe('stores/tabs — setTabDirty', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('should set dirty flag to true on a tab', () => {
    const store = useTabsStore()
    store.addTerminal('agent-1')
    const tab = store.tabs.find(t => t.type === 'terminal')!

    store.setTabDirty(tab.id, true)

    expect(tab.dirty).toBe(true)
  })

  it('should set dirty flag to false on a tab', () => {
    const store = useTabsStore()
    store.addTerminal('agent-1')
    const tab = store.tabs.find(t => t.type === 'terminal')!
    store.setTabDirty(tab.id, true)

    store.setTabDirty(tab.id, false)

    expect(tab.dirty).toBe(false)
  })

  it('should be a no-op for non-existent tab id', () => {
    const store = useTabsStore()
    expect(() => store.setTabDirty('nonexistent', true)).not.toThrow()
  })
})

describe('stores/tabs — setPtyId', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('should set ptyId on an existing tab', () => {
    const store = useTabsStore()
    store.addTerminal('agent-1')
    const tab = store.tabs.find(t => t.type === 'terminal')!

    store.setPtyId(tab.id, 'pty-abc-123')

    expect(tab.ptyId).toBe('pty-abc-123')
  })

  it('should be a no-op for non-existent tab id', () => {
    const store = useTabsStore()
    expect(() => store.setPtyId('nonexistent', 'pty-123')).not.toThrow()
  })
})

describe('stores/tabs — addTerminal title numbering', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('should title first agent terminal with agent name only', () => {
    const store = useTabsStore()
    store.addTerminal('myAgent')

    const tab = store.tabs.find(t => t.agentName === 'myAgent')!
    expect(tab.title).toBe('myAgent')
  })

  it('should title second same-agent terminal with "(2)"', () => {
    const store = useTabsStore()
    store.addTerminal('myAgent')
    store.addTerminal('myAgent')

    const termTabs = store.tabs.filter(t => t.agentName === 'myAgent')
    expect(termTabs).toHaveLength(2)
    expect(termTabs[0].title).toBe('myAgent')
    expect(termTabs[1].title).toBe('myAgent (2)')
  })

  it('should title third same-agent terminal with "(3)"', () => {
    const store = useTabsStore()
    store.addTerminal('myAgent')
    store.addTerminal('myAgent')
    store.addTerminal('myAgent')

    const termTabs = store.tabs.filter(t => t.agentName === 'myAgent')
    expect(termTabs[2].title).toBe('myAgent (3)')
  })

  it('should title anonymous terminal as "WSL N"', () => {
    const store = useTabsStore()
    store.addTerminal() // no agent

    const termTabs = store.tabs.filter(t => t.type === 'terminal')
    expect(termTabs[0].title).toBe('WSL 1')
  })

  it('should count all terminals for WSL numbering', () => {
    const store = useTabsStore()
    store.addTerminal('someAgent')
    store.addTerminal() // anonymous

    const anonTab = store.tabs.filter(t => t.type === 'terminal' && !t.agentName)
    expect(anonTab[0].title).toBe('WSL 2')
  })

  it('should not activate terminal when activate=false', () => {
    const store = useTabsStore()
    const prevActive = store.activeTabId
    store.addTerminal('agent', undefined, undefined, undefined, undefined, undefined, undefined, false)

    expect(store.activeTabId).toBe(prevActive)
  })
})

// ── T352: stores/settings — autoLaunchAgentSessions, autoReview, appInfo ─────

describe('stores/settings — autoLaunchAgentSessions', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
    document.documentElement.className = ''
  })

  it('should default to true', () => {
    const store = useSettingsStore()
    expect(store.autoLaunchAgentSessions).toBe(true)
  })

  it('should persist false to localStorage', () => {
    const store = useSettingsStore()
    store.setAutoLaunchAgentSessions(false)

    expect(store.autoLaunchAgentSessions).toBe(false)
    expect(localStorage.getItem('autoLaunchAgentSessions')).toBe('false')
  })

  it('should persist true to localStorage', () => {
    const store = useSettingsStore()
    store.setAutoLaunchAgentSessions(false)
    store.setAutoLaunchAgentSessions(true)

    expect(store.autoLaunchAgentSessions).toBe(true)
    expect(localStorage.getItem('autoLaunchAgentSessions')).toBe('true')
  })

  it('should read false from localStorage on init', () => {
    localStorage.setItem('autoLaunchAgentSessions', 'false')
    const store = useSettingsStore()

    expect(store.autoLaunchAgentSessions).toBe(false)
  })
})

describe('stores/settings — autoReviewEnabled', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
    document.documentElement.className = ''
  })

  it('should default to true', () => {
    const store = useSettingsStore()
    expect(store.autoReviewEnabled).toBe(true)
  })

  it('should persist enabled state', () => {
    const store = useSettingsStore()
    store.setAutoReviewEnabled(false)

    expect(store.autoReviewEnabled).toBe(false)
    expect(localStorage.getItem('autoReviewEnabled')).toBe('false')
  })
})

describe('stores/settings — autoReviewThreshold', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
    document.documentElement.className = ''
  })

  it('should default to 10', () => {
    const store = useSettingsStore()
    expect(store.autoReviewThreshold).toBe(10)
  })

  it('should clamp minimum to 3', () => {
    const store = useSettingsStore()
    store.setAutoReviewThreshold(1)

    expect(store.autoReviewThreshold).toBe(3)
    expect(localStorage.getItem('autoReviewThreshold')).toBe('3')
  })

  it('should accept values >= 3', () => {
    const store = useSettingsStore()
    store.setAutoReviewThreshold(5)

    expect(store.autoReviewThreshold).toBe(5)
  })

  it('should read from localStorage on init', () => {
    localStorage.setItem('autoReviewThreshold', '15')
    const store = useSettingsStore()

    expect(store.autoReviewThreshold).toBe(15)
  })

  it('should clamp invalid localStorage value to minimum', () => {
    localStorage.setItem('autoReviewThreshold', '1')
    const store = useSettingsStore()

    expect(store.autoReviewThreshold).toBe(3)
  })
})

describe('stores/settings — appInfo', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    localStorage.clear()
    document.documentElement.className = ''
  })

  it('should have default name "Agent Viewer"', () => {
    const store = useSettingsStore()
    expect(store.appInfo.name).toBe('Agent Viewer')
  })

  it('should have a version string', () => {
    const store = useSettingsStore()
    expect(typeof store.appInfo.version).toBe('string')
    expect(store.appInfo.version.length).toBeGreaterThan(0)
  })
})

// ── T352: stores/tasks — watcher tests ───────────────────────────────────────

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
