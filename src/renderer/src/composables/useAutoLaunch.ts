/**
 * Composable for auto-closing agent terminals and auto-launching review sessions.
 *
 * Watches task changes and:
 * - Closes the terminal when the task transitions to 'done', polling the DB
 *   until the agent session reaches statut='completed' (Option B — robust).
 *   Falls back to force-close after FALLBACK_CLOSE_MS if the session never
 *   terminates on its own.
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

/** How often (ms) to poll the DB for agent session status after task goes done */
const POLL_INTERVAL_MS = 5_000

/** Fallback delay (ms): force-close terminal if session never reaches 'completed' */
const FALLBACK_CLOSE_MS = 5 * 60 * 1000

/** Delay (ms) between Ctrl+C and terminalKill */
const KILL_DELAY_MS = 2_000

/** Cooldown (ms) between review auto-launches to prevent infinite loops */
const REVIEW_COOLDOWN_MS = 5 * 60 * 1000

interface AutoLaunchOptions {
  tasks: Ref<Task[]>
  agents: Ref<Agent[]>
  dbPath: Ref<string | null>
}

interface PendingClose {
  intervalId: ReturnType<typeof setInterval>
  fallbackId: ReturnType<typeof setTimeout>
}

export function useAutoLaunch({ tasks, agents, dbPath }: AutoLaunchOptions): void {
  const tabsStore = useTabsStore()
  const settingsStore = useSettingsStore()
  const { launchReviewSession } = useLaunchSession()

  /** Track tasks that were not 'done' to detect transitions to 'done' */
  let previousStatuses = new Map<number, string>()
  /** Pending close pollers keyed by agent name */
  const pendingCloses = new Map<string, PendingClose>()
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
            scheduleClose(agent.name, agent.id)
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
    for (const pending of pendingCloses.values()) {
      clearInterval(pending.intervalId)
      clearTimeout(pending.fallbackId)
    }
    pendingCloses.clear()
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

  function doClose(agentName: string): void {
    const pending = pendingCloses.get(agentName)
    if (pending) {
      clearInterval(pending.intervalId)
      clearTimeout(pending.fallbackId)
      pendingCloses.delete(agentName)
    }

    const tab = tabsStore.tabs.find(t => t.type === 'terminal' && t.agentName === agentName)
    if (tab?.ptyId) {
      window.electronAPI.terminalWrite(tab.ptyId, '\x03')
      setTimeout(() => {
        if (tab.ptyId) window.electronAPI.terminalKill(tab.ptyId)
        tabsStore.closeTab(tab.id)
      }, KILL_DELAY_MS)
    } else if (tab) {
      tabsStore.closeTab(tab.id)
    }
  }

  async function pollSessionStatus(agentName: string, agentId: number, path: string): Promise<void> {
    try {
      const rows = await window.electronAPI.queryDb(
        path,
        `SELECT id FROM sessions WHERE agent_id = ? AND statut = 'completed' AND ended_at >= datetime('now', '-10 minutes') ORDER BY id DESC LIMIT 1`,
        [agentId]
      ) as { id: number }[]
      if (rows.length > 0) {
        doClose(agentName)
      }
    } catch {
      // Ignore transient poll errors
    }
  }

  function scheduleClose(agentName: string, agentId: number): void {
    const existing = pendingCloses.get(agentName)
    if (existing) {
      clearInterval(existing.intervalId)
      clearTimeout(existing.fallbackId)
    }

    const path = dbPath.value
    if (!path) return

    // Immediate poll (0ms delay to keep async, avoids blocking the watcher)
    setTimeout(() => pollSessionStatus(agentName, agentId, path), 0)

    const intervalId = setInterval(
      () => pollSessionStatus(agentName, agentId, path),
      POLL_INTERVAL_MS
    )

    const fallbackId = setTimeout(() => {
      doClose(agentName)
    }, FALLBACK_CLOSE_MS)

    pendingCloses.set(agentName, { intervalId, fallbackId })
  }
}
