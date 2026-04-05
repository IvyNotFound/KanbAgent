/**
 * tabs-mutation.spec.ts
 * Targets surviving ArithmeticOperator and EqualityOperator mutations in tabs.ts.
 * Focus: index boundary ops, +/- on tab counters, closeTab fallback exact behaviour.
 * T1348
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
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


// ─── closeTab idx-1 arithmetic: Math.max(0, idx-1) ───────────────────────────
// Mutation target: replace idx-1 with idx+1 or idx-0 → falls back to wrong tab
// Note: openFile uses Date.now() for IDs, which may collide within the same ms.
// We use fake timers to ensure distinct timestamps per openFile call.

describe('tabs — closeTab non-terminal fallback: Math.max(0, idx-1) arithmetic', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('falls back to tab at idx-1 (not idx+1 or idx) when closing non-terminal', () => {
    const store = useTabsStore()
    // Use fake timers to ensure unique IDs per openFile call
    vi.setSystemTime(1000)
    store.openFile('/a.ts', 'a.ts')
    vi.setSystemTime(2000)
    store.openFile('/b.ts', 'b.ts')

    // tabs: [backlog(0), dashboard(1), file-a(2), file-b(3)]
    const fileA = store.tabs.find(t => t.filePath === '/a.ts')!
    const fileB = store.tabs.find(t => t.filePath === '/b.ts')!
    const idxB = store.tabs.findIndex(t => t.id === fileB.id)
    // idx-1 of fileB must be fileA
    expect(store.tabs[idxB - 1].id).toBe(fileA.id)

    store.setActive(fileB.id)
    store.closeTab(fileB.id)

    // Must land on the tab just before file-B (file-A)
    expect(store.activeTabId).toBe(fileA.id)
  })

  it('falls back to dashboard (idx-1) when only one file tab at position 2', () => {
    const store = useTabsStore()
    vi.setSystemTime(5000)
    store.openFile('/only.ts', 'only.ts')

    // tabs: [backlog(0), dashboard(1), file(2)]
    const fileTab = store.tabs.find(t => t.type === 'file')!
    const idxFile = store.tabs.findIndex(t => t.id === fileTab.id)
    // idx-1 = 1 = dashboard
    const expectedFallback = store.tabs[Math.max(0, idxFile - 1)].id

    store.setActive(fileTab.id)
    store.closeTab(fileTab.id)

    expect(store.activeTabId).toBe(expectedFallback)
    expect(store.activeTabId).not.toBe(fileTab.id)
  })

  it('falls back to position 0 (backlog) — Math.max(0,...) prevents negative index', () => {
    const store = useTabsStore()
    vi.setSystemTime(6000)
    store.openFile('/edge.ts', 'edge.ts')
    const fileTab = store.tabs.find(t => t.type === 'file')!

    store.setActive(fileTab.id)
    store.closeTab(fileTab.id)

    // Active tab must still exist in the tabs array (never a negative index)
    expect(store.tabs.find(t => t.id === store.activeTabId)).toBeDefined()
  })

  it('two file tabs — closing second one lands on first, not on a different offset', () => {
    const store = useTabsStore()
    vi.setSystemTime(10000)
    store.openFile('/first.ts', 'first.ts')
    vi.setSystemTime(11000)
    store.openFile('/second.ts', 'second.ts')

    const first = store.tabs.find(t => t.filePath === '/first.ts')!
    const second = store.tabs.find(t => t.filePath === '/second.ts')!

    store.setActive(second.id)
    store.closeTab(second.id)

    expect(store.activeTabId).toBe(first.id)
  })

  it('three file tabs — closing third one lands on second (not first)', () => {
    const store = useTabsStore()
    vi.setSystemTime(20000)
    store.openFile('/f1.ts', 'f1.ts')
    vi.setSystemTime(21000)
    store.openFile('/f2.ts', 'f2.ts')
    vi.setSystemTime(22000)
    store.openFile('/f3.ts', 'f3.ts')

    const f2 = store.tabs.find(t => t.filePath === '/f2.ts')!
    const f3 = store.tabs.find(t => t.filePath === '/f3.ts')!

    store.setActive(f3.id)
    store.closeTab(f3.id)

    expect(store.activeTabId).toBe(f2.id)
  })
})


// ─── addTerminal WSL title: tabs.filter(terminal).length + 1 arithmetic ───────
// Mutation target: replace +1 with +0, +2, or -1

describe('tabs — addTerminal WSL title numbering arithmetic', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('first anonymous terminal gets "WSL 1" (length=0, 0+1=1)', () => {
    const store = useTabsStore()
    store.addTerminal()

    const tab = store.tabs.find(t => t.type === 'terminal' && !t.agentName)!
    expect(tab.title).toBe('WSL 1')
  })

  it('second anonymous terminal gets "WSL 2" (length=1, 1+1=2)', () => {
    const store = useTabsStore()
    store.addTerminal()
    store.addTerminal()

    const anonTabs = store.tabs.filter(t => t.type === 'terminal' && !t.agentName)
    expect(anonTabs[0].title).toBe('WSL 1')
    expect(anonTabs[1].title).toBe('WSL 2')
  })

  it('third terminal (mixed agent + anon) gets "WSL 3" — counts ALL terminals', () => {
    const store = useTabsStore()
    store.addTerminal('agent-a') // terminal[0]
    store.addTerminal('agent-b') // terminal[1]
    store.addTerminal()          // terminal[2] → WSL 3

    const anonTab = store.tabs.find(t => t.type === 'terminal' && !t.agentName)!
    expect(anonTab.title).toBe('WSL 3')
  })

  it('WSL number is exactly length+1, not length or length+2', () => {
    const store = useTabsStore()
    // 4 terminals before anon
    store.addTerminal('a')
    store.addTerminal('b')
    store.addTerminal('c')
    store.addTerminal('d')
    store.addTerminal()

    const anonTab = store.tabs.find(t => t.type === 'terminal' && !t.agentName)!
    expect(anonTab.title).toBe('WSL 5')
    expect(anonTab.title).not.toBe('WSL 4')
    expect(anonTab.title).not.toBe('WSL 6')
  })
})


// ─── Math.max(...numbers) + 1 arithmetic on duplicate agent titles ────────────
// Mutation target: replace +1 with +0 or -1

describe('tabs — addTerminal duplicate agent: Math.max(numbers)+1', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('second same-agent terminal gets (2) — max(1)+1=2', () => {
    const store = useTabsStore()
    store.addTerminal('dev')
    store.addTerminal('dev')

    const devTabs = store.tabs.filter(t => t.agentName === 'dev')
    expect(devTabs[1].title).toBe('dev (2)')
  })

  it('third same-agent terminal gets (3) — max(1,2)+1=3', () => {
    const store = useTabsStore()
    store.addTerminal('dev')
    store.addTerminal('dev')
    store.addTerminal('dev')

    const devTabs = store.tabs.filter(t => t.agentName === 'dev')
    expect(devTabs[2].title).toBe('dev (3)')
  })

  it('title increments strictly: (2) ≠ (1) and (3) ≠ (2)', () => {
    const store = useTabsStore()
    store.addTerminal('x')
    store.addTerminal('x')
    store.addTerminal('x')

    const xTabs = store.tabs.filter(t => t.agentName === 'x')
    const titles = xTabs.map(t => t.title)
    expect(titles[0]).toBe('x')
    expect(titles[1]).toBe('x (2)')
    expect(titles[2]).toBe('x (3)')
    // Ensure +1 not +0 (would give same number) or -1
    expect(titles[1]).not.toBe('x (1)')
    expect(titles[2]).not.toBe('x (2)')
  })

  it('after gap in numbers, uses max+1 — not sequential count+1', () => {
    const store = useTabsStore()
    store.addTerminal('agent')
    const firstTab = store.tabs.find(t => t.agentName === 'agent')!
    // Manually set title to simulate a "(5)" tab
    firstTab.title = 'agent (5)'

    store.addTerminal('agent')

    const agentTabs = store.tabs.filter(t => t.agentName === 'agent')
    // Should be max(5)+1 = 6, not 2
    expect(agentTabs[1].title).toBe('agent (6)')
  })
})


// ─── EqualityOperator: tab.permanent guard in closeTab ───────────────────────
// Mutation target: replace !tab.permanent with tab.permanent

describe('tabs — closeTab permanent guard (EqualityOperator)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('permanent backlog tab is NOT removed on closeTab', () => {
    const store = useTabsStore()
    store.closeTab('backlog')
    expect(store.tabs.find(t => t.id === 'backlog')).toBeDefined()
  })

  it('permanent dashboard tab is NOT removed on closeTab', () => {
    const store = useTabsStore()
    store.closeTab('dashboard')
    expect(store.tabs.find(t => t.id === 'dashboard')).toBeDefined()
  })

  it('non-permanent terminal tab IS removed on closeTab', () => {
    const store = useTabsStore()
    store.addTerminal('agent')
    const tab = store.tabs.find(t => t.type === 'terminal')!
    store.closeTab(tab.id)
    expect(store.tabs.find(t => t.id === tab.id)).toBeUndefined()
  })

  it('closing permanent tab does not change activeTabId', () => {
    const store = useTabsStore()
    store.addTerminal('agent')
    const termTab = store.tabs.find(t => t.type === 'terminal')!
    store.setActive(termTab.id)

    store.closeTab('backlog')

    // Active tab unchanged since backlog is permanent and was NOT removed
    expect(store.activeTabId).toBe(termTab.id)
  })
})


// ─── EqualityOperator: statTab && agentId != null in addLogs ─────────────────
// Mutation target: replace != null with === null

describe('tabs — addLogs agentId != null guard (EqualityOperator)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('sets logsAgentId when agentId is 0 (falsy but != null)', () => {
    const store = useTabsStore()
    store.addLogs(0)

    const statTab = store.tabs.find(t => t.type === 'dashboard')!
    // 0 != null → should set logsAgentId
    expect(statTab.logsAgentId).toBe(0)
  })

  it('does NOT set logsAgentId when agentId is null', () => {
    const store = useTabsStore()
    const statTab = store.tabs.find(t => t.type === 'dashboard')!
    statTab.logsAgentId = 99 // pre-set

    store.addLogs(null)

    // null != null is false → should NOT update logsAgentId
    expect(statTab.logsAgentId).toBe(99)
  })

  it('does NOT set logsAgentId when agentId is undefined', () => {
    const store = useTabsStore()
    const statTab = store.tabs.find(t => t.type === 'dashboard')!
    statTab.logsAgentId = 55

    store.addLogs(undefined)

    expect(statTab.logsAgentId).toBe(55)
  })

  it('sets logsAgentId to provided positive value', () => {
    const store = useTabsStore()
    store.addLogs(42)

    const statTab = store.tabs.find(t => t.type === 'dashboard')!
    expect(statTab.logsAgentId).toBe(42)
  })
})


// ─── EqualityOperator: sameGroupTab ?? in closeTab terminal fallback ──────────
// Mutation target: priority 1 (sameGroupTab) vs priority 2 (otherTerminal)

describe('tabs — closeTab terminal fallback priority (EqualityOperator)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('prefers same-agent tab over other-agent terminal (priority 1 !== priority 2)', () => {
    const store = useTabsStore()
    store.addTerminal('group-a')
    store.addTerminal('group-a')
    store.addTerminal('group-b')

    const [a1, a2] = store.tabs.filter(t => t.agentName === 'group-a')
    store.setActive(a1.id)
    store.closeTab(a1.id)

    // Priority 1: another tab in same group (a2) — NOT group-b
    expect(store.activeTabId).toBe(a2.id)
  })

  it('falls to any terminal when no same-group tab remains (priority 2)', () => {
    const store = useTabsStore()
    store.addTerminal('solo-a')
    store.addTerminal('group-b')

    const soloA = store.tabs.find(t => t.agentName === 'solo-a')!
    const groupB = store.tabs.find(t => t.agentName === 'group-b')!
    store.setActive(soloA.id)
    store.closeTab(soloA.id)

    // No more solo-a tabs → falls to group-b (priority 2)
    expect(store.activeTabId).toBe(groupB.id)
  })

  it('falls to backlog when no terminals remain (priority 3)', () => {
    const store = useTabsStore()
    store.addTerminal('only')
    const tab = store.tabs.find(t => t.type === 'terminal')!
    store.setActive(tab.id)
    store.closeTab(tab.id)

    expect(store.activeTabId).toBe('backlog')
  })
})
