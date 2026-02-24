import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export type TabType = 'board' | 'terminal'

export interface Tab {
  id: string
  type: TabType
  title: string
  ptyId: string | null
  agentName: string | null
  wslUser: string | null
  autoSend: string | null
}

export const useTabsStore = defineStore('tabs', () => {
  const tabs = ref<Tab[]>([
    { id: 'board', type: 'board', title: 'Board', ptyId: null, agentName: null, wslUser: null, autoSend: null }
  ])
  const activeTabId = ref<string>('board')

  // Activité terminal : true si output reçu dans les 8 dernières secondes
  const tabActivity = ref<Record<string, boolean>>({})
  const activityTimers: Record<string, ReturnType<typeof setTimeout>> = {}

  function markTabActive(tabId: string): void {
    tabActivity.value[tabId] = true
    if (activityTimers[tabId]) clearTimeout(activityTimers[tabId])
    activityTimers[tabId] = setTimeout(() => {
      tabActivity.value[tabId] = false
    }, 2000)
  }

  function isAgentActive(agentName: string): boolean {
    const tab = tabs.value.find(t => t.type === 'terminal' && t.agentName === agentName)
    return tab ? !!tabActivity.value[tab.id] : false
  }

  const activeTab = computed(() => tabs.value.find(t => t.id === activeTabId.value) ?? tabs.value[0])

  function setActive(id: string): void {
    activeTabId.value = id
  }

  function addTerminal(agentName?: string, wslUser?: string, autoSend?: string): void {
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
    })
    activeTabId.value = id
  }

  function setPtyId(tabId: string, ptyId: string): void {
    const tab = tabs.value.find(t => t.id === tabId)
    if (tab) tab.ptyId = ptyId
  }

  function closeTab(id: string): void {
    if (id === 'board') return
    const idx = tabs.value.findIndex(t => t.id === id)
    if (idx === -1) return
    tabs.value.splice(idx, 1)
    if (activeTabId.value === id) {
      activeTabId.value = tabs.value[Math.max(0, idx - 1)]?.id ?? 'board'
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
    if (activeTabId.value !== 'board' && !tabs.value.find(t => t.id === activeTabId.value)) {
      activeTabId.value = 'board'
    }
  }

  return { tabs, activeTabId, activeTab, setActive, addTerminal, setPtyId, closeTab, renameTab, reorderTab, closeAllTerminals, markTabActive, isAgentActive }
})
