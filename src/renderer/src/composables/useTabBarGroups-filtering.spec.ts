/**
 * Tests for useTabBarGroups — terminalTabs / fileTabs filtering (L26-L27)
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

  describe('terminalTabs filtering (L26)', () => {
    it('excludes permanent tabs and non-terminal types', async () => {
      const { useTabBarGroups } = await import('@renderer/composables/useTabBarGroups')
      const store = useTabsStore()
      const scrollContainer = makeScrollContainer()
      const { terminalTabs } = useTabBarGroups(scrollContainer)

      // Initial state: only permanent tabs (backlog, dashboard, timeline)
      expect(terminalTabs.value).toHaveLength(0)
    })

    it('includes terminal tabs that are not permanent', async () => {
      const { useTabBarGroups } = await import('@renderer/composables/useTabBarGroups')
      const store = useTabsStore()
      const scrollContainer = makeScrollContainer()
      const { terminalTabs } = useTabBarGroups(scrollContainer)

      store.addTerminal('agent-alpha')
      store.addTerminal('agent-beta')

      expect(terminalTabs.value).toHaveLength(2)
      expect(terminalTabs.value.every(t => t.type === 'terminal')).toBe(true)
    })

    it('excludes tabs with type !== terminal (file tabs)', async () => {
      const { useTabBarGroups } = await import('@renderer/composables/useTabBarGroups')
      const store = useTabsStore()
      const scrollContainer = makeScrollContainer()
      const { terminalTabs, fileTabs } = useTabBarGroups(scrollContainer)

      store.openFile('/path/to/file.ts', 'file.ts')
      store.addTerminal('agent-alpha')

      expect(terminalTabs.value).toHaveLength(1)
      expect(fileTabs.value).toHaveLength(1)
      expect(fileTabs.value[0].type).toBe('file')
    })
  })
})
