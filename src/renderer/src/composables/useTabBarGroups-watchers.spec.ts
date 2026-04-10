/**
 * Tests for useTabBarGroups — watch activeTabId and watch groupedTerminalTabs.length
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { nextTick } from 'vue'
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

  // ── watch activeTabId (L91-L103) ──────────────────────────────────────────
  describe('watch activeTabId — auto-expand/collapse', () => {
    it('expands the group of the new active tab (L95)', async () => {
      const { useTabBarGroups } = await import('@renderer/composables/useTabBarGroups')
      const store = useTabsStore()
      const scrollContainer = makeScrollContainer()
      const { isGroupCollapsed, toggleGroup } = useTabBarGroups(scrollContainer)

      store.addTerminal('agent-alpha')
      // Manually collapse alpha
      toggleGroup('agent-alpha')
      expect(isGroupCollapsed('agent-alpha')).toBe(true)

      // Activate a tab in agent-alpha
      const alphaTab = store.tabs.find(t => t.agentName === 'agent-alpha')!
      store.setActive(alphaTab.id)
      await nextTick()

      expect(isGroupCollapsed('agent-alpha')).toBe(false)
    })

    it('collapses old agent group when switching to a different agent (L99-L101)', async () => {
      const { useTabBarGroups } = await import('@renderer/composables/useTabBarGroups')
      const store = useTabsStore()
      const scrollContainer = makeScrollContainer()
      const { isGroupCollapsed } = useTabBarGroups(scrollContainer)

      store.addTerminal('agent-alpha') // active
      store.addTerminal('agent-beta', undefined, undefined, undefined, undefined, undefined, undefined, false)

      await nextTick()

      // Switch active to beta
      const betaTab = store.tabs.find(t => t.agentName === 'agent-beta')!
      store.setActive(betaTab.id)
      await nextTick()

      // Alpha should be collapsed
      expect(isGroupCollapsed('agent-alpha')).toBe(true)
    })

    it('does not collapse null agentName old group (L99 condition)', async () => {
      const { useTabBarGroups } = await import('@renderer/composables/useTabBarGroups')
      const store = useTabsStore()
      const scrollContainer = makeScrollContainer()
      const { isGroupCollapsed } = useTabBarGroups(scrollContainer)

      // Start from backlog (null agentName), then switch to agent-alpha terminal
      store.addTerminal('agent-alpha', undefined, undefined, undefined, undefined, undefined, undefined, false)
      store.setActive('backlog')
      await nextTick()

      const alphaTab = store.tabs.find(t => t.agentName === 'agent-alpha')!
      store.setActive(alphaTab.id)
      await nextTick()

      // null group should NOT be collapsed (L99: oldAgentName !== null required)
      expect(isGroupCollapsed(null)).toBe(false)
    })
  })

  // ── watch groupedTerminalTabs.length (L106-L114) ──────────────────────────
  describe('watch groupedTerminalTabs.length', () => {
    it('clears collapsedAgents when len <= 1 (L107)', async () => {
      const { useTabBarGroups } = await import('@renderer/composables/useTabBarGroups')
      const store = useTabsStore()
      const scrollContainer = makeScrollContainer()
      const { isGroupCollapsed, collapsedAgents } = useTabBarGroups(scrollContainer)

      // With 0 terminal tabs, len = 0 — clear is called immediately (immediate: true)
      expect(collapsedAgents.value.size).toBe(0)
    })

    it('collapses non-active agents when len > 1 (L109-L113)', async () => {
      const { useTabBarGroups } = await import('@renderer/composables/useTabBarGroups')
      const store = useTabsStore()
      const scrollContainer = makeScrollContainer()
      const { isGroupCollapsed } = useTabBarGroups(scrollContainer)

      store.addTerminal('agent-alpha') // active
      store.addTerminal('agent-beta', undefined, undefined, undefined, undefined, undefined, undefined, false)

      await nextTick()

      expect(isGroupCollapsed('agent-beta')).toBe(true)
      expect(isGroupCollapsed('agent-alpha')).toBe(false)
    })

    it('collapses all non-active when 3 groups (L109-L113)', async () => {
      const { useTabBarGroups } = await import('@renderer/composables/useTabBarGroups')
      const store = useTabsStore()
      const scrollContainer = makeScrollContainer()
      const { isGroupCollapsed } = useTabBarGroups(scrollContainer)

      store.addTerminal('agent-alpha') // active
      store.addTerminal('agent-beta', undefined, undefined, undefined, undefined, undefined, undefined, false)
      store.addTerminal('agent-gamma', undefined, undefined, undefined, undefined, undefined, undefined, false)

      await nextTick()

      expect(isGroupCollapsed('agent-beta')).toBe(true)
      expect(isGroupCollapsed('agent-gamma')).toBe(true)
      expect(isGroupCollapsed('agent-alpha')).toBe(false)
    })
  })
})
