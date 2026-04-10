/**
 * Tests for useTabBarGroups — mutation-killing tests and edge cases
 * Covers: subTabLabel, len<=1 edge, sort comparator, isGroupActive some/every,
 * agentTabStyleMap some/every, watch activeTabId find/agentName, len<=1 vs <1,
 * scrollContainer optional chain, TabGroup shape
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

  // ── subTabLabel (L172-L174) ───────────────────────────────────────────────
  describe('subTabLabel (L172-L174)', () => {
    it('returns #taskId when taskId is set', async () => {
      const { useTabBarGroups } = await import('@renderer/composables/useTabBarGroups')
      const store = useTabsStore()
      const scrollContainer = makeScrollContainer()
      const { subTabLabel } = useTabBarGroups(scrollContainer)

      store.addTerminal('agent-alpha', undefined, undefined, undefined, undefined, undefined, undefined, true, 42)
      const tab = store.tabs.find(t => t.agentName === 'agent-alpha')!

      expect(subTabLabel(tab)).toBe('#42')
    })

    it('returns tab.title when taskId is not set', async () => {
      const { useTabBarGroups } = await import('@renderer/composables/useTabBarGroups')
      const store = useTabsStore()
      const scrollContainer = makeScrollContainer()
      const { subTabLabel } = useTabBarGroups(scrollContainer)

      store.addTerminal('agent-alpha')
      const tab = store.tabs.find(t => t.agentName === 'agent-alpha')!

      expect(subTabLabel(tab)).toBe(tab.title)
    })

    it('returns tab.title when taskId is null (L173 — no taskId branch)', async () => {
      const { useTabBarGroups } = await import('@renderer/composables/useTabBarGroups')
      const store = useTabsStore()
      const scrollContainer = makeScrollContainer()
      const { subTabLabel } = useTabBarGroups(scrollContainer)

      store.addTerminal('agent-alpha')
      const tab = store.tabs.find(t => t.agentName === 'agent-alpha')!
      tab.taskId = null

      expect(subTabLabel(tab)).toBe(tab.title)
    })
  })

  // ── len <= 1 edge case ────────────────────────────────────────────────────
  describe('watch length — len=1 clears collapsedAgents (L107)', () => {
    it('clears collapsed set when only 1 group remains', async () => {
      const { useTabBarGroups } = await import('@renderer/composables/useTabBarGroups')
      const store = useTabsStore()
      const scrollContainer = makeScrollContainer()
      const { isGroupCollapsed, toggleGroup, groupedTerminalTabs } = useTabBarGroups(scrollContainer)

      store.addTerminal('agent-alpha')
      store.addTerminal('agent-beta', undefined, undefined, undefined, undefined, undefined, undefined, false)

      await nextTick()
      expect(isGroupCollapsed('agent-beta')).toBe(true)

      // Close beta — only 1 group left -> collapsedAgents cleared
      const betaTab = store.tabs.find(t => t.agentName === 'agent-beta')!
      store.closeTab(betaTab.id)

      await nextTick()

      expect(groupedTerminalTabs.value).toHaveLength(1)
      expect(isGroupCollapsed('agent-alpha')).toBe(false)
    })
  })

  // ── Mutation-killing: sort comparator operators ───────────────────────────
  describe('sort comparator — operator boundaries (L51-L54)', () => {
    it('sort: a is active -> returns -1, placing it first (not 1)', async () => {
      const { useTabBarGroups } = await import('@renderer/composables/useTabBarGroups')
      const store = useTabsStore()
      const scrollContainer = makeScrollContainer()
      const { groupedTerminalTabs } = useTabBarGroups(scrollContainer)

      store.addTerminal('gamma-agent', undefined, undefined, undefined, undefined, undefined, undefined, false)
      store.addTerminal('alpha-agent') // active

      const groups = groupedTerminalTabs.value
      expect(groups[0].agentName).toBe('alpha-agent')
      expect(groups[1].agentName).toBe('gamma-agent')
    })

    it('sort: b is active -> b moves first, a moves after (L52)', async () => {
      const { useTabBarGroups } = await import('@renderer/composables/useTabBarGroups')
      const store = useTabsStore()
      const scrollContainer = makeScrollContainer()
      const { groupedTerminalTabs } = useTabBarGroups(scrollContainer)

      store.addTerminal('zzz-agent', undefined, undefined, undefined, undefined, undefined, undefined, false)
      store.addTerminal('aaa-agent', undefined, undefined, undefined, undefined, undefined, undefined, false)
      store.addTerminal('mid-agent') // active

      const groups = groupedTerminalTabs.value
      expect(groups[0].agentName).toBe('mid-agent')
      expect(groups[1].agentName).toBe('aaa-agent')
      expect(groups[2].agentName).toBe('zzz-agent')
    })

    it('sort: null agentName group is placed after named non-active groups (L53-L54)', async () => {
      const { useTabBarGroups } = await import('@renderer/composables/useTabBarGroups')
      const store = useTabsStore()
      const scrollContainer = makeScrollContainer()
      const { groupedTerminalTabs } = useTabBarGroups(scrollContainer)

      store.addTerminal(undefined) // null agentName
      store.addTerminal('zzz-agent', undefined, undefined, undefined, undefined, undefined, undefined, false)
      store.addTerminal('aaa-agent') // active

      const groups = groupedTerminalTabs.value
      expect(groups[0].agentName).toBe('aaa-agent')
      expect(groups[1].agentName).toBe('zzz-agent')
      expect(groups[groups.length - 1].agentName).toBeNull()
    })

    it('sort: a is null -> a goes after b when b is not null (L53)', async () => {
      const { useTabBarGroups } = await import('@renderer/composables/useTabBarGroups')
      const store = useTabsStore()
      const scrollContainer = makeScrollContainer()
      const { groupedTerminalTabs } = useTabBarGroups(scrollContainer)

      store.addTerminal(undefined) // null agentName
      store.addTerminal('zzz-agent', undefined, undefined, undefined, undefined, undefined, undefined, false)
      store.addTerminal('beta-agent') // active

      const groups = groupedTerminalTabs.value
      expect(groups[groups.length - 1].agentName).toBeNull()
      const zzzIdx = groups.findIndex(g => g.agentName === 'zzz-agent')
      const nullIdx = groups.findIndex(g => g.agentName === null)
      expect(zzzIdx).toBeLessThan(nullIdx)
    })
  })

  // ── Mutation-killing: isGroupActive every vs some (L73) ───────────────────
  describe('isGroupActive — some vs every distinction (L73)', () => {
    it('returns true when only 1 of 2 tabs in group is active (some not every)', async () => {
      const { useTabBarGroups } = await import('@renderer/composables/useTabBarGroups')
      const store = useTabsStore()
      const scrollContainer = makeScrollContainer()
      const { groupedTerminalTabs, isGroupActive } = useTabBarGroups(scrollContainer)

      store.addTerminal('agent-alpha', undefined, undefined, undefined, undefined, undefined, undefined, false)
      store.addTerminal('agent-alpha', undefined, undefined, undefined, undefined, undefined, undefined, false)

      const group = groupedTerminalTabs.value.find(g => g.agentName === 'agent-alpha')!
      expect(group.tabs).toHaveLength(2)

      store.setActive(group.tabs[0].id)

      expect(isGroupActive(group)).toBe(true)
    })

    it('returns false when no tab in group is active (L73)', async () => {
      const { useTabBarGroups } = await import('@renderer/composables/useTabBarGroups')
      const store = useTabsStore()
      const scrollContainer = makeScrollContainer()
      const { groupedTerminalTabs, isGroupActive } = useTabBarGroups(scrollContainer)

      store.addTerminal('agent-alpha', undefined, undefined, undefined, undefined, undefined, undefined, false)
      store.addTerminal('agent-alpha', undefined, undefined, undefined, undefined, undefined, undefined, false)
      store.addTerminal('agent-beta') // active

      const group = groupedTerminalTabs.value.find(g => g.agentName === 'agent-alpha')!
      expect(isGroupActive(group)).toBe(false)
    })
  })

  // ── Mutation-killing: agentTabStyleMap L150 every vs some ─────────────────
  describe('agentTabStyleMap — some vs every for group active check (L150)', () => {
    it('applies active styles when only 1 of 2 tabs in group is active (L150 some)', async () => {
      const { useTabBarGroups } = await import('@renderer/composables/useTabBarGroups')
      const { agentFg, agentBg, setDarkMode } = await import('@renderer/utils/agentColor')
      const store = useTabsStore()
      const scrollContainer = makeScrollContainer()
      const { agentTabStyleMap } = useTabBarGroups(scrollContainer)

      setDarkMode(true)
      store.addTerminal('agent-multi', undefined, undefined, undefined, undefined, undefined, undefined, false)
      store.addTerminal('agent-multi', undefined, undefined, undefined, undefined, undefined, undefined, false)

      const multiTabs = store.tabs.filter(t => t.agentName === 'agent-multi')
      store.setActive(multiTabs[0].id)

      const style = agentTabStyleMap.value.get('agent-multi')
      expect(style).toEqual({ color: agentFg('agent-multi'), backgroundColor: agentBg('agent-multi') })
    })

    it('applies inactive styles when 0 of 2 tabs in group is active (L150 some=false)', async () => {
      const { useTabBarGroups } = await import('@renderer/composables/useTabBarGroups')
      const { agentFg, agentBg, setDarkMode } = await import('@renderer/utils/agentColor')
      const store = useTabsStore()
      const scrollContainer = makeScrollContainer()
      const { agentTabStyleMap } = useTabBarGroups(scrollContainer)

      setDarkMode(true)
      store.addTerminal('agent-multi', undefined, undefined, undefined, undefined, undefined, undefined, false)
      store.addTerminal('agent-multi', undefined, undefined, undefined, undefined, undefined, undefined, false)
      store.addTerminal('agent-other') // active

      await nextTick()

      const style = agentTabStyleMap.value.get('agent-multi')
      expect(style).toEqual({
        color: agentFg('agent-multi'),
        backgroundColor: agentBg('agent-multi'),
        opacity: '0.65',
      })
    })
  })
})
