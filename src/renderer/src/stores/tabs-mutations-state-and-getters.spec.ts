/**
 * tabs-mutations-state-and-getters.spec.ts
 * Split from tabs-mutations.spec.ts — covers:
 * - Initial state shape (L67-69 StringLiterals + L71 activeTabId)
 * - addExplorer: existing tab detection (L86 ConditionalExpression + L113 StringLiteral)
 * - isAgentActive type guard (L94 ConditionalExpression)
 * - hasAgentTerminal type guard (L98 ConditionalExpression)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useTabsStore } from '@renderer/stores/tabs'
import { installMockElectronAPI } from './__helpers__/tabs-mutations.helpers'

installMockElectronAPI()


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

  it('has exactly 2 permanent tabs initially (backlog + dashboard)', () => {
    const store = useTabsStore()
    const permanentTabs = store.tabs.filter(t => t.permanent)
    expect(permanentTabs).toHaveLength(2)
  })

  it('activeTabId is "backlog" initially (not empty string, L71 StringLiteral)', () => {
    const store = useTabsStore()
    expect(store.activeTabId).toBe('backlog')
    expect(store.activeTabId).not.toBe('')
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
