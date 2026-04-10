import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
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


describe('stores/tabs — regex title de-duplication (L152)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('should extract number from title with "(N) · #id" suffix', () => {
    const store = useTabsStore()
    store.addTerminal('myAgent')
    const tab = store.tabs.find(t => t.agentName === 'myAgent')!
    tab.title = 'myAgent (2) · #123'

    store.addTerminal('myAgent')

    const agentTabs = store.tabs.filter(t => t.agentName === 'myAgent')
    const lastTab = agentTabs[agentTabs.length - 1]
    expect(lastTab.title).toBe('myAgent (3)')
  })

  it('should handle multi-digit numbers like "(12)"', () => {
    const store = useTabsStore()
    store.addTerminal('myAgent')
    const tab = store.tabs.find(t => t.agentName === 'myAgent')!
    tab.title = 'myAgent (12)'

    store.addTerminal('myAgent')

    const agentTabs = store.tabs.filter(t => t.agentName === 'myAgent')
    expect(agentTabs[1].title).toBe('myAgent (13)')
  })

  it('should treat tabs without "(N)" suffix as (1) when computing next number', () => {
    const store = useTabsStore()
    store.addTerminal('myAgent')

    store.addTerminal('myAgent')

    const agentTabs = store.tabs.filter(t => t.agentName === 'myAgent')
    expect(agentTabs[1].title).toBe('myAgent (2)')
  })

  it('regex: title "Agent (2) · #123" matches pattern', () => {
    const regex = /\((\d+)\)(?:\s·\s#\d+)?$/
    expect('Agent (2) · #123'.match(regex)?.[1]).toBe('2')
  })

  it('regex: title "Agent (2)" matches without #id part', () => {
    const regex = /\((\d+)\)(?:\s·\s#\d+)?$/
    expect('Agent (2)'.match(regex)?.[1]).toBe('2')
  })

  it('regex: title without number returns no match', () => {
    const regex = /\((\d+)\)(?:\s·\s#\d+)?$/
    expect('Agent'.match(regex)).toBeNull()
  })

  it('regex: end-of-string anchor rejects "(2) extra" trailing text', () => {
    const regex = /\((\d+)\)(?:\s·\s#\d+)?$/
    expect('Agent (2) extra'.match(regex)).toBeNull()
  })

  it('regex: multi-digit "(99)" is captured correctly', () => {
    const regex = /\((\d+)\)(?:\s·\s#\d+)?$/
    expect('Agent (99)'.match(regex)?.[1]).toBe('99')
  })

  it('regex: "(3)·#456" without spaces does not match', () => {
    const regex = /\((\d+)\)(?:\s·\s#\d+)?$/
    // Trailing "·#456" not consumed by optional group → no end-of-string match
    expect('Agent (3)·#456'.match(regex)).toBeNull()
    // With proper spaces matches correctly
    expect('Agent (3) · #456'.match(regex)?.[1]).toBe('3')
  })
})


describe('stores/tabs — markTabActive throttle (L83–L86)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should throttle: 2nd call within 499ms does not restart activity', () => {
    const store = useTabsStore()
    const tabId = 'tab-throttle'

    store.markTabActive(tabId)
    vi.advanceTimersByTime(499)
    store.tabActivity[tabId] = false
    store.markTabActive(tabId) // within 499ms → throttled

    expect(store.tabActivity[tabId]).toBe(false)
  })

  it('should NOT throttle: call after 5s lets timer expire and resets', () => {
    const store = useTabsStore()
    const tabId = 'tab-nothrottle'

    store.markTabActive(tabId)
    vi.advanceTimersByTime(5000)
    expect(store.tabActivity[tabId]).toBe(false)

    store.markTabActive(tabId) // 5000ms later → NOT throttled
    expect(store.tabActivity[tabId]).toBe(true)
  })

  it('should deactivate tab after 5s', () => {
    const store = useTabsStore()
    const tabId = 'tab-timer'

    store.markTabActive(tabId)
    expect(store.tabActivity[tabId]).toBe(true)

    vi.advanceTimersByTime(5000)
    expect(store.tabActivity[tabId]).toBe(false)
  })

  it('throttle threshold — call well past 500ms is not throttled', () => {
    const store = useTabsStore()
    const tabId = 'tab-boundary'

    store.markTabActive(tabId)
    vi.advanceTimersByTime(5001) // let first expire
    store.markTabActive(tabId)   // definitely past threshold

    expect(store.tabActivity[tabId]).toBe(true)
  })
})


describe('stores/tabs — addTerminal parameters stored (L168–L176)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('should store all provided parameters on the new tab', () => {
    const store = useTabsStore()
    store.addTerminal(
      'my-agent',
      'Ubuntu',
      'echo hi',
      'be concise',
      'auto',
      'claude-custom',
      'conv-uuid-123',
      true,
      42,
      'stream',
      'claude' as any,
      '/workspace',
    )

    const tab = store.tabs.find(t => t.agentName === 'my-agent')!
    expect(tab.agentName).toBe('my-agent')
    expect(tab.wslDistro).toBe('Ubuntu')
    expect(tab.autoSend).toBe('echo hi')
    expect(tab.systemPrompt).toBe('be concise')
    expect(tab.thinkingMode).toBe('auto')
    expect(tab.customBinaryName).toBe('claude-custom')
    expect(tab.convId).toBe('conv-uuid-123')
    expect(tab.taskId).toBe(42)
    expect(tab.viewMode).toBe('stream')
    expect(tab.cli).toBe('claude')
    expect(tab.workDir).toBe('/workspace')
  })

  it('should default null for unprovided optional params', () => {
    const store = useTabsStore()
    store.addTerminal('bare-agent')

    const tab = store.tabs.find(t => t.agentName === 'bare-agent')!
    expect(tab.wslDistro).toBeNull()
    expect(tab.autoSend).toBeNull()
    expect(tab.systemPrompt).toBeNull()
    expect(tab.thinkingMode).toBeNull()
    expect(tab.customBinaryName).toBeNull()
    expect(tab.convId).toBeNull()
    expect(tab.taskId).toBeNull()
    expect(tab.viewMode).toBe('stream')
    expect(tab.cli).toBeNull()
    expect(tab.workDir).toBeNull()
  })

  it('should default viewMode to "stream" when not provided', () => {
    const store = useTabsStore()
    store.addTerminal('agent-vm')

    const tab = store.tabs.find(t => t.agentName === 'agent-vm')!
    expect(tab.viewMode).toBe('stream')
  })
})


describe('stores/tabs — closeTab active selection edge cases', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('should fall back to backlog when last terminal is closed', () => {
    const store = useTabsStore()
    store.addTerminal('solo-agent')
    const tab = store.tabs.find(t => t.type === 'terminal')!

    store.closeTab(tab.id)

    expect(store.activeTabId).toBe('backlog')
  })

  it('should not change activeTabId when closing an inactive tab', () => {
    const store = useTabsStore()
    store.addTerminal('agent-a')
    store.addTerminal('agent-b')
    const [tabA, tabB] = store.tabs.filter(t => t.type === 'terminal')
    store.setActive(tabB.id)

    store.closeTab(tabA.id)

    expect(store.activeTabId).toBe(tabB.id)
  })

  it('should clean up tabActivity entry when closing tab', () => {
    const store = useTabsStore()
    store.addTerminal('agent-clean')
    const tab = store.tabs.find(t => t.type === 'terminal')!
    store.markTabActive(tab.id)
    expect(store.tabActivity[tab.id]).toBe(true)

    store.closeTab(tab.id)

    expect(store.tabActivity[tab.id]).toBeUndefined()
  })

  it('should call agentKill with streamId when closing tab that has one', () => {
    const store = useTabsStore()
    store.addTerminal('agent-kill')
    const tab = store.tabs.find(t => t.type === 'terminal')!
    store.setStreamId(tab.id, 'stream-abc')

    store.closeTab(tab.id)

    expect(mockElectronAPI.agentKill).toHaveBeenCalledWith('stream-abc')
  })

  it('should NOT call agentKill when tab has no streamId', () => {
    const store = useTabsStore()
    store.addTerminal('agent-no-stream')
    const tab = store.tabs.find(t => t.type === 'terminal')!

    store.closeTab(tab.id)

    expect(mockElectronAPI.agentKill).not.toHaveBeenCalled()
  })

  it('should prefer same-agent tab over other-agent terminal', () => {
    const store = useTabsStore()
    store.addTerminal('agent-a')
    store.addTerminal('agent-a')
    store.addTerminal('agent-b')
    const [tabA1, tabA2] = store.tabs.filter(t => t.agentName === 'agent-a')
    store.setActive(tabA1.id)

    store.closeTab(tabA1.id)

    expect(store.activeTabId).toBe(tabA2.id)
  })
})


describe('stores/tabs — isAgentActive type guard (L94)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('should return false for non-terminal tabs even with matching agentName', () => {
    const store = useTabsStore()
    store.openFile('/some/file.ts', 'file.ts')
    const fileTab = store.tabs.find(t => t.type === 'file')!
    ;(fileTab as any).agentName = 'some-agent'
    store.markTabActive(fileTab.id)

    expect(store.isAgentActive('some-agent')).toBe(false)
  })

  it('should return true when one of the agent terminals is active', () => {
    const store = useTabsStore()
    store.addTerminal('multi-agent')
    store.addTerminal('multi-agent')
    const [tab1] = store.tabs.filter(t => t.agentName === 'multi-agent')

    store.markTabActive(tab1.id)

    expect(store.isAgentActive('multi-agent')).toBe(true)
  })

  it('should return false when agent terminal exists but is not active', () => {
    const store = useTabsStore()
    store.addTerminal('inactive-agent')

    expect(store.isAgentActive('inactive-agent')).toBe(false)
  })
})


describe('stores/tabs — hasAgentTerminal type guard (L98)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('should return false for non-terminal tabs with matching agentName', () => {
    const store = useTabsStore()
    store.openFile('/path/file.ts', 'file.ts')
    const fileTab = store.tabs.find(t => t.type === 'file')!
    ;(fileTab as any).agentName = 'ghost-agent'

    expect(store.hasAgentTerminal('ghost-agent')).toBe(false)
  })

  it('should return true when agent has at least one terminal tab', () => {
    const store = useTabsStore()
    store.addTerminal('real-agent')

    expect(store.hasAgentTerminal('real-agent')).toBe(true)
  })

  it('should return false after all agent terminals are closed', () => {
    const store = useTabsStore()
    store.addTerminal('temp-agent')
    const tab = store.tabs.find(t => t.agentName === 'temp-agent')!

    store.closeTab(tab.id)

    expect(store.hasAgentTerminal('temp-agent')).toBe(false)
  })
})
