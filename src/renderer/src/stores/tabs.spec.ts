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
      const terminals = store.tabs.filter(t => t.type === 'terminal')
      const firstTabId = terminals[0].id
      store.setActive(firstTabId)
      const secondTabId = terminals[1].id

      store.closeTab(secondTabId)

      expect(store.activeTabId).toBe(firstTabId)
    })

    it('should stay in same agent group when closing active tab (T619)', () => {
      const store = useTabsStore()
      store.addTerminal('agent-a')
      store.addTerminal('agent-a')
      store.addTerminal('agent-b')
      // tabs: [backlog, stat, agent-a tab1, agent-a tab2, agent-b tab]
      const terminals = store.tabs.filter(t => t.type === 'terminal')
      const [tabA1, tabA2] = terminals
      store.setActive(tabA1.id)

      store.closeTab(tabA1.id)

      // Should land on agent-a tab2, not agent-b
      expect(store.activeTabId).toBe(tabA2.id)
    })

    it('should fall back to another group when last tab of group is closed (T619)', () => {
      const store = useTabsStore()
      store.addTerminal('agent-a')
      store.addTerminal('agent-b')
      // tabs: [backlog, stat, agent-a tab, agent-b tab]
      const terminals = store.tabs.filter(t => t.type === 'terminal')
      const [tabA, tabB] = terminals
      store.setActive(tabA.id)

      store.closeTab(tabA.id)

      // agent-a has no more tabs → should land on agent-b
      expect(store.activeTabId).toBe(tabB.id)
    })

    it('should not cause inter-group switch when non-active tab is closed (T619)', () => {
      const store = useTabsStore()
      store.addTerminal('agent-a')
      store.addTerminal('agent-a')
      store.addTerminal('agent-b')
      // tabs: [backlog, stat, agent-a tab1, agent-a tab2, agent-b tab]
      const terminals = store.tabs.filter(t => t.type === 'terminal')
      const [tabA1, tabA2, tabB] = terminals
      store.setActive(tabB.id)

      store.closeTab(tabA1.id)

      // Closing non-active tab should not change active tab
      expect(store.activeTabId).toBe(tabB.id)
      expect(store.tabs.find(t => t.id === tabA2.id)).toBeDefined()
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

    it('should call agentKill for each terminal with a streamId (T730)', () => {
      const store = useTabsStore()
      store.addTerminal('agent-1')
      const termTab = store.tabs.find(t => t.type === 'terminal')
      if (termTab) store.setStreamId(termTab.id, 'stream-123')

      store.closeAllTerminals()

      expect(mockElectronAPI.agentKill).toHaveBeenCalledWith('stream-123')
      expect(mockElectronAPI.terminalKill).not.toHaveBeenCalled()
    })

    it('should call agentKill for all stream tabs (T730)', () => {
      const store = useTabsStore()
      store.addTerminal('agent-1')
      store.addTerminal('agent-2')
      const [tab1, tab2] = store.tabs.filter(t => t.type === 'terminal')
      if (tab1) store.setStreamId(tab1.id, 'stream-1')
      if (tab2) store.setStreamId(tab2.id, 'stream-2')

      store.closeAllTerminals()

      expect(mockElectronAPI.agentKill).toHaveBeenCalledWith('stream-1')
      expect(mockElectronAPI.agentKill).toHaveBeenCalledWith('stream-2')
      expect(mockElectronAPI.terminalKill).not.toHaveBeenCalled()
    })

    it('should reset activeTabId to backlog after closing active terminal', () => {
      const store = useTabsStore()
      store.addTerminal('agent-x')
      // Active tab is now the terminal

      store.closeAllTerminals()

      expect(store.activeTabId).toBe('backlog')
    })
  })

  describe('closeTabGroup', () => {
    it('should close all tabs of the specified agent group', () => {
      const store = useTabsStore()
      store.addTerminal('agent-a')
      store.addTerminal('agent-a')
      store.addTerminal('agent-b')

      store.closeTabGroup('agent-a')

      const remaining = store.tabs.filter(t => t.type === 'terminal')
      expect(remaining).toHaveLength(1)
      expect(remaining[0].agentName).toBe('agent-b')
    })

    it('should not close permanent tabs when agentName is null', () => {
      const store = useTabsStore()
      store.addTerminal('agent-x')
      store.closeTabGroup(null)
      // Only the terminal without agentName would be affected; permanent tabs must survive
      expect(store.tabs.find(t => t.id === 'backlog')).toBeDefined()
      expect(store.tabs.find(t => t.id === 'dashboard')).toBeDefined()
    })

    it('should reset activeTabId to backlog when active tab is in closed group', () => {
      const store = useTabsStore()
      store.addTerminal('agent-z')
      // The terminal is now active

      store.closeTabGroup('agent-z')

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

  describe('addLogs', () => {
    it('should activate the dashboard tab', () => {
      const store = useTabsStore()
      // dashboard tab is permanent (id='dashboard' exists by default)

      store.addLogs()

      expect(store.activeTabId).toBe('dashboard')
    })

    it('should set logsAgentId when agentId is provided', () => {
      const store = useTabsStore()

      store.addLogs(42)

      const statTab = store.tabs.find(t => t.type === 'dashboard')
      expect(statTab?.logsAgentId).toBe(42)
    })
  })
})


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

