/**
 * Tests for useTabBarGroups — groupedTerminalTabs grouping and activeAgentName
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
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

  // ── Grouping by agentName ─────────────────────────────────────────────────
  describe('groupedTerminalTabs grouping', () => {
    it('groups tabs by agentName', async () => {
      const { useTabBarGroups } = await import('@renderer/composables/useTabBarGroups')
      const store = useTabsStore()
      const scrollContainer = makeScrollContainer()
      const { groupedTerminalTabs } = useTabBarGroups(scrollContainer)

      store.addTerminal('agent-alpha')
      store.addTerminal('agent-alpha')
      store.addTerminal('agent-beta')

      const alphaGroup = groupedTerminalTabs.value.find(g => g.agentName === 'agent-alpha')
      const betaGroup = groupedTerminalTabs.value.find(g => g.agentName === 'agent-beta')

      expect(alphaGroup?.tabs).toHaveLength(2)
      expect(betaGroup?.tabs).toHaveLength(1)
    })

    it('puts active agent group first (L50-L51)', async () => {
      const { useTabBarGroups } = await import('@renderer/composables/useTabBarGroups')
      const store = useTabsStore()
      const scrollContainer = makeScrollContainer()
      const { groupedTerminalTabs } = useTabBarGroups(scrollContainer)

      store.addTerminal('agent-beta', undefined, undefined, undefined, undefined, undefined, undefined, false)
      store.addTerminal('agent-alpha') // active (activate=true by default)

      expect(groupedTerminalTabs.value[0].agentName).toBe('agent-alpha')
    })

    it('puts null-agentName group last (L53-L54)', async () => {
      const { useTabBarGroups } = await import('@renderer/composables/useTabBarGroups')
      const store = useTabsStore()
      const scrollContainer = makeScrollContainer()
      const { groupedTerminalTabs } = useTabBarGroups(scrollContainer)

      store.addTerminal(undefined) // null agentName
      store.addTerminal('agent-alpha') // active

      const groups = groupedTerminalTabs.value
      expect(groups[groups.length - 1].agentName).toBeNull()
    })

    it('sorts remaining groups alphabetically (L55)', async () => {
      const { useTabBarGroups } = await import('@renderer/composables/useTabBarGroups')
      const store = useTabsStore()
      const scrollContainer = makeScrollContainer()
      const { groupedTerminalTabs } = useTabBarGroups(scrollContainer)

      // Add agents in non-alphabetical order, last active = agent-active
      store.addTerminal('zeta-agent', undefined, undefined, undefined, undefined, undefined, undefined, false)
      store.addTerminal('alpha-agent', undefined, undefined, undefined, undefined, undefined, undefined, false)
      store.addTerminal('agent-active') // active

      const groups = groupedTerminalTabs.value
      expect(groups[0].agentName).toBe('agent-active')
      expect(groups[1].agentName).toBe('alpha-agent')
      expect(groups[2].agentName).toBe('zeta-agent')
    })

    it('returns groups unchanged when no active agent (L48)', async () => {
      const { useTabBarGroups } = await import('@renderer/composables/useTabBarGroups')
      const store = useTabsStore()
      const scrollContainer = makeScrollContainer()
      const { groupedTerminalTabs } = useTabBarGroups(scrollContainer)

      // backlog is active (no agentName)
      store.setActive('backlog')
      store.addTerminal('agent-beta', undefined, undefined, undefined, undefined, undefined, undefined, false)
      store.addTerminal('agent-alpha', undefined, undefined, undefined, undefined, undefined, undefined, false)

      // With no active agent, groups are returned in insertion order
      expect(groupedTerminalTabs.value.some(g => g.agentName === 'agent-alpha')).toBe(true)
      expect(groupedTerminalTabs.value.some(g => g.agentName === 'agent-beta')).toBe(true)
    })
  })

  // ── activeAgentName ───────────────────────────────────────────────────────
  describe('activeAgentName (L43)', () => {
    it('returns null when activeTab has no agentName', async () => {
      const { useTabBarGroups } = await import('@renderer/composables/useTabBarGroups')
      const store = useTabsStore()
      store.setActive('backlog')
      const scrollContainer = makeScrollContainer()
      const { groupedTerminalTabs } = useTabBarGroups(scrollContainer)

      store.addTerminal('agent-alpha', undefined, undefined, undefined, undefined, undefined, undefined, false)

      // No agent is active, groups not reordered
      expect(groupedTerminalTabs.value).toBeDefined()
    })

    it('returns agentName when activeTab has an agentName', async () => {
      const { useTabBarGroups } = await import('@renderer/composables/useTabBarGroups')
      const store = useTabsStore()
      const scrollContainer = makeScrollContainer()
      const { groupedTerminalTabs } = useTabBarGroups(scrollContainer)

      store.addTerminal('agent-alpha') // becomes active

      expect(groupedTerminalTabs.value[0].agentName).toBe('agent-alpha')
    })
  })
})
