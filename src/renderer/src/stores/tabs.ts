/**
 * Pinia store for tab management in the application.
 *
 * Manages:
 * - Multiple tab types: backlog, terminal, explorer, file, logs, metrics
 * - Tab ordering and activation
 * - Terminal sessions with ptyId tracking
 * - Activity indicators for terminals
 *
 * @module stores/tabs
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export type TabType = 'backlog' | 'terminal' | 'explorer' | 'file' | 'dashboard' | 'hooks' | 'workload' | 'topology' | 'timeline' | 'telemetry'

export interface Tab {
  id: string
  type: TabType
  title: string
  ptyId: string | null
  agentName: string | null
  wslDistro: string | null
  autoSend: string | null
  systemPrompt: string | null
  thinkingMode: string | null
  claudeCommand?: string | null
  /** Claude Code conversation UUID for --resume (task #218). null = no previous session. */
  convId?: string | null
  /** Task ID displayed in tab title (task #400). null = no associated task. */
  taskId?: number | null
  /** View mode: always 'stream' (StreamView). Field kept for backward compat with persisted state. */
  viewMode?: 'stream'
  /** Agent stream ID returned by agentCreate — used for explicit kill on closeTab (T730). */
  streamId?: string | null
  filePath?: string
  dirty?: boolean
  logsAgentId?: number | null
  permanent?: boolean
}

/**
 * Tabs store using Pinia composition API.
 *
 * State:
 * - tabs: Array of open tabs (includes permanent tabs: backlog, logs, metrics)
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
    { id: 'backlog', type: 'backlog', title: 'Backlog', ptyId: null, agentName: null, wslDistro: null, autoSend: null, systemPrompt: null, thinkingMode: null, permanent: true },
    { id: 'dashboard', type: 'dashboard', title: 'Dashboard',    ptyId: null, agentName: null, wslDistro: null, autoSend: null, systemPrompt: null, thinkingMode: null, permanent: true, logsAgentId: null },
    { id: 'hooks',    type: 'hooks',    title: 'Hooks',    ptyId: null, agentName: null, wslDistro: null, autoSend: null, systemPrompt: null, thinkingMode: null, permanent: true },
    { id: 'workload',  type: 'workload',  title: 'Workload',  ptyId: null, agentName: null, wslDistro: null, autoSend: null, systemPrompt: null, thinkingMode: null, permanent: true },
    { id: 'topology',  type: 'topology',  title: 'Topology',  ptyId: null, agentName: null, wslDistro: null, autoSend: null, systemPrompt: null, thinkingMode: null, permanent: true },
    { id: 'timeline',   type: 'timeline',   title: 'Timeline',   ptyId: null, agentName: null, wslDistro: null, autoSend: null, systemPrompt: null, thinkingMode: null, permanent: true },
    { id: 'telemetry', type: 'telemetry', title: 'Telemetry', ptyId: null, agentName: null, wslDistro: null, autoSend: null, systemPrompt: null, thinkingMode: null, permanent: true },
  ])
  const activeTabId = ref<string>('backlog')

  // Activité terminal : true si output reçu dans les 5 dernières secondes
  const tabActivity = ref<Record<string, boolean>>({})
  const activityTimers: Record<string, ReturnType<typeof setTimeout>> = {}
  let _tabCounter = 0
  // Timestamp of last markTabActive call per tab (for 500ms throttle)
  const activityLastReset: Record<string, number> = {}

  function markTabActive(tabId: string): void {
    const now = Date.now()
    // Throttle to once per 500ms: avoids creating/destroying setTimeout at every PTY data chunk
    if (now - (activityLastReset[tabId] ?? 0) < 500) return
    activityLastReset[tabId] = now
    tabActivity.value[tabId] = true
    if (activityTimers[tabId]) clearTimeout(activityTimers[tabId])
    activityTimers[tabId] = setTimeout(() => {
      tabActivity.value[tabId] = false
      delete activityTimers[tabId]
    }, 5000)
  }

  function isAgentActive(agentName: string): boolean {
    return tabs.value.some(t => t.type === 'terminal' && t.agentName === agentName && tabActivity.value[t.id])
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
      wslDistro: null,
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
    tabs.value.push({ id, type: 'file', title: fileName, ptyId: null, agentName: null, wslDistro: null, autoSend: null, systemPrompt: null, thinkingMode: null, filePath })
    activeTabId.value = id
  }

  function addLogs(agentId?: number | null): void {
    const statTab = tabs.value.find(t => t.type === 'dashboard')
    if (statTab && agentId != null) statTab.logsAgentId = agentId
    activeTabId.value = 'dashboard'
  }

  function addTerminal(agentName?: string, wslDistro?: string, autoSend?: string, systemPrompt?: string, thinkingMode?: string, claudeCommand?: string, convId?: string, activate = true, taskId?: number, viewMode?: 'stream'): void {
    const id = `term-${Date.now()}-${++_tabCounter}`
    let title: string
    if (agentName) {
      const sameAgentTabs = tabs.value.filter(t => t.type === 'terminal' && t.agentName === agentName)
      if (sameAgentTabs.length === 0) {
        title = agentName
      } else {
        const numbers = sameAgentTabs.map(t => {
          const m = t.title.match(/\((\d+)\)(?:\s·\s#\d+)?$/)
          return m ? parseInt(m[1]) : 1
        })
        title = `${agentName} (${Math.max(...numbers) + 1})`
      }
    } else {
      const n = tabs.value.filter(t => t.type === 'terminal').length + 1
      title = `WSL ${n}`
    }
    tabs.value.push({
      id,
      type: 'terminal',
      title,
      ptyId: null,
      agentName: agentName ?? null,
      wslDistro: wslDistro ?? null,
      autoSend: autoSend ?? null,
      systemPrompt: systemPrompt ?? null,
      thinkingMode: thinkingMode ?? null,
      claudeCommand: claudeCommand ?? null,
      convId: convId ?? null,
      taskId: taskId ?? null,
      viewMode: viewMode ?? 'stream',
    })
    if (activate) activeTabId.value = id
  }

  function setPtyId(tabId: string, ptyId: string): void {
    const tab = tabs.value.find(t => t.id === tabId)
    if (tab) tab.ptyId = ptyId
  }

  /**
   * Set or clear the `streamId` for a terminal tab (T730).
   *
   * The `streamId` is the agent process ID returned by `agentCreate`. It is stored
   * on the tab so that `closeTab` can call `agentKill` explicitly — before the
   * `StreamView` component unmounts — guaranteeing no orphan agent processes.
   * `StreamView.onUnmounted` clears it to `null` to prevent a double-kill.
   *
   * @param tabId    - Unique identifier of the target tab.
   * @param streamId - Agent process ID to store, or `null` to clear after kill.
   */
  function setStreamId(tabId: string, streamId: string | null): void {
    const tab = tabs.value.find(t => t.id === tabId)
    if (tab) tab.streamId = streamId
  }

  /**
   * Remove a tab by ID and activate an appropriate replacement.
   *
   * Activation priority for closed terminal tabs (T619 — intra-group selection):
   *  1. Another terminal in the **same agent group** (avoids unwanted inter-group switch)
   *  2. Any other terminal tab
   *  3. `'backlog'` (always present, permanent)
   *
   * Non-terminal tabs fall back to linear index-based selection.
   * Cleans up the activity timer for the closed tab.
   *
   * @param id - Unique identifier of the tab to close
   */
  function closeTab(id: string): void {
    const tab = tabs.value.find(t => t.id === id)
    if (!tab || tab.permanent) return
    // Explicit kill — agentKill is idempotent; onUnmounted in StreamView is the fallback (T730).
    if (tab.streamId) {
      window.electronAPI.agentKill(tab.streamId)
    }
    const closedAgentName = tab.agentName
    const idx = tabs.value.findIndex(t => t.id === id)
    tabs.value.splice(idx, 1)
    if (activeTabId.value === id) {
      if (tab.type === 'terminal') {
        // Priority 1: another tab in the same agent group to avoid inter-group switch
        const sameGroupTab = tabs.value.find(t => t.agentName === closedAgentName && t.type === 'terminal')
        // Priority 2: any other terminal tab
        const otherTerminal = sameGroupTab ?? tabs.value.find(t => t.type === 'terminal')
        // Priority 3: backlog
        activeTabId.value = otherTerminal?.id ?? 'backlog'
      } else {
        // Non-terminal tabs: linear fallback
        activeTabId.value = tabs.value[Math.max(0, idx - 1)]?.id ?? 'backlog'
      }
    }
    // Clean up activity timer
    if (activityTimers[id]) {
      clearTimeout(activityTimers[id])
      delete activityTimers[id]
    }
    delete tabActivity.value[id]
  }

  function renameTab(id: string, title: string): void {
    const tab = tabs.value.find(t => t.id === id)
    if (tab && title.trim()) tab.title = title.trim()
  }

  function closeTabGroup(agentName: string | null): void {
    const groupTabs = [...tabs.value.filter(t => t.agentName === agentName && !t.permanent)]
    for (const tab of groupTabs) {
      closeTab(tab.id)
    }
  }

  function closeAllTerminals(): void {
    const terminalIds = tabs.value.filter(t => t.type === 'terminal').map(t => t.id)
    for (const id of terminalIds) {
      closeTab(id)
    }
  }

  return { tabs, activeTabId, activeTab, tabActivity, setActive, addTerminal, addLogs, addExplorer, openFile, setTabDirty, setPtyId, setStreamId, closeTab, renameTab, closeTabGroup, closeAllTerminals, markTabActive, isAgentActive, hasAgentTerminal }
})
