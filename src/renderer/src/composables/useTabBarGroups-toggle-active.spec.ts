/**
 * Tests for useTabBarGroups — toggleGroup, isGroupCollapsed, isGroupActive, activateAgentGroup
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

  // ── toggleGroup / isGroupCollapsed ────────────────────────────────────────
  describe('toggleGroup / isGroupCollapsed', () => {
    it('collapses a group that is expanded', async () => {
      const { useTabBarGroups } = await import('@renderer/composables/useTabBarGroups')
      const scrollContainer = makeScrollContainer()
      const { toggleGroup, isGroupCollapsed } = useTabBarGroups(scrollContainer)

      expect(isGroupCollapsed('agent-alpha')).toBe(false)
      toggleGroup('agent-alpha')
      expect(isGroupCollapsed('agent-alpha')).toBe(true)
    })

    it('expands a group that is collapsed', async () => {
      const { useTabBarGroups } = await import('@renderer/composables/useTabBarGroups')
      const scrollContainer = makeScrollContainer()
      const { toggleGroup, isGroupCollapsed } = useTabBarGroups(scrollContainer)

      toggleGroup('agent-alpha')
      expect(isGroupCollapsed('agent-alpha')).toBe(true)
      toggleGroup('agent-alpha')
      expect(isGroupCollapsed('agent-alpha')).toBe(false)
    })

    it('handles null agentName in toggle', async () => {
      const { useTabBarGroups } = await import('@renderer/composables/useTabBarGroups')
      const scrollContainer = makeScrollContainer()
      const { toggleGroup, isGroupCollapsed } = useTabBarGroups(scrollContainer)

      expect(isGroupCollapsed(null)).toBe(false)
      toggleGroup(null)
      expect(isGroupCollapsed(null)).toBe(true)
    })
  })

  // ── isGroupActive (L73) ───────────────────────────────────────────────────
  describe('isGroupActive (L73)', () => {
    it('returns true when a tab in the group matches activeTabId', async () => {
      const { useTabBarGroups } = await import('@renderer/composables/useTabBarGroups')
      const store = useTabsStore()
      const scrollContainer = makeScrollContainer()
      const { groupedTerminalTabs, isGroupActive } = useTabBarGroups(scrollContainer)

      store.addTerminal('agent-alpha')
      const group = groupedTerminalTabs.value.find(g => g.agentName === 'agent-alpha')!
      store.setActive(group.tabs[0].id)

      expect(isGroupActive(group)).toBe(true)
    })

    it('returns false when no tab in the group is active (L73 EqualityOperator)', async () => {
      const { useTabBarGroups } = await import('@renderer/composables/useTabBarGroups')
      const store = useTabsStore()
      const scrollContainer = makeScrollContainer()
      const { groupedTerminalTabs, isGroupActive } = useTabBarGroups(scrollContainer)

      store.addTerminal('agent-alpha', undefined, undefined, undefined, undefined, undefined, undefined, false)
      store.addTerminal('agent-beta') // active

      const group = groupedTerminalTabs.value.find(g => g.agentName === 'agent-alpha')!
      expect(isGroupActive(group)).toBe(false)
    })
  })

  // ── activateAgentGroup ────────────────────────────────────────────────────
  describe('activateAgentGroup', () => {
    it('does nothing when group has no tabs (L77)', async () => {
      const { useTabBarGroups } = await import('@renderer/composables/useTabBarGroups')
      const store = useTabsStore()
      const scrollContainer = makeScrollContainer()
      const { activateAgentGroup } = useTabBarGroups(scrollContainer)

      const initialActiveId = store.activeTabId
      activateAgentGroup({ agentName: 'agent-empty', tabs: [] })
      expect(store.activeTabId).toBe(initialActiveId)
    })

    it('expands collapsed group and sets first tab active (L79-L83)', async () => {
      const { useTabBarGroups } = await import('@renderer/composables/useTabBarGroups')
      const store = useTabsStore()
      const scrollContainer = makeScrollContainer()
      const { groupedTerminalTabs, isGroupCollapsed, toggleGroup, activateAgentGroup } = useTabBarGroups(scrollContainer)

      store.addTerminal('agent-alpha', undefined, undefined, undefined, undefined, undefined, undefined, false)
      store.addTerminal('agent-beta') // active -> triggers watch, alpha gets collapsed

      await nextTick()

      const alphaGroup = groupedTerminalTabs.value.find(g => g.agentName === 'agent-alpha')!
      // Manually collapse alpha to test
      if (!isGroupCollapsed('agent-alpha')) toggleGroup('agent-alpha')
      expect(isGroupCollapsed('agent-alpha')).toBe(true)

      activateAgentGroup(alphaGroup)
      expect(isGroupCollapsed('agent-alpha')).toBe(false)
      expect(store.activeTabId).toBe(alphaGroup.tabs[0].id)
    })

    it('does not call setActive when group is already active (L82)', async () => {
      const { useTabBarGroups } = await import('@renderer/composables/useTabBarGroups')
      const store = useTabsStore()
      const scrollContainer = makeScrollContainer()
      const { groupedTerminalTabs, activateAgentGroup } = useTabBarGroups(scrollContainer)

      store.addTerminal('agent-alpha')
      const alphaGroup = groupedTerminalTabs.value.find(g => g.agentName === 'agent-alpha')!
      store.setActive(alphaGroup.tabs[0].id)

      const setActiveSpy = vi.spyOn(store, 'setActive')
      activateAgentGroup(alphaGroup)
      expect(setActiveSpy).not.toHaveBeenCalled()
    })

    it('restores scrollLeft after nextTick (L85-L87)', async () => {
      const { useTabBarGroups } = await import('@renderer/composables/useTabBarGroups')
      const store = useTabsStore()
      const container = { scrollLeft: 42 } as unknown as HTMLDivElement
      const scrollContainer = ref<HTMLDivElement | null>(container)
      const { groupedTerminalTabs, activateAgentGroup } = useTabBarGroups(scrollContainer)

      store.addTerminal('agent-alpha', undefined, undefined, undefined, undefined, undefined, undefined, false)
      const alphaGroup = groupedTerminalTabs.value.find(g => g.agentName === 'agent-alpha')!

      activateAgentGroup(alphaGroup)
      await nextTick()

      expect(container.scrollLeft).toBe(42)
    })
  })
})
