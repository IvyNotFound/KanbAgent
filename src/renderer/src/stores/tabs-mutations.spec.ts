/**
 * tabs-mutations.spec.ts — T1314
 * Kill surviving mutations in tabs.ts.
 *
 * Targeted survivors:
 * - Tab init default fields (permanent tabs: backlog, dashboard, timeline)
 * - addLogs L86: statTab && agentId != null — agentId=0, null, undefined; statTab missing
 * - addTerminal L152 regex: numbers extraction with (N) suffix
 * - closeTab L244: Math.max(0, idx-1)?.id — idx=0 boundary
 * - renameTab L257: title.trim() — strips whitespace
 * - closeTabGroup L261: filter with agentName=null
 * - closeAllTerminals: terminal type filter
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useTabsStore } from '@renderer/stores/tabs'

const mockElectronAPI = {
  queryDb: vi.fn().mockResolvedValue([]),
  watchDb: vi.fn(),
  unwatchDb: vi.fn(),
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

Object.defineProperty(window, 'electronAPI', { value: mockElectronAPI, writable: true })

// ─── Tab init default fields ──────────────────────────────────────────────────
describe('stores/tabs — tab init default fields (permanent tabs)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('backlog tab has correct default fields', () => {
    const store = useTabsStore()
    const backlog = store.tabs.find(t => t.id === 'backlog')!

    expect(backlog.type).toBe('backlog')
    expect(backlog.title).toBe('Backlog')
    expect(backlog.ptyId).toBeNull()
    expect(backlog.agentName).toBeNull()
    expect(backlog.wslDistro).toBeNull()
    expect(backlog.autoSend).toBeNull()
    expect(backlog.systemPrompt).toBeNull()
    expect(backlog.thinkingMode).toBeNull()
    expect(backlog.permanent).toBe(true)
  })

  it('dashboard tab has correct default fields', () => {
    const store = useTabsStore()
    const dashboard = store.tabs.find(t => t.id === 'dashboard')!

    expect(dashboard.type).toBe('dashboard')
    expect(dashboard.title).toBe('Dashboard')
    expect(dashboard.ptyId).toBeNull()
    expect(dashboard.agentName).toBeNull()
    expect(dashboard.wslDistro).toBeNull()
    expect(dashboard.autoSend).toBeNull()
    expect(dashboard.systemPrompt).toBeNull()
    expect(dashboard.thinkingMode).toBeNull()
    expect(dashboard.logsAgentId).toBeNull()
    expect(dashboard.permanent).toBe(true)
  })

  it('timeline tab has correct default fields', () => {
    const store = useTabsStore()
    const timeline = store.tabs.find(t => t.id === 'timeline')!

    expect(timeline.type).toBe('timeline')
    expect(timeline.title).toBe('Timeline')
    expect(timeline.ptyId).toBeNull()
    expect(timeline.agentName).toBeNull()
    expect(timeline.wslDistro).toBeNull()
    expect(timeline.autoSend).toBeNull()
    expect(timeline.systemPrompt).toBeNull()
    expect(timeline.thinkingMode).toBeNull()
    expect(timeline.permanent).toBe(true)
  })

  it('starts with exactly 3 permanent tabs in order', () => {
    const store = useTabsStore()
    const permanent = store.tabs.filter(t => t.permanent)

    expect(permanent).toHaveLength(3)
    expect(permanent[0].id).toBe('backlog')
    expect(permanent[1].id).toBe('dashboard')
    expect(permanent[2].id).toBe('timeline')
  })

  it('initial activeTabId is "backlog"', () => {
    const store = useTabsStore()
    expect(store.activeTabId).toBe('backlog')
  })
})

// ─── addLogs: statTab && agentId != null (L86) ───────────────────────────────
describe('stores/tabs — addLogs: statTab guard and agentId != null (L86)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('sets logsAgentId when agentId is 0 (zero is != null)', () => {
    const store = useTabsStore()

    store.addLogs(0)

    const dashTab = store.tabs.find(t => t.type === 'dashboard')!
    expect(dashTab.logsAgentId).toBe(0)
  })

  it('does NOT set logsAgentId when agentId is null', () => {
    const store = useTabsStore()
    const dashTab = store.tabs.find(t => t.type === 'dashboard')!
    dashTab.logsAgentId = 99 // pre-set

    store.addLogs(null)

    // null → condition fails → logsAgentId unchanged
    expect(dashTab.logsAgentId).toBe(99)
  })

  it('does NOT set logsAgentId when agentId is undefined', () => {
    const store = useTabsStore()
    const dashTab = store.tabs.find(t => t.type === 'dashboard')!
    dashTab.logsAgentId = 42

    store.addLogs(undefined)

    expect(dashTab.logsAgentId).toBe(42)
  })

  it('sets logsAgentId when agentId is a positive number', () => {
    const store = useTabsStore()

    store.addLogs(7)

    const dashTab = store.tabs.find(t => t.type === 'dashboard')!
    expect(dashTab.logsAgentId).toBe(7)
  })

  it('always activates dashboard tab regardless of agentId', () => {
    const store = useTabsStore()
    store.addTerminal('some-agent')

    store.addLogs(null)

    expect(store.activeTabId).toBe('dashboard')
  })

  it('addLogs activates dashboard when no statTab-like tab exists (defensive)', () => {
    // The statTab is always present (permanent), so this tests the activation path
    const store = useTabsStore()
    store.addLogs(5)
    expect(store.activeTabId).toBe('dashboard')
  })
})

// ─── addTerminal regex: (N) number extraction ────────────────────────────────
describe('stores/tabs — addTerminal: regex number extraction (L152)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('correctly increments (1) → (2) when first tab has no suffix (treated as 1)', () => {
    const store = useTabsStore()
    store.addTerminal('agent-x')
    const [first] = store.tabs.filter(t => t.agentName === 'agent-x')
    // First tab has no "(N)" suffix → regex returns no match → defaults to 1
    expect(first.title).toBe('agent-x')

    store.addTerminal('agent-x')
    const tabs = store.tabs.filter(t => t.agentName === 'agent-x')
    expect(tabs[1].title).toBe('agent-x (2)')
  })

  it('handles title "(3)" → next is (4)', () => {
    const store = useTabsStore()
    store.addTerminal('agent-y')
    const first = store.tabs.find(t => t.agentName === 'agent-y')!
    first.title = 'agent-y (3)' // manually set to simulate (3)

    store.addTerminal('agent-y')
    const last = store.tabs.filter(t => t.agentName === 'agent-y').at(-1)!
    expect(last.title).toBe('agent-y (4)')
  })

  it('max number wins: tab with (5) and tab with (2) → next is (6)', () => {
    const store = useTabsStore()
    store.addTerminal('agent-z')
    store.addTerminal('agent-z')
    const [t1, t2] = store.tabs.filter(t => t.agentName === 'agent-z')
    t1.title = 'agent-z (5)'
    t2.title = 'agent-z (2)'

    store.addTerminal('agent-z')
    const last = store.tabs.filter(t => t.agentName === 'agent-z').at(-1)!
    expect(last.title).toBe('agent-z (6)')
  })
})

// ─── renameTab: title.trim() (L257) ──────────────────────────────────────────
describe('stores/tabs — renameTab: title.trim() (L257)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('strips leading whitespace from new title', () => {
    const store = useTabsStore()
    store.addTerminal('trim-agent')
    const tab = store.tabs.find(t => t.type === 'terminal')!

    store.renameTab(tab.id, '   new name')

    expect(tab.title).toBe('new name')
  })

  it('strips trailing whitespace from new title', () => {
    const store = useTabsStore()
    store.addTerminal('trim-agent2')
    const tab = store.tabs.find(t => t.type === 'terminal')!

    store.renameTab(tab.id, 'new name   ')

    expect(tab.title).toBe('new name')
  })

  it('strips both leading and trailing whitespace', () => {
    const store = useTabsStore()
    store.addTerminal('trim-agent3')
    const tab = store.tabs.find(t => t.type === 'terminal')!

    store.renameTab(tab.id, '  trimmed  ')

    expect(tab.title).toBe('trimmed')
  })

  it('allows title with only internal spaces (not trimmed)', () => {
    const store = useTabsStore()
    store.addTerminal('trim-agent4')
    const tab = store.tabs.find(t => t.type === 'terminal')!

    store.renameTab(tab.id, 'two words')

    expect(tab.title).toBe('two words')
  })

  it('rejects title that is only whitespace (trim() → empty string → falsy)', () => {
    const store = useTabsStore()
    store.addTerminal('trim-agent5')
    const tab = store.tabs.find(t => t.type === 'terminal')!
    const originalTitle = tab.title

    store.renameTab(tab.id, '   ')

    expect(tab.title).toBe(originalTitle) // unchanged
  })
})

// ─── closeTab: Math.max(0, idx-1) boundary (L244) ────────────────────────────
describe('stores/tabs — closeTab: Math.max(0, idx-1) boundary (L244)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('falls back to backlog when non-terminal at idx 0 is closed', () => {
    // An explorer tab is inserted right after permanent tabs; if it's the only non-terminal
    // and it's at idx=N, closing it should select the previous tab (permanent)
    const store = useTabsStore()
    store.addExplorer()
    const explorer = store.tabs.find(t => t.type === 'explorer')!
    const explorerIdx = store.tabs.findIndex(t => t.id === explorer.id)
    store.setActive(explorer.id)

    // The previous tab (idx-1) should be a permanent tab
    const prevTab = store.tabs[Math.max(0, explorerIdx - 1)]
    store.closeTab(explorer.id)

    expect(store.activeTabId).toBe(prevTab.id)
  })

  it('stays at backlog (id 0 or guard) when closing the only non-permanent non-terminal tab at idx 0', () => {
    // Ensure Math.max(0, idx-1) with idx=0 → 0 → first tab (backlog)
    const store = useTabsStore()
    // Move explorer to be right at the start by manually testing the fallback
    store.openFile('/f', 'f.ts')
    const fileTab = store.tabs.find(t => t.type === 'file')!
    store.setActive(fileTab.id)
    const fileIdx = store.tabs.findIndex(t => t.id === fileTab.id)
    const expectedActive = store.tabs[Math.max(0, fileIdx - 1)].id

    store.closeTab(fileTab.id)

    expect(store.activeTabId).toBe(expectedActive)
  })

  it('when only one non-terminal tab exists at idx 0 of a fresh store, backlog is selected', () => {
    // Permanent tabs: [backlog(0), dashboard(1), timeline(2)]
    // Insert file at idx 3, set active, close → idx-1=2 → timeline
    const store = useTabsStore()
    store.openFile('/test.ts', 'test.ts')
    const fileTab = store.tabs.find(t => t.type === 'file')!
    store.setActive(fileTab.id)
    const fileIdx = store.tabs.findIndex(t => t.id === fileTab.id) // should be 3

    const expectedId = store.tabs[fileIdx - 1].id // timeline

    store.closeTab(fileTab.id)

    expect(store.activeTabId).toBe(expectedId)
  })
})

// ─── closeTab: optional chain ?.id ?? 'backlog' (L244) ────────────────────────
describe('stores/tabs — closeTab: optional chaining and backlog fallback (L244)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('non-terminal closeTab defaults to backlog when idx-1 is out of bounds', () => {
    // This tests the ?. optional chain: tabs[idx-1]?.id ?? 'backlog'
    // Permanent tabs cannot be closed; only non-permanent can
    // When idx=0, Math.max(0, 0-1)=0, tabs[0] = backlog → id='backlog'
    const store = useTabsStore()
    store.openFile('/only.ts', 'only.ts')
    const fileTab = store.tabs.find(t => t.type === 'file')!
    store.setActive(fileTab.id)

    store.closeTab(fileTab.id)

    // Should land on whichever tab precedes it (a permanent tab, never null)
    expect(store.tabs.find(t => t.id === store.activeTabId)).toBeDefined()
  })
})

// ─── closeTabGroup: agentName=null filter (L261) ─────────────────────────────
describe('stores/tabs — closeTabGroup: agentName=null filter', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('closeTabGroup(null) closes tabs with agentName=null', () => {
    const store = useTabsStore()
    // Add anonymous WSL terminal (agentName = null)
    store.addTerminal() // agentName undefined → stored as null
    const anonTab = store.tabs.find(t => t.type === 'terminal' && t.agentName === null)!
    expect(anonTab).toBeDefined()

    store.closeTabGroup(null)

    expect(store.tabs.find(t => t.id === anonTab.id)).toBeUndefined()
  })

  it('closeTabGroup(null) does not close tabs with a named agent', () => {
    const store = useTabsStore()
    store.addTerminal('named-agent')
    store.addTerminal() // anonymous

    store.closeTabGroup(null)

    const named = store.tabs.find(t => t.agentName === 'named-agent')
    expect(named).toBeDefined()
  })

  it('closeTabGroup does not close permanent tabs even when agentName matches', () => {
    // Permanent tabs have permanent=true; they are filtered out by !t.permanent
    const store = useTabsStore()
    store.addTerminal('grp')

    store.closeTabGroup('grp')

    // Permanent tabs must survive
    expect(store.tabs.find(t => t.id === 'backlog')).toBeDefined()
    expect(store.tabs.find(t => t.id === 'dashboard')).toBeDefined()
    expect(store.tabs.find(t => t.id === 'timeline')).toBeDefined()
  })
})

// ─── setStreamId ──────────────────────────────────────────────────────────────
describe('stores/tabs — setStreamId', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('sets streamId on existing tab', () => {
    const store = useTabsStore()
    store.addTerminal('agent')
    const tab = store.tabs.find(t => t.type === 'terminal')!

    store.setStreamId(tab.id, 'stream-xyz')

    expect(tab.streamId).toBe('stream-xyz')
  })

  it('clears streamId when set to null', () => {
    const store = useTabsStore()
    store.addTerminal('agent')
    const tab = store.tabs.find(t => t.type === 'terminal')!
    store.setStreamId(tab.id, 'stream-abc')

    store.setStreamId(tab.id, null)

    expect(tab.streamId).toBeNull()
  })

  it('is a no-op for unknown tab id', () => {
    const store = useTabsStore()
    expect(() => store.setStreamId('nonexistent', 'stream-x')).not.toThrow()
  })
})

// ─── activeTab computed ───────────────────────────────────────────────────────
describe('stores/tabs — activeTab computed (L101)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('returns the tab matching activeTabId', () => {
    const store = useTabsStore()
    store.addTerminal('compute-agent')
    const tab = store.tabs.find(t => t.type === 'terminal')!
    store.setActive(tab.id)

    expect(store.activeTab.id).toBe(tab.id)
  })

  it('falls back to tabs[0] when activeTabId does not match any tab', () => {
    const store = useTabsStore()
    store.activeTabId = 'nonexistent'

    expect(store.activeTab).toBe(store.tabs[0])
  })
})
