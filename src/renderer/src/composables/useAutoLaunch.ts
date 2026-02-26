/**
 * Composable for auto-closing agent terminals and auto-launching review sessions.
 *
 * Watches task changes and:
 * - Closes the terminal when the task transitions to 'done' (with 5s grace period)
 * - Launches a review session when done-task count reaches threshold (T341)
 *
 * NOTE: Auto-launch on new task creation was removed in T345.
 * Sessions are now launched via board drag & drop (todo → in_progress).
 *
 * @module composables/useAutoLaunch
 */

import { watch, type Ref } from 'vue'
import { useTabsStore } from '@renderer/stores/tabs'
import { useSettingsStore } from '@renderer/stores/settings'
import { useLaunchSession } from '@renderer/composables/useLaunchSession'
import type { Task, Agent } from '@renderer/types'

/** Grace period (ms) before closing a terminal after task goes done */
const CLOSE_GRACE_MS = 5000

/** Cooldown (ms) between review auto-launches to prevent infinite loops */
const REVIEW_COOLDOWN_MS = 5 * 60 * 1000

interface AutoLaunchOptions {
  tasks: Ref<Task[]>
  agents: Ref<Agent[]>
  dbPath: Ref<string | null>
}

export function useAutoLaunch({ tasks, agents, dbPath }: AutoLaunchOptions): void {
  const tabsStore = useTabsStore()
  const settingsStore = useSettingsStore()
  const { launchReviewSession } = useLaunchSession()

  /** Track tasks that were not 'done' to detect transitions to 'done' */
  let previousStatuses = new Map<number, string>()
  /** Pending close timers keyed by agent name (for grace period) */
  const closeTimers = new Map<string, ReturnType<typeof setTimeout>>()
  /** Flag: skip first watch trigger (initial load) */
  let initialized = false
  /** Timestamp of last review auto-launch (cooldown prevention) */
  let lastReviewLaunchedAt = 0

  watch(tasks, (newTasks) => {
    if (!dbPath.value) return

    if (!initialized) {
      previousStatuses = new Map(newTasks.map(t => [t.id, t.statut]))
      initialized = true
      return
    }

    // --- Auto-close on done transition ---
    if (settingsStore.autoLaunchAgentSessions) {
      for (const task of newTasks) {
        const prevStatus = previousStatuses.get(task.id)
        if (prevStatus && prevStatus !== 'done' && task.statut === 'done' && task.agent_assigne_id) {
          const agent = agents.value.find(a => a.id === task.agent_assigne_id)
          if (agent && agent.auto_launch !== 0 && tabsStore.hasAgentTerminal(agent.name)) {
            scheduleClose(agent.name)
          }
        }
      }
    }

    // --- T341: Auto-launch review session ---
    if (settingsStore.autoLaunchAgentSessions && settingsStore.autoReviewEnabled) {
      checkReviewThreshold(newTasks)
    }

    // Update tracking state
    previousStatuses = new Map(newTasks.map(t => [t.id, t.statut]))
  }, { deep: false })

  // Reset tracking when project changes
  watch(dbPath, () => {
    initialized = false
    previousStatuses = new Map()
    lastReviewLaunchedAt = 0
    for (const timer of closeTimers.values()) clearTimeout(timer)
    closeTimers.clear()
  })

  function checkReviewThreshold(currentTasks: Task[]): void {
    const doneTasks = currentTasks.filter(t => t.statut === 'done')
    if (doneTasks.length < settingsStore.autoReviewThreshold) return

    if (Date.now() - lastReviewLaunchedAt < REVIEW_COOLDOWN_MS) return

    const reviewAgent = agents.value.find(a => a.type === 'review')
    if (!reviewAgent) return

    if (tabsStore.hasAgentTerminal(reviewAgent.name)) return

    lastReviewLaunchedAt = Date.now()
    launchReviewSession(reviewAgent, doneTasks)
  }

  function scheduleClose(agentName: string): void {
    const existing = closeTimers.get(agentName)
    if (existing) clearTimeout(existing)

    const timer = setTimeout(() => {
      closeTimers.delete(agentName)
      const tab = tabsStore.tabs.find(t => t.type === 'terminal' && t.agentName === agentName)
      if (tab?.ptyId) {
        window.electronAPI.terminalWrite(tab.ptyId, '\x03')
        setTimeout(() => {
          if (tab.ptyId) window.electronAPI.terminalKill(tab.ptyId)
          tabsStore.closeTab(tab.id)
        }, 2000)
      } else if (tab) {
        tabsStore.closeTab(tab.id)
      }
    }, CLOSE_GRACE_MS)

    closeTimers.set(agentName, timer)
  }
}
