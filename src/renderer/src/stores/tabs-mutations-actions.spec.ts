/**
 * tabs-mutations-actions.spec.ts
 * Split from tabs-mutations.spec.ts — covers:
 * - openFile: existing file detection (L130 ConditionalExpression + L132 StringLiteral)
 * - addLogs: LogicalOperator (L139 statTab && agentId != null)
 * - addTerminal: same-agent filter LogicalOperator (L147)
 * - setStreamId: tab existence guard (L199 ConditionalExpression)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useTabsStore } from '@renderer/stores/tabs'
import { installMockElectronAPI } from './__helpers__/tabs-mutations.helpers'

installMockElectronAPI()


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
