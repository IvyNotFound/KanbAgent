/**
 * tabs-mutations.spec.ts
 * Mutation-killing tests for tabs.ts targeting survived mutations:
 * - L67-69: initial tab StringLiterals (id, type, title, permanent fields)
 * - L71: activeTabId initial value 'backlog'
 * - L86: addExplorer `if (existing)` ConditionalExpression
 * - L94/98: isAgentActive/hasAgentTerminal `t.type === 'terminal'` guard
 * - L113: addExplorer title 'Fichiers' StringLiteral
 * - L130: openFile `if (existing)` ConditionalExpression
 * - L132: openFile `file-${Date.now()}` StringLiteral
 * - L139: addLogs `statTab && agentId != null` LogicalOperator
 * - L147: addTerminal filter `t.type === 'terminal' && t.agentName === agentName`
 * - L152: addTerminal Regex
 * - L199: setStreamId `if (tab)` ConditionalExpression
 * - L224: closeTab `if (!tab || tab.permanent)` guard
 * - L227: closeTab `if (tab.streamId)` ConditionalExpression + BlockStatement
 * - L237: closeTab sameGroupTab logic (ArrowFunction, ConditionalExpression, LogicalOperator, EqualityOperator)
 * - L244: closeTab `?? 'backlog'` NoCoverage
 * - L248: closeTab `if (activityTimers[id])` ConditionalExpression + BlockStatement
 * - L257: renameTab `title.trim()` MethodExpression
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
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
  agentKill: vi.fn(),
  worktreeRemove: vi.fn().mockResolvedValue({ success: true }),
}

Object.defineProperty(window, 'electronAPI', {
  value: mockElectronAPI,
  writable: true,
})


// ─── Initial state: default tabs shape (L67-69 StringLiterals + BooleanLiteral) ─

describe('tabs — initial state shape (L67-69 StringLiterals + L71 activeTabId)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('has backlog as the first permanent tab with correct id, type, title', () => {
    const store = useTabsStore()
    const backlog = store.tabs[0]
    expect(backlog.id).toBe('backlog')
    expect(backlog.type).toBe('backlog')
    expect(backlog.title).toBe('Backlog')
    expect(backlog.permanent).toBe(true)
  })

  it('has dashboard as second permanent tab with correct id, type, title', () => {
    const store = useTabsStore()
    const dashboard = store.tabs.find(t => t.type === 'dashboard')!
    expect(dashboard.id).toBe('dashboard')
    expect(dashboard.type).toBe('dashboard')
    expect(dashboard.title).toBe('Dashboard')
    expect(dashboard.permanent).toBe(true)
  })

  it('has timeline as third permanent tab with correct id, type, title', () => {
    const store = useTabsStore()
    const timeline = store.tabs.find(t => t.type === 'timeline')!
    expect(timeline.id).toBe('timeline')
    expect(timeline.type).toBe('timeline')
    expect(timeline.title).toBe('Timeline')
    expect(timeline.permanent).toBe(true)
  })

  it('has exactly 3 permanent tabs initially', () => {
    const store = useTabsStore()
    const permanentTabs = store.tabs.filter(t => t.permanent)
    expect(permanentTabs).toHaveLength(3)
  })

  it('activeTabId is "backlog" initially (not empty string, L71 StringLiteral)', () => {
    const store = useTabsStore()
    expect(store.activeTabId).toBe('backlog')
    expect(store.activeTabId).not.toBe('')
  })

  it('timeline has permanent=true (not false, L69 BooleanLiteral mutation)', () => {
    const store = useTabsStore()
    const timeline = store.tabs.find(t => t.type === 'timeline')!
    expect(timeline.permanent).toBe(true)
    expect(timeline.permanent).not.toBe(false)
  })

  it('backlog tab id equals activeTabId on init (closing backlog is prevented)', () => {
    const store = useTabsStore()
    const backlog = store.tabs.find(t => t.id === 'backlog')!
    // The initial activeTabId matches the backlog tab
    expect(store.activeTabId).toBe(backlog.id)
  })
})


// ─── addExplorer: `if (existing)` ConditionalExpression (L86) ─────────────────

describe('tabs — addExplorer: existing tab detection (L86 ConditionalExpression)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('activates existing explorer tab without adding duplicate (existing truthy path)', () => {
    const store = useTabsStore()
    store.addExplorer()
    const countAfterFirst = store.tabs.length
    // Deactivate explorer to test reactivation
    store.setActive('backlog')

    store.addExplorer() // should reuse existing

    expect(store.tabs.length).toBe(countAfterFirst) // no new tab added
    expect(store.activeTabId).toBe('explorer')
  })

  it('adds new explorer tab when none exists (existing falsy path)', () => {
    const store = useTabsStore()
    const initialCount = store.tabs.length
    // No explorer tab exists yet

    store.addExplorer()

    expect(store.tabs.length).toBe(initialCount + 1)
    expect(store.tabs.find(t => t.type === 'explorer')).toBeDefined()
  })

  it('adds explorer with title "Fichiers" (L113 StringLiteral)', () => {
    const store = useTabsStore()
    store.addExplorer()

    const explorerTab = store.tabs.find(t => t.type === 'explorer')!
    expect(explorerTab.title).toBe('Fichiers')
    expect(explorerTab.title).not.toBe('')
  })
})


// ─── isAgentActive: `t.type === 'terminal'` guard (L94 ConditionalExpression) ─

describe('tabs — isAgentActive type guard (L94 ConditionalExpression)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns false when no tabs exist for the agent name', () => {
    const store = useTabsStore()
    expect(store.isAgentActive('nonexistent-agent')).toBe(false)
  })

  it('returns true ONLY for terminal tabs (not file/explorer type)', () => {
    const store = useTabsStore()
    // Add a file tab with matching agentName (hack)
    store.openFile('/path/a.ts', 'a.ts')
    const fileTab = store.tabs.find(t => t.type === 'file')!
    ;(fileTab as Record<string, unknown>).agentName = 'my-agent'
    store.markTabActive(fileTab.id)
    // type is 'file', not 'terminal' → should be false even if active
    expect(store.isAgentActive('my-agent')).toBe(false)
  })

  it('returns true when terminal tab with matching agent is active', () => {
    const store = useTabsStore()
    store.addTerminal('active-agent')
    const tab = store.tabs.find(t => t.agentName === 'active-agent')!
    store.markTabActive(tab.id)
    expect(store.isAgentActive('active-agent')).toBe(true)
  })

  it('returns false when agent terminal exists but is not active', () => {
    const store = useTabsStore()
    store.addTerminal('inactive-agent')
    // Do NOT call markTabActive
    expect(store.isAgentActive('inactive-agent')).toBe(false)
  })
})


// ─── hasAgentTerminal: `t.type === 'terminal'` guard (L98 ConditionalExpression)

describe('tabs — hasAgentTerminal type guard (L98 ConditionalExpression)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('returns false when agent has only non-terminal tabs', () => {
    const store = useTabsStore()
    store.openFile('/path.ts', 'path.ts')
    const fileTab = store.tabs.find(t => t.type === 'file')!
    ;(fileTab as Record<string, unknown>).agentName = 'non-terminal-agent'
    // type is 'file', not 'terminal'
    expect(store.hasAgentTerminal('non-terminal-agent')).toBe(false)
  })

  it('returns true when agent has exactly one terminal tab', () => {
    const store = useTabsStore()
    store.addTerminal('exactly-one')
    expect(store.hasAgentTerminal('exactly-one')).toBe(true)
  })

  it('returns false when all terminal tabs have different agentName', () => {
    const store = useTabsStore()
    store.addTerminal('agent-x')
    store.addTerminal('agent-y')
    expect(store.hasAgentTerminal('agent-z')).toBe(false)
  })
})


// ─── openFile: `if (existing)` ConditionalExpression (L130) ──────────────────

describe('tabs — openFile: existing file detection (L130 ConditionalExpression + L132 StringLiteral)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('activates existing file tab without adding duplicate (existing truthy path)', () => {
    const store = useTabsStore()
    store.openFile('/path/to/file.ts', 'file.ts')
    const countAfterFirst = store.tabs.length
    store.setActive('backlog')

    store.openFile('/path/to/file.ts', 'file.ts') // same path

    expect(store.tabs.length).toBe(countAfterFirst)
  })

  it('adds new file tab when filePath differs (existing falsy path)', () => {
    const store = useTabsStore()
    store.openFile('/path/a.ts', 'a.ts')
    const countAfterFirst = store.tabs.length

    store.openFile('/path/b.ts', 'b.ts') // different path

    expect(store.tabs.length).toBe(countAfterFirst + 1)
  })

  it('new file tab id starts with "file-" (L132 StringLiteral)', () => {
    const store = useTabsStore()
    store.openFile('/some/file.ts', 'file.ts')

    const fileTab = store.tabs.find(t => t.type === 'file')!
    expect(fileTab.id).toMatch(/^file-/)
    expect(fileTab.id).not.toBe('')
  })

  it('filePath is stored exactly on the tab', () => {
    const store = useTabsStore()
    store.openFile('/exact/path.ts', 'path.ts')

    const fileTab = store.tabs.find(t => t.type === 'file')!
    expect(fileTab.filePath).toBe('/exact/path.ts')
  })
})


// ─── addLogs: `statTab && agentId != null` LogicalOperator (L139) ─────────────

describe('tabs — addLogs: LogicalOperator (L139 statTab && agentId != null)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('sets logsAgentId when statTab exists AND agentId is provided (both truthy)', () => {
    const store = useTabsStore()
    store.addLogs(55)

    const dashTab = store.tabs.find(t => t.type === 'dashboard')!
    expect(dashTab.logsAgentId).toBe(55)
  })

  it('does NOT set logsAgentId when agentId is null (agentId != null is false)', () => {
    const store = useTabsStore()
    const dashTab = store.tabs.find(t => t.type === 'dashboard')!
    dashTab.logsAgentId = 99 // pre-set
    store.addLogs(null)
    // agentId === null → condition is false → logsAgentId unchanged
    expect(dashTab.logsAgentId).toBe(99)
  })

  it('does NOT set logsAgentId when agentId is undefined (agentId != null is false for undefined)', () => {
    const store = useTabsStore()
    const dashTab = store.tabs.find(t => t.type === 'dashboard')!
    dashTab.logsAgentId = 88
    store.addLogs() // undefined
    // undefined != null is false → logsAgentId unchanged
    expect(dashTab.logsAgentId).toBe(88)
  })

  it('agentId=0 is falsy but != null — logsAgentId IS set (0 != null is true)', () => {
    const store = useTabsStore()
    store.addLogs(0)
    const dashTab = store.tabs.find(t => t.type === 'dashboard')!
    // 0 != null → true → logsAgentId set to 0
    expect(dashTab.logsAgentId).toBe(0)
  })

  it('always activates dashboard tab regardless of agentId', () => {
    const store = useTabsStore()
    store.addLogs()
    expect(store.activeTabId).toBe('dashboard')
  })
})


// ─── addTerminal: `t.type === 'terminal' && t.agentName === agentName` (L147) ─

describe('tabs — addTerminal: same-agent filter LogicalOperator (L147)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('counts only tabs of same agent (not other agents)', () => {
    const store = useTabsStore()
    store.addTerminal('agent-a')
    store.addTerminal('agent-b')
    store.addTerminal('agent-b') // second agent-b

    const agentBTabs = store.tabs.filter(t => t.agentName === 'agent-b')
    // agent-b has 2 terminals; second should be numbered
    expect(agentBTabs[1].title).toBe('agent-b (2)')
    // agent-a should still have title 'agent-a' (not affected by agent-b count)
    const agentATab = store.tabs.find(t => t.agentName === 'agent-a')!
    expect(agentATab.title).toBe('agent-a')
  })

  it('does not count non-terminal tabs for same agent in dedup (type filter)', () => {
    const store = useTabsStore()
    store.addTerminal('agent-x')
    // Manually set a non-terminal tab with same agentName
    store.openFile('/x.ts', 'x.ts')
    const fileTab = store.tabs.find(t => t.type === 'file')!
    ;(fileTab as Record<string, unknown>).agentName = 'agent-x'

    // Now add a second terminal for agent-x — should count only terminal tabs
    store.addTerminal('agent-x')
    const agentXTerminals = store.tabs.filter(t => t.type === 'terminal' && t.agentName === 'agent-x')
    // sameAgentTabs only counts terminal tabs (not file tab with agentName)
    expect(agentXTerminals[1].title).toBe('agent-x (2)')
  })
})


// ─── setStreamId: `if (tab)` ConditionalExpression (L199) ────────────────────

describe('tabs — setStreamId: tab existence guard (L199 ConditionalExpression)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('sets streamId on existing tab (truthy branch)', () => {
    const store = useTabsStore()
    store.addTerminal('agent-1')
    const tab = store.tabs.find(t => t.type === 'terminal')!

    store.setStreamId(tab.id, 'stream-xyz')

    expect(tab.streamId).toBe('stream-xyz')
  })

  it('sets streamId to null to clear it', () => {
    const store = useTabsStore()
    store.addTerminal('agent-1')
    const tab = store.tabs.find(t => t.type === 'terminal')!
    store.setStreamId(tab.id, 'stream-xyz')

    store.setStreamId(tab.id, null)

    expect(tab.streamId).toBeNull()
  })

  it('does not throw when tab id does not exist (falsy branch)', () => {
    const store = useTabsStore()
    expect(() => store.setStreamId('nonexistent-id', 'stream-123')).not.toThrow()
  })
})


// ─── closeTab: `if (!tab || tab.permanent)` guard (L224) ─────────────────────

describe('tabs — closeTab: !tab || tab.permanent guard (L224 ConditionalExpression + BlockStatement)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('returns early for non-existent tab id (tab is undefined — !tab is true)', () => {
    const store = useTabsStore()
    const initialCount = store.tabs.length

    store.closeTab('nonexistent-id')

    expect(store.tabs.length).toBe(initialCount) // nothing removed
  })

  it('returns early for permanent tab (tab.permanent=true)', () => {
    const store = useTabsStore()
    const initialCount = store.tabs.length
    const backlog = store.tabs.find(t => t.id === 'backlog')!
    expect(backlog.permanent).toBe(true)

    store.closeTab('backlog')

    expect(store.tabs.length).toBe(initialCount)
    expect(store.tabs.find(t => t.id === 'backlog')).toBeDefined()
  })

  it('removes non-permanent tab (both conditions false → proceeds)', () => {
    const store = useTabsStore()
    store.addTerminal('agent-temp')
    const tab = store.tabs.find(t => t.type === 'terminal')!
    expect(tab.permanent).toBeFalsy()

    store.closeTab(tab.id)

    expect(store.tabs.find(t => t.id === tab.id)).toBeUndefined()
  })
})


// ─── closeTab: `if (tab.streamId)` ConditionalExpression + BlockStatement (L227)

describe('tabs — closeTab: streamId conditional (L227)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('calls agentKill when streamId is set (truthy branch — BlockStatement not empty)', () => {
    const store = useTabsStore()
    store.addTerminal('agent-kill')
    const tab = store.tabs.find(t => t.type === 'terminal')!
    store.setStreamId(tab.id, 'stream-abc')

    store.closeTab(tab.id)

    expect(mockElectronAPI.agentKill).toHaveBeenCalledWith('stream-abc')
  })

  it('does NOT call agentKill when streamId is null (falsy branch)', () => {
    const store = useTabsStore()
    store.addTerminal('agent-no-stream')
    const tab = store.tabs.find(t => t.type === 'terminal')!
    // streamId is null by default

    store.closeTab(tab.id)

    expect(mockElectronAPI.agentKill).not.toHaveBeenCalled()
  })

  it('does NOT call agentKill when streamId is empty string (falsy)', () => {
    const store = useTabsStore()
    store.addTerminal('agent-empty-stream')
    const tab = store.tabs.find(t => t.type === 'terminal')!
    ;(tab as Record<string, unknown>).streamId = ''

    store.closeTab(tab.id)

    expect(mockElectronAPI.agentKill).not.toHaveBeenCalled()
  })
})


// ─── closeTab: sameGroupTab logic (L237 mutations) ───────────────────────────

describe('tabs — closeTab: sameGroupTab ArrowFunction and LogicalOperator (L237)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('ArrowFunction: finds same-agent terminal (not undefined → ArrowFunction kill)', () => {
    // sameGroupTab = tabs.value.find(t => t.agentName === closedAgentName && t.type === 'terminal')
    // If mutation replaces arrow with () => undefined, find always returns undefined
    const store = useTabsStore()
    store.addTerminal('my-agent')
    store.addTerminal('my-agent')
    const [tab1, tab2] = store.tabs.filter(t => t.agentName === 'my-agent')
    store.setActive(tab1.id)

    store.closeTab(tab1.id)

    // sameGroupTab found tab2 → activeTabId = tab2.id
    expect(store.activeTabId).toBe(tab2.id)
  })

  it('LogicalOperator: checks BOTH agentName AND type=terminal (L237)', () => {
    // If LogicalOperator replaced && with ||, non-terminal tabs would also be selected
    const store = useTabsStore()
    store.addTerminal('my-agent')
    store.addTerminal('other-agent')
    const [myTab, otherTab] = store.tabs.filter(t => t.type === 'terminal')
    // Hack: add a non-terminal tab with same agentName
    store.openFile('/a.ts', 'a.ts')
    const fileTab = store.tabs.find(t => t.type === 'file')!
    ;(fileTab as Record<string, unknown>).agentName = 'my-agent'
    store.setActive(myTab.id)

    store.closeTab(myTab.id)

    // sameGroupTab should be a terminal tab, not the file tab
    expect(store.activeTabId).toBe(otherTab.id)
    expect(store.activeTabId).not.toBe(fileTab.id)
  })

  it('EqualityOperator L237: t.agentName === closedAgentName (not !=)', () => {
    // If EqualityOperator changed === to !==, sameGroupTab would find tabs from OTHER agents
    const store = useTabsStore()
    store.addTerminal('agent-a')
    store.addTerminal('agent-b')
    const [tabA, tabB] = store.tabs.filter(t => t.type === 'terminal')
    store.setActive(tabA.id)

    store.closeTab(tabA.id)

    // agent-a has no other tabs → sameGroupTab=undefined → falls to otherTerminal=tabB
    expect(store.activeTabId).toBe(tabB.id)
  })

  it('sameGroupTab ?? otherTerminal fallback (L237 ConditionalExpression)', () => {
    // When sameGroupTab is found (same agent), use it (not otherTerminal)
    const store = useTabsStore()
    store.addTerminal('agent-a')
    store.addTerminal('agent-a') // tab2
    store.addTerminal('agent-b') // tab3 — should NOT be selected
    const [tabA1, tabA2] = store.tabs.filter(t => t.agentName === 'agent-a')
    store.setActive(tabA1.id)

    store.closeTab(tabA1.id)

    expect(store.activeTabId).toBe(tabA2.id)
    // NOT tabA3 (agent-b)
    const tabB = store.tabs.find(t => t.agentName === 'agent-b')!
    expect(store.activeTabId).not.toBe(tabB.id)
  })

  it('StringLiteral "backlog" (L237): falls back to "backlog" not empty string', () => {
    // If StringLiteral mutated "backlog" to "", activeTabId would be ""
    const store = useTabsStore()
    store.addTerminal('solo-agent')
    const tab = store.tabs.find(t => t.type === 'terminal')!
    store.setActive(tab.id)

    store.closeTab(tab.id)

    // No other terminals → fallback to 'backlog'
    expect(store.activeTabId).toBe('backlog')
    expect(store.activeTabId).not.toBe('')
  })
})


// ─── closeTab: non-terminal fallback `?? 'backlog'` (L244 NoCoverage) ─────────

describe('tabs — closeTab: non-terminal fallback ?? "backlog" (L244 NoCoverage)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('falls back to "backlog" when closing the ONLY non-terminal non-permanent tab at idx=0', () => {
    // tabs[Math.max(0, 0-1)] = tabs[0] — but if tabs becomes empty after splice, optional chain returns undefined
    // ?? 'backlog' catches undefined
    const store = useTabsStore()
    store.openFile('/only.ts', 'only.ts')
    const fileTab = store.tabs.find(t => t.type === 'file')!
    // Force this to be the active tab
    store.setActive(fileTab.id)
    // Find its index
    const idx = store.tabs.findIndex(t => t.id === fileTab.id)
    // Store only has permanent + file tabs
    // When we close it, tabs[Math.max(0, idx-1)]?.id should be a valid tab or 'backlog'

    store.closeTab(fileTab.id)

    // Should land on a valid tab (not undefined, not empty string)
    expect(store.activeTabId).toBeTruthy()
    expect(store.activeTabId.length).toBeGreaterThan(0)
  })

  it('"backlog" is the fallback — not empty string (L244 StringLiteral NoCoverage)', () => {
    const store = useTabsStore()
    // Add explorer and set active
    store.addExplorer()
    store.setActive('explorer')
    // Remove all other non-permanent tabs to force backlog fallback
    store.addTerminal('temp')
    const termTab = store.tabs.find(t => t.type === 'terminal')!
    store.closeTab(termTab.id)

    // Close explorer (at idx 0 after permanent tabs — previous tab is a permanent one)
    store.closeTab('explorer')

    // Should be a non-empty id
    expect(store.activeTabId).not.toBe('')
    expect(store.activeTabId).toBeTruthy()
  })
})


// ─── closeTab: `if (activityTimers[id])` ConditionalExpression + BlockStatement (L248) ─

describe('tabs — closeTab: activityTimers cleanup (L248 ConditionalExpression + BlockStatement)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('clears activityTimer on closeTab when timer exists (truthy branch)', () => {
    const store = useTabsStore()
    store.addTerminal('agent-timed')
    const tab = store.tabs.find(t => t.type === 'terminal')!
    store.markTabActive(tab.id) // creates timer

    // Tab is active (timer set)
    expect(store.tabActivity[tab.id]).toBe(true)

    store.closeTab(tab.id)

    // After close, timer should be cleaned up — advance timer, no crash
    vi.advanceTimersByTime(5000) // timer fired after close → tabActivity[tab.id] should be deleted by closeTab
    expect(store.tabActivity[tab.id]).toBeUndefined()
  })

  it('does not crash when closing tab without activity timer (falsy branch)', () => {
    const store = useTabsStore()
    store.addTerminal('agent-no-timer')
    const tab = store.tabs.find(t => t.type === 'terminal')!
    // No markTabActive called → no timer

    expect(() => store.closeTab(tab.id)).not.toThrow()
    expect(store.tabActivity[tab.id]).toBeUndefined()
  })

  it('tabActivity entry is removed after closeTab (BlockStatement must execute delete)', () => {
    const store = useTabsStore()
    store.addTerminal('agent-del')
    const tab = store.tabs.find(t => t.type === 'terminal')!
    store.markTabActive(tab.id)
    expect(tab.id in store.tabActivity).toBe(true)

    store.closeTab(tab.id)

    expect(tab.id in store.tabActivity).toBe(false)
  })
})


// ─── renameTab: `title.trim()` MethodExpression (L257) ───────────────────────

describe('tabs — renameTab: title.trim() MethodExpression (L257)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('trims whitespace when renaming (MethodExpression must call .trim())', () => {
    const store = useTabsStore()
    store.addTerminal('agent-1')
    const tab = store.tabs.find(t => t.type === 'terminal')!

    store.renameTab(tab.id, '  new name  ')

    // If MethodExpression mutated to just `title`, the stored value would be '  new name  '
    expect(tab.title).toBe('new name')
    expect(tab.title).not.toBe('  new name  ')
  })

  it('stores trimmed value — title without leading/trailing spaces', () => {
    const store = useTabsStore()
    store.addTerminal('agent-2')
    const tab = store.tabs.find(t => t.type === 'terminal')!

    store.renameTab(tab.id, '\t tabbed \t')

    expect(tab.title).toBe('tabbed')
  })

  it('single word with no spaces — trimmed == original', () => {
    const store = useTabsStore()
    store.addTerminal('agent-3')
    const tab = store.tabs.find(t => t.type === 'terminal')!

    store.renameTab(tab.id, 'clean')

    expect(tab.title).toBe('clean')
  })
})
