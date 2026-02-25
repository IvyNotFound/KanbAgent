/**
 * Pinia store for tab management in the application.
 *
 * Manages:
 * - Multiple tab types: backlog, terminal, explorer, file, logs
 * - Tab ordering and activation
 * - Terminal sessions with ptyId tracking
 * - Activity indicators for terminals
 *
 * @module stores/tabs
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export type TabType = 'backlog' | 'terminal' | 'explorer' | 'file' | 'logs'

export interface Tab {
  id: string
  type: TabType
  title: string
  ptyId: string | null
  agentName: string | null
  wslUser: string | null
  autoSend: string | null
  systemPrompt: string | null
  thinkingMode: string | null
  filePath?: string
  dirty?: boolean
  logsAgentId?: number | null
  permanent?: boolean
}

/**
 * Tabs store using Pinia composition API.
 *
 * State:
 * - tabs: Array of open tabs (includes permanent tabs: backlog, logs)
 * - activeTabId: Currently active tab
 * - tabActivity: Map of tab IDs to activity status
 *
 * Actions:
 * - setActive: Switch active tab
 * - addTerminal, closeTab: Tab lifecycle
 * - addExplorer, openFile: File explorer tabs
 * - markTabActive: Update activity indicator
 *
 * @returns {object} Store instance with state and methods
 */
export const useTabsStore = defineStore('tabs', () => {
  const tabs = ref<Tab[]>([
    { id: 'backlog', type: 'backlog', title: 'Backlog', ptyId: null, agentName: null, wslUser: null, autoSend: null, systemPrompt: null, thinkingMode: null, permanent: true },
    { id: 'logs',  type: 'logs',  title: 'Log',   ptyId: null, agentName: null, wslUser: null, autoSend: null, systemPrompt: null, thinkingMode: null, permanent: true, logsAgentId: null },
  ])
  const activeTabId = ref<string>('backlog')

  // Activité terminal : true si output reçu dans les 2.5 dernières secondes
  const tabActivity = ref<Record<string, boolean>>({})
  const activityTimers: Record<string, ReturnType<typeof setTimeout>> = {}

  function markTabActive(tabId: string): void {
    tabActivity.value[tabId] = true
    if (activityTimers[tabId]) clearTimeout(activityTimers[tabId])
    activityTimers[tabId] = setTimeout(() => {
      tabActivity.value[tabId] = false
    }, 1000)
  }

  function isAgentActive(agentName: string): boolean {
    const tab = tabs.value.find(t => t.type === 'terminal' && t.agentName === agentName)
    return tab ? !!tabActivity.value[tab.id] : false
  }

  function hasAgentTerminal(agentName: string): boolean {
    return tabs.value.some(t => t.type === 'terminal' && t.agentName === agentName)
  }

  const activeTab = computed(() => tabs.value.find(t => t.id === activeTabId.value) ?? tabs.value[0])

  function setActive(id: string): void {
    activeTabId.value = id
  }

  function addExplorer(): void {
    const existing = tabs.value.find(t => t.type === 'explorer')
    if (existing) { activeTabId.value = existing.id; return }
    tabs.value.push({
      id: 'explorer',
      type: 'explorer',
      title: 'Fichiers',
      ptyId: null,
      agentName: null,
      wslUser: null,
      autoSend: null,
      systemPrompt: null,
      thinkingMode: null,
    })
    activeTabId.value = 'explorer'
  }

  function setTabDirty(id: string, dirty: boolean): void {
    const tab = tabs.value.find(t => t.id === id)
    if (tab) tab.dirty = dirty
  }

  function openFile(filePath: string, fileName: string): void {
    const existing = tabs.value.find(t => t.type === 'file' && t.filePath === filePath)
    if (existing) { activeTabId.value = existing.id; return }
    const id = `file-${Date.now()}`
    tabs.value.push({ id, type: 'file', title: fileName, ptyId: null, agentName: null, wslUser: null, autoSend: null, systemPrompt: null, thinkingMode: null, filePath })
    activeTabId.value = id
  }

  function addLogs(agentId?: number | null): void {
    const logTab = tabs.value.find(t => t.type === 'logs')
    if (logTab && agentId != null) logTab.logsAgentId = agentId
    activeTabId.value = 'logs'
  }

  function addTerminal(agentName?: string, wslUser?: string, autoSend?: string, systemPrompt?: string, thinkingMode?: string): void {
    const id = `term-${Date.now()}`
    const n = tabs.value.filter(t => t.type === 'terminal').length + 1
    const title = agentName ?? `WSL ${n}`
    tabs.value.push({
      id,
      type: 'terminal',
      title,
      ptyId: null,
      agentName: agentName ?? null,
      wslUser: wslUser ?? null,
      autoSend: autoSend ?? null,
      systemPrompt: systemPrompt ?? null,
      thinkingMode: thinkingMode ?? null,
    })
    activeTabId.value = id
  }

  function setPtyId(tabId: string, ptyId: string): void {
    const tab = tabs.value.find(t => t.id === tabId)
    if (tab) tab.ptyId = ptyId
  }

  function closeTab(id: string): void {
    const tab = tabs.value.find(t => t.id === id)
    if (!tab || tab.permanent) return
    const idx = tabs.value.findIndex(t => t.id === id)
    tabs.value.splice(idx, 1)
    if (activeTabId.value === id) {
      activeTabId.value = tabs.value[Math.max(0, idx - 1)]?.id ?? 'backlog'
    }
  }

  function renameTab(id: string, title: string): void {
    const tab = tabs.value.find(t => t.id === id)
    if (tab && title.trim()) tab.title = title.trim()
  }

  function reorderTab(fromId: string, toId: string): void {
    const fromIdx = tabs.value.findIndex(t => t.id === fromId)
    const toIdx = tabs.value.findIndex(t => t.id === toId)
    if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return
    const [tab] = tabs.value.splice(fromIdx, 1)
    const newToIdx = tabs.value.findIndex(t => t.id === toId)
    tabs.value.splice(newToIdx, 0, tab)
  }

  function closeAllTerminals(): void {
    const terminals = tabs.value.filter(t => t.type === 'terminal')
    for (const tab of terminals) {
      if (tab.ptyId) window.electronAPI.terminalKill(tab.ptyId)
    }
    tabs.value = tabs.value.filter(t => t.type !== 'terminal')
    if (activeTabId.value !== 'backlog' && !tabs.value.find(t => t.id === activeTabId.value)) {
      activeTabId.value = 'backlog'
    }
  }

  return { tabs, activeTabId, activeTab, setActive, addTerminal, addLogs, addExplorer, openFile, setTabDirty, setPtyId, closeTab, renameTab, reorderTab, closeAllTerminals, markTabActive, isAgentActive, hasAgentTerminal }
})
