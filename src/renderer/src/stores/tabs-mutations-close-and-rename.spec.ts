/**
 * tabs-mutations-close-and-rename.spec.ts
 * Split from tabs-mutations.spec.ts — covers:
 * - closeTab: !tab || tab.permanent guard (L224)
 * - closeTab: streamId conditional (L227)
 * - closeTab: sameGroupTab ArrowFunction and LogicalOperator (L237)
 * - closeTab: non-terminal fallback ?? "backlog" (L244)
 * - closeTab: activityTimers cleanup (L248)
 * - renameTab: title.trim() MethodExpression (L257)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useTabsStore } from '@renderer/stores/tabs'
import { mockElectronAPI, installMockElectronAPI } from './__helpers__/tabs-mutations.helpers'

installMockElectronAPI()


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
