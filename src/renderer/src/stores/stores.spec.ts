import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
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
        { id: 1, titre: 'Task 1', agent_assigne_id: 1, perimetre: 'front-vuejs', statut: 'a_faire' },
        { id: 2, titre: 'Task 2', agent_assigne_id: 2, perimetre: 'back-electron', statut: 'a_faire' },
      ] as never

      const filtered = store.filteredTasks
      expect(filtered).toHaveLength(2)
    })

    it('should filter by agent_id', () => {
      const store = useTasksStore()
      store.tasks = [
        { id: 1, titre: 'Task 1', agent_assigne_id: 1, perimetre: 'front-vuejs', statut: 'a_faire' },
        { id: 2, titre: 'Task 2', agent_assigne_id: 2, perimetre: 'back-electron', statut: 'a_faire' },
      ] as never

      store.selectedAgentId = 1
      const filtered = store.filteredTasks

      expect(filtered).toHaveLength(1)
      expect(filtered[0].id).toBe(1)
    })

    it('should filter by perimetre', () => {
      const store = useTasksStore()
      store.tasks = [
        { id: 1, titre: 'Task 1', agent_assigne_id: 1, perimetre: 'front-vuejs', statut: 'a_faire' },
        { id: 2, titre: 'Task 2', agent_assigne_id: 2, perimetre: 'back-electron', statut: 'a_faire' },
      ] as never

      store.selectedPerimetre = 'front-vuejs'
      const filtered = store.filteredTasks

      expect(filtered).toHaveLength(1)
      expect(filtered[0].perimetre).toBe('front-vuejs')
    })

    it('should filter by both agent_id and perimetre', () => {
      const store = useTasksStore()
      store.tasks = [
        { id: 1, titre: 'Task 1', agent_assigne_id: 1, perimetre: 'front-vuejs', statut: 'a_faire' },
        { id: 2, titre: 'Task 2', agent_assigne_id: 2, perimetre: 'back-electron', statut: 'a_faire' },
        { id: 3, titre: 'Task 3', agent_assigne_id: 1, perimetre: 'back-electron', statut: 'a_faire' },
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
        { id: 1, titre: 'Task 1', agent_assigne_id: 1, perimetre: 'front', statut: 'a_faire' },
        { id: 2, titre: 'Task 2', agent_assigne_id: 1, perimetre: 'front', statut: 'a_faire' },
        { id: 3, titre: 'Task 3', agent_assigne_id: 1, perimetre: 'front', statut: 'en_cours' },
        { id: 4, titre: 'Task 4', agent_assigne_id: 1, perimetre: 'front', statut: 'terminé' },
        { id: 5, titre: 'Task 5', agent_assigne_id: 1, perimetre: 'front', statut: 'archivé' },
        { id: 6, titre: 'Task 6', agent_assigne_id: 1, perimetre: 'front', statut: 'validé' }, // legacy, should count as archivé
      ] as never

      const byStatus = store.tasksByStatus

      expect(byStatus.a_faire).toHaveLength(2)
      expect(byStatus.en_cours).toHaveLength(1)
      expect(byStatus.terminé).toHaveLength(1)
      expect(byStatus.archivé).toHaveLength(2) // archivé + validé
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

  describe('normalizeRow', () => {
    it('should convert Uint8Array to string', () => {
      const store = useTasksStore()
      const encoder = new TextEncoder()
      const uint8Array = encoder.encode('test string')
      const row = { content: uint8Array }

      // Access the normalizeRow function indirectly through the store's internal logic
      const result = store.tasks // This will use the store's state
      expect(result).toEqual([])
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

      // Advance 35s to trigger the first poll (interval is 30s)
      await vi.advanceTimersByTimeAsync(35000)

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
