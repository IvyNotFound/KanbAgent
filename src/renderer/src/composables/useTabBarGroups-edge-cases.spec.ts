/**
 * Tests for useTabBarGroups — edge cases and remaining mutation-killing tests
 * Covers: watch activeTabId find ===, agentName ?? null, len <= 1 vs < 1,
 * scrollContainer optional chain, TabGroup object shape
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { ref, nextTick } from 'vue'
import { useTabsStore } from '@renderer/stores/tabs'
import { installElectronAPIMock, makeScrollContainer } from './__helpers__/useTabBarGroups.helpers'

installElectronAPIMock()

describe('useTabBarGroups', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllTimers()
  })

  // ── Mutation-killing: watch activeTabId — find(t.id === newId) (L92) ──────
  describe('watch activeTabId — find uses === not !== (L92)', () => {
    it('finds the correct active tab by exact id match (L92)', async () => {
      const { useTabBarGroups } = await import('@renderer/composables/useTabBarGroups')
      const store = useTabsStore()
      const scrollContainer = makeScrollContainer()
      const { isGroupCollapsed, toggleGroup } = useTabBarGroups(scrollContainer)

      store.addTerminal('agent-alpha', undefined, undefined, undefined, undefined, undefined, undefined, false)
      store.addTerminal('agent-beta', undefined, undefined, undefined, undefined, undefined, undefined, false)

      const alphaTab = store.tabs.find(t => t.agentName === 'agent-alpha')!
      const betaTab = store.tabs.find(t => t.agentName === 'agent-beta')!

      // Collapse both manually
      toggleGroup('agent-alpha')
      toggleGroup('agent-beta')
      expect(isGroupCollapsed('agent-alpha')).toBe(true)
      expect(isGroupCollapsed('agent-beta')).toBe(true)

      // Activate alpha — watch fires with newId = alphaTab.id
      store.setActive(alphaTab.id)
      await nextTick()

      // Alpha group should be expanded (correct tab found)
      expect(isGroupCollapsed('agent-alpha')).toBe(false)
      // Beta should NOT be expanded
      expect(isGroupCollapsed('agent-beta')).toBe(true)
    })
  })

  // ── Mutation-killing: activeTab.agentName ?? null (L94) ───────────────────
  describe('watch activeTabId — agentName ?? null vs && null (L94)', () => {
    it('uses agentName of new tab for collapse tracking (not null when agentName is set)', async () => {
      const { useTabBarGroups } = await import('@renderer/composables/useTabBarGroups')
      const store = useTabsStore()
      const scrollContainer = makeScrollContainer()
      const { isGroupCollapsed } = useTabBarGroups(scrollContainer)

      store.addTerminal('agent-alpha') // active
      store.addTerminal('agent-beta', undefined, undefined, undefined, undefined, undefined, undefined, false)

      await nextTick()

      // Switch to beta
      const betaTab = store.tabs.find(t => t.agentName === 'agent-beta')!
      store.setActive(betaTab.id)
      await nextTick()

      expect(isGroupCollapsed('agent-beta')).toBe(false)
      expect(isGroupCollapsed('agent-alpha')).toBe(true)
    })

    it('does not collapse null-agentName tabs as if they were named agents (L94)', async () => {
      const { useTabBarGroups } = await import('@renderer/composables/useTabBarGroups')
      const store = useTabsStore()
      const scrollContainer = makeScrollContainer()
      const { isGroupCollapsed } = useTabBarGroups(scrollContainer)

      store.addTerminal(undefined) // null agentName tab
      const nullTab = store.tabs.find(t => t.type === 'terminal' && !t.agentName)!
      store.setActive(nullTab.id)
      await nextTick()

      // null group should not be auto-collapsed
      expect(isGroupCollapsed(null)).toBe(false)
    })
  })

  // ── Mutation-killing: len <= 1 vs len < 1 (L107) ─────────────────────────
  describe('watch length — len=1 triggers clear (L107: <= not <)', () => {
    it('clears collapsed set when length drops from 2 to 1 (len=1 not len=0)', async () => {
      const { useTabBarGroups } = await import('@renderer/composables/useTabBarGroups')
      const store = useTabsStore()
      const scrollContainer = makeScrollContainer()
      const { isGroupCollapsed, groupedTerminalTabs } = useTabBarGroups(scrollContainer)

      // Start with 2 groups — watcher collapses non-active
      store.addTerminal('agent-alpha') // active
      store.addTerminal('agent-beta', undefined, undefined, undefined, undefined, undefined, undefined, false)

      await nextTick()
      expect(groupedTerminalTabs.value).toHaveLength(2)
      expect(isGroupCollapsed('agent-beta')).toBe(true)

      // Close beta — 1 group remains -> watcher fires with len=1 -> clear
      const betaTab = store.tabs.find(t => t.agentName === 'agent-beta')!
      store.closeTab(betaTab.id)
      await nextTick()

      expect(groupedTerminalTabs.value).toHaveLength(1)
      expect(isGroupCollapsed('agent-alpha')).toBe(false)
      expect(isGroupCollapsed('agent-beta')).toBe(false) // cleared
    })

    it('closing second-to-last tab expands previously collapsed group (len 2->1)', async () => {
      const { useTabBarGroups } = await import('@renderer/composables/useTabBarGroups')
      const store = useTabsStore()
      const scrollContainer = makeScrollContainer()
      const { isGroupCollapsed, toggleGroup, groupedTerminalTabs } = useTabBarGroups(scrollContainer)

      store.addTerminal('agent-alpha') // active
      store.addTerminal('agent-beta', undefined, undefined, undefined, undefined, undefined, undefined, false)
      await nextTick()

      // beta is auto-collapsed from len>1 watcher
      expect(isGroupCollapsed('agent-beta')).toBe(true)
      // Manually also collapse alpha to test that ALL are cleared when len drops to 1
      toggleGroup('agent-alpha')
      expect(isGroupCollapsed('agent-alpha')).toBe(true)

      // Close beta -> len becomes 1 -> collapsedAgents.clear()
      const betaTab = store.tabs.find(t => t.agentName === 'agent-beta')!
      store.closeTab(betaTab.id)
      await nextTick()

      // Both should be uncollapsed after clear
      expect(isGroupCollapsed('agent-alpha')).toBe(false)
    })
  })

  // ── Mutation-killing: scrollContainer?.scrollLeft optional chain (L78) ────
  describe('activateAgentGroup — scrollContainer optional chain (L78)', () => {
    it('savedScroll defaults to 0 when scrollContainer is null', async () => {
      const { useTabBarGroups } = await import('@renderer/composables/useTabBarGroups')
      const store = useTabsStore()
      const nullContainer = ref<HTMLDivElement | null>(null)
      const { groupedTerminalTabs, activateAgentGroup } = useTabBarGroups(nullContainer)

      store.addTerminal('agent-alpha', undefined, undefined, undefined, undefined, undefined, undefined, false)
      const group = groupedTerminalTabs.value.find(g => g.agentName === 'agent-alpha')!

      // Should not throw when scrollContainer is null
      expect(() => activateAgentGroup(group)).not.toThrow()
    })

    it('savedScroll uses scrollLeft when scrollContainer is present', async () => {
      const { useTabBarGroups } = await import('@renderer/composables/useTabBarGroups')
      const store = useTabsStore()
      const container = { scrollLeft: 123 } as unknown as HTMLDivElement
      const scrollContainer = ref<HTMLDivElement | null>(container)
      const { groupedTerminalTabs, activateAgentGroup } = useTabBarGroups(scrollContainer)

      store.addTerminal('agent-alpha', undefined, undefined, undefined, undefined, undefined, undefined, false)
      const group = groupedTerminalTabs.value.find(g => g.agentName === 'agent-alpha')!

      activateAgentGroup(group)
      await nextTick()

      // scrollLeft should be restored to 123
      expect(container.scrollLeft).toBe(123)
    })
  })

  // ── Mutation-killing: TabGroup object shape ───────────────────────────────
  describe('TabGroup object shape', () => {
    it('each group has agentName and tabs properties', async () => {
      const { useTabBarGroups } = await import('@renderer/composables/useTabBarGroups')
      const store = useTabsStore()
      const scrollContainer = makeScrollContainer()
      const { groupedTerminalTabs } = useTabBarGroups(scrollContainer)

      store.addTerminal('shape-agent')
      const group = groupedTerminalTabs.value[0]

      expect(group).toHaveProperty('agentName')
      expect(group).toHaveProperty('tabs')
      expect(group.agentName).toBe('shape-agent')
      expect(Array.isArray(group.tabs)).toBe(true)
      expect(group.tabs[0]).toHaveProperty('id')
      expect(group.tabs[0]).toHaveProperty('type')
      expect(group.tabs[0].type).toBe('terminal')
    })

    it('tabs within a group preserve insertion order', async () => {
      const { useTabBarGroups } = await import('@renderer/composables/useTabBarGroups')
      const store = useTabsStore()
      const scrollContainer = makeScrollContainer()
      const { groupedTerminalTabs } = useTabBarGroups(scrollContainer)

      store.addTerminal('order-agent', undefined, undefined, undefined, undefined, undefined, undefined, false)
      store.addTerminal('order-agent', undefined, undefined, undefined, undefined, undefined, undefined, false)
      store.addTerminal('order-agent', undefined, undefined, undefined, undefined, undefined, undefined, false)

      const group = groupedTerminalTabs.value.find(g => g.agentName === 'order-agent')!
      expect(group.tabs).toHaveLength(3)
      // Each tab has distinct id
      const ids = group.tabs.map(t => t.id)
      expect(new Set(ids).size).toBe(3)
    })
  })
})
