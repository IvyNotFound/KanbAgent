/**
 * Composable for TabBar agent grouping logic and dynamic styles.
 * Extracted from TabBar.vue to keep the component under 400 lines.
 *
 * @module composables/useTabBarGroups
 */

import { ref, computed, watch, nextTick } from 'vue'
import type { Ref } from 'vue'
import { useTabsStore } from '@renderer/stores/tabs'
import type { Tab } from '@renderer/stores/tabs'
import { agentFg, agentBg, isDark, colorVersion } from '@renderer/utils/agentColor'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TabGroup {
  agentName: string | null
  tabs: Tab[]
}

// ── Composable ────────────────────────────────────────────────────────────────

export function useTabBarGroups(scrollContainer: Ref<HTMLDivElement | null>) {
  const store = useTabsStore()

  const terminalTabs = computed(() => store.tabs.filter(t => !t.permanent && t.type === 'terminal'))
  const fileTabs = computed(() => store.tabs.filter(t => t.type === 'file'))

  // ── Grouping by agent ───────────────────────────────────────────────────────

  const collapsedAgents = ref<Set<string | null>>(new Set())

  const groupedTerminalTabsBase = computed<TabGroup[]>(() => {
    const groupMap = new Map<string | null, Tab[]>()
    for (const tab of terminalTabs.value) {
      const key = tab.agentName
      if (!groupMap.has(key)) groupMap.set(key, [])
      groupMap.get(key)!.push(tab)
    }
    return [...groupMap.entries()].map(([agentName, tabs]) => ({ agentName, tabs }))
  })

  const activeAgentName = computed(() => store.activeTab?.agentName ?? null)

  const groupedTerminalTabs = computed<TabGroup[]>(() => {
    const active = activeAgentName.value
    const groups = groupedTerminalTabsBase.value
    if (!active) return groups
    const sorted = [...groups]
    sorted.sort((a, b) => {
      if (a.agentName === active) return -1
      if (b.agentName === active) return 1
      if (a.agentName === null) return 1
      if (b.agentName === null) return -1
      return a.agentName.localeCompare(b.agentName)
    })
    return sorted
  })

  function toggleGroup(agentName: string | null): void {
    if (collapsedAgents.value.has(agentName)) {
      collapsedAgents.value.delete(agentName)
    } else {
      collapsedAgents.value.add(agentName)
    }
  }

  function isGroupCollapsed(agentName: string | null): boolean {
    return collapsedAgents.value.has(agentName)
  }

  function isGroupActive(group: TabGroup): boolean {
    return group.tabs.some(t => t.id === store.activeTabId)
  }

  function activateAgentGroup(group: TabGroup): void {
    if (group.tabs.length === 0) return
    const savedScroll = scrollContainer.value?.scrollLeft ?? 0
    if (isGroupCollapsed(group.agentName)) {
      collapsedAgents.value.delete(group.agentName)
    }
    if (!isGroupActive(group)) {
      store.setActive(group.tabs[0].id)
    }
    nextTick(() => {
      if (scrollContainer.value) scrollContainer.value.scrollLeft = savedScroll
    })
  }

  // Auto-expand group when its tab becomes active; auto-collapse previous group
  watch(() => store.activeTabId, (newId, oldId) => {
    const activeTab = store.tabs.find(t => t.id === newId)
    if (!activeTab) return
    const newAgentName = activeTab.agentName ?? null
    collapsedAgents.value.delete(newAgentName)
    if (oldId) {
      const oldTab = store.tabs.find(t => t.id === oldId)
      const oldAgentName = oldTab?.agentName ?? null
      if (oldAgentName !== null && oldAgentName !== newAgentName) {
        collapsedAgents.value.add(oldAgentName)
      }
    }
  })

  // When multiple groups appear, collapse non-active agent groups
  watch(() => groupedTerminalTabs.value.length, (len) => {
    if (len <= 1) { collapsedAgents.value.clear(); return }
    const activeAgent = store.activeTab?.agentName ?? null
    for (const group of groupedTerminalTabs.value) {
      if (group.agentName !== activeAgent) {
        collapsedAgents.value.add(group.agentName)
      }
    }
  }, { immediate: true })

  // ── Dynamic styles ──────────────────────────────────────────────────────────

  const tabStyleMap = computed<Map<string, Record<string, string>>>(() => {
    void colorVersion.value
    const activeId = store.activeTabId
    const map = new Map<string, Record<string, string>>()
    for (const tab of store.tabs) {
      const isActive = activeId === tab.id
      if (!tab.agentName) {
        map.set(tab.id, isActive
          ? (isDark() ? { color: '#f4f4f5', backgroundColor: '#27272a' } : { color: '#18181b', backgroundColor: '#e4e4e7' })
          : {})
        continue
      }
      map.set(tab.id, isActive
        ? { color: agentFg(tab.agentName), backgroundColor: agentBg(tab.agentName) }
        : { color: agentFg(tab.agentName), backgroundColor: agentBg(tab.agentName), opacity: '0.65' })
    }
    return map
  })

  const agentTabStyleMap = computed<Map<string | null, Record<string, string>>>(() => {
    void colorVersion.value
    const activeId = store.activeTabId
    const map = new Map<string | null, Record<string, string>>()
    for (const group of groupedTerminalTabs.value) {
      const name = group.agentName
      if (!name) {
        map.set(name, isDark() ? { color: '#a1a1aa', backgroundColor: '#27272a' } : { color: '#52525b', backgroundColor: '#e4e4e7' })
        continue
      }
      const isActive = group.tabs.some(t => t.id === activeId)
      map.set(name, isActive
        ? { color: agentFg(name), backgroundColor: agentBg(name) }
        : { color: agentFg(name), backgroundColor: agentBg(name), opacity: '0.65' })
    }
    return map
  })

  const indicatorStyleMap = computed<Map<string, Record<string, string>>>(() => {
    void colorVersion.value
    const map = new Map<string, Record<string, string>>()
    for (const tab of store.tabs) {
      map.set(tab.id, tab.agentName
        ? { backgroundColor: agentFg(tab.agentName) }
        : { backgroundColor: isDark() ? '#a1a1aa' : '#71717a' }) // zinc-400/500
    }
    return map
  })

  function subTabLabel(tab: Tab): string {
    return tab.taskId ? `#${tab.taskId}` : tab.title
  }

  return {
    store,
    terminalTabs, fileTabs,
    collapsedAgents, groupedTerminalTabs,
    toggleGroup, isGroupCollapsed, isGroupActive, activateAgentGroup,
    tabStyleMap, agentTabStyleMap, indicatorStyleMap, subTabLabel,
  }
}
