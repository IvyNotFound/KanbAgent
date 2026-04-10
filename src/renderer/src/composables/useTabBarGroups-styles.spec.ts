/**
 * Tests for useTabBarGroups — tabStyleMap, agentTabStyleMap, indicatorStyleMap
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

  // ── tabStyleMap ───────────────────────────────────────────────────────────
  describe('tabStyleMap (L118-L138)', () => {
    it('returns empty object for inactive tab without agentName', async () => {
      const { useTabBarGroups } = await import('@renderer/composables/useTabBarGroups')
      const store = useTabsStore()
      const scrollContainer = makeScrollContainer()
      const { tabStyleMap } = useTabBarGroups(scrollContainer)

      store.addTerminal(undefined) // null agentName
      const nullTab = store.tabs.find(t => t.type === 'terminal')!
      // Make another tab active so this one is inactive
      store.addTerminal('agent-beta')

      const style = tabStyleMap.value.get(nullTab.id)
      expect(style).toEqual({})
    })

    it('returns CSS var styles for active tab without agentName', async () => {
      const { useTabBarGroups } = await import('@renderer/composables/useTabBarGroups')
      const { setDarkMode } = await import('@renderer/utils/agentColor')
      const store = useTabsStore()
      const scrollContainer = makeScrollContainer()
      const { tabStyleMap } = useTabBarGroups(scrollContainer)

      setDarkMode(true)
      store.addTerminal(undefined) // null agentName, active
      const nullTab = store.tabs.find(t => t.type === 'terminal')!
      store.setActive(nullTab.id)

      const style = tabStyleMap.value.get(nullTab.id)
      expect(style).toEqual({ color: 'rgb(var(--v-theme-on-surface))', backgroundColor: 'rgb(var(--v-theme-surface-variant))' })
    })

    it('returns agent colors for active terminal tab with agentName', async () => {
      const { useTabBarGroups } = await import('@renderer/composables/useTabBarGroups')
      const { agentFg, agentBg, setDarkMode } = await import('@renderer/utils/agentColor')
      const store = useTabsStore()
      const scrollContainer = makeScrollContainer()
      const { tabStyleMap } = useTabBarGroups(scrollContainer)

      setDarkMode(true)
      store.addTerminal('agent-alpha')
      const tab = store.tabs.find(t => t.agentName === 'agent-alpha')!
      store.setActive(tab.id)

      const style = tabStyleMap.value.get(tab.id)
      expect(style).toEqual({ color: agentFg('agent-alpha'), backgroundColor: agentBg('agent-alpha') })
    })

    it('returns agentFg/agentBg with opacity for inactive tab with agentName in dark mode', async () => {
      const { useTabBarGroups } = await import('@renderer/composables/useTabBarGroups')
      const { setDarkMode, agentFg, agentBg } = await import('@renderer/utils/agentColor')
      const store = useTabsStore()
      const scrollContainer = makeScrollContainer()
      const { tabStyleMap } = useTabBarGroups(scrollContainer)

      setDarkMode(true)
      store.addTerminal('agent-alpha', undefined, undefined, undefined, undefined, undefined, undefined, false)
      const tab = store.tabs.find(t => t.agentName === 'agent-alpha')!
      store.setActive('backlog')

      const style = tabStyleMap.value.get(tab.id)
      expect(style).toEqual({
        color: agentFg('agent-alpha'),
        backgroundColor: agentBg('agent-alpha'),
        opacity: '0.65',
      })
    })

    it('returns agentFg/agentBg with opacity for inactive tab with agentName in light mode', async () => {
      const { useTabBarGroups } = await import('@renderer/composables/useTabBarGroups')
      const { setDarkMode, agentFg, agentBg } = await import('@renderer/utils/agentColor')
      const store = useTabsStore()
      const scrollContainer = makeScrollContainer()
      const { tabStyleMap } = useTabBarGroups(scrollContainer)

      setDarkMode(false)
      store.addTerminal('agent-alpha', undefined, undefined, undefined, undefined, undefined, undefined, false)
      const tab = store.tabs.find(t => t.agentName === 'agent-alpha')!
      store.setActive('backlog')

      const style = tabStyleMap.value.get(tab.id)
      expect(style).toEqual({
        color: agentFg('agent-alpha'),
        backgroundColor: agentBg('agent-alpha'),
        opacity: '0.65',
      })
    })
  })

  // ── agentTabStyleMap ──────────────────────────────────────────────────────
  describe('agentTabStyleMap (L140-L159)', () => {
    it('uses CSS var styles for null agentName group (dark mode)', async () => {
      const { useTabBarGroups } = await import('@renderer/composables/useTabBarGroups')
      const { setDarkMode } = await import('@renderer/utils/agentColor')
      const store = useTabsStore()
      const scrollContainer = makeScrollContainer()
      const { agentTabStyleMap } = useTabBarGroups(scrollContainer)

      setDarkMode(true)
      store.addTerminal(undefined)

      const style = agentTabStyleMap.value.get(null)
      expect(style).toEqual({ color: 'rgb(var(--v-theme-on-surface-variant))', backgroundColor: 'rgb(var(--v-theme-surface-variant))' })
    })

    it('uses CSS var styles for null agentName group (light mode)', async () => {
      const { useTabBarGroups } = await import('@renderer/composables/useTabBarGroups')
      const { setDarkMode } = await import('@renderer/utils/agentColor')
      const store = useTabsStore()
      const scrollContainer = makeScrollContainer()
      const { agentTabStyleMap } = useTabBarGroups(scrollContainer)

      setDarkMode(false)
      store.addTerminal(undefined)

      const style = agentTabStyleMap.value.get(null)
      expect(style).toEqual({ color: 'rgb(var(--v-theme-on-surface-variant))', backgroundColor: 'rgb(var(--v-theme-surface-variant))' })
    })

    it('uses agentFg/agentBg for active named group (L152-L153)', async () => {
      const { useTabBarGroups } = await import('@renderer/composables/useTabBarGroups')
      const { agentFg, agentBg, setDarkMode } = await import('@renderer/utils/agentColor')
      const store = useTabsStore()
      const scrollContainer = makeScrollContainer()
      const { agentTabStyleMap } = useTabBarGroups(scrollContainer)

      setDarkMode(true)
      store.addTerminal('agent-active') // active

      const style = agentTabStyleMap.value.get('agent-active')
      expect(style).toEqual({ color: agentFg('agent-active'), backgroundColor: agentBg('agent-active') })
    })

    it('uses agentFg/agentBg with opacity for inactive named group in dark mode (L154-L155)', async () => {
      const { useTabBarGroups } = await import('@renderer/composables/useTabBarGroups')
      const { setDarkMode, agentFg, agentBg } = await import('@renderer/utils/agentColor')
      const store = useTabsStore()
      const scrollContainer = makeScrollContainer()
      const { agentTabStyleMap } = useTabBarGroups(scrollContainer)

      setDarkMode(true)
      store.addTerminal('agent-active') // active
      store.addTerminal('agent-inactive', undefined, undefined, undefined, undefined, undefined, undefined, false)

      await nextTick()

      const style = agentTabStyleMap.value.get('agent-inactive')
      expect(style).toEqual({
        color: agentFg('agent-inactive'),
        backgroundColor: agentBg('agent-inactive'),
        opacity: '0.65',
      })
    })
  })

  // ── indicatorStyleMap ─────────────────────────────────────────────────────
  describe('indicatorStyleMap (L161-L170)', () => {
    it('uses agentFg for tabs with agentName', async () => {
      const { useTabBarGroups } = await import('@renderer/composables/useTabBarGroups')
      const { agentFg, setDarkMode } = await import('@renderer/utils/agentColor')
      const store = useTabsStore()
      const scrollContainer = makeScrollContainer()
      const { indicatorStyleMap } = useTabBarGroups(scrollContainer)

      setDarkMode(true)
      store.addTerminal('agent-alpha')
      const tab = store.tabs.find(t => t.agentName === 'agent-alpha')!

      const style = indicatorStyleMap.value.get(tab.id)
      expect(style).toEqual({ backgroundColor: agentFg('agent-alpha') })
    })

    it('uses neutral zinc for tabs without agentName (dark mode)', async () => {
      const { useTabBarGroups } = await import('@renderer/composables/useTabBarGroups')
      const { setDarkMode } = await import('@renderer/utils/agentColor')
      const store = useTabsStore()
      const scrollContainer = makeScrollContainer()
      const { indicatorStyleMap } = useTabBarGroups(scrollContainer)

      setDarkMode(true)
      store.addTerminal(undefined) // null agentName
      const tab = store.tabs.find(t => t.type === 'terminal')!

      const style = indicatorStyleMap.value.get(tab.id)
      expect(style).toEqual({ backgroundColor: '#a1a1aa' })
    })

    it('uses neutral zinc for tabs without agentName (light mode)', async () => {
      const { useTabBarGroups } = await import('@renderer/composables/useTabBarGroups')
      const { setDarkMode } = await import('@renderer/utils/agentColor')
      const store = useTabsStore()
      const scrollContainer = makeScrollContainer()
      const { indicatorStyleMap } = useTabBarGroups(scrollContainer)

      setDarkMode(false)
      store.addTerminal(undefined) // null agentName
      const tab = store.tabs.find(t => t.type === 'terminal')!

      const style = indicatorStyleMap.value.get(tab.id)
      expect(style).toEqual({ backgroundColor: '#71717a' })
    })
  })
})
