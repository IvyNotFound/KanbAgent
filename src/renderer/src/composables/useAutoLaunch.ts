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

/**
 * Fallback delay (ms) for agents with no assigned tasks (task-creator, review, test, perf…).
 * Longer window because these agents may run long sessions without any task transitions.
 */
const FALLBACK_CLOSE_NOTASK_MS = 30 * 60 * 1000

/** Delay (ms) between Ctrl+C and terminalKill */
const KILL_DELAY_MS = 2_000

/**
 * Lookback window (ms) subtracted from notBefore when scheduling a close (T835).
 * Covers the race condition where the agent writes ended_at before the renderer
 * detects the task transition (async refresh + 80ms debounce). Without this,
 * ended_at < notBefore → poll never finds the session → only fallback fires.
 */
const SCHEDULE_LOOKBACK_MS = 5 * 60 * 1000

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
  /** Guard: prevents duplicate immediate polls when watch fires rapidly for the same agent */
  const pendingImmediatePolls = new Set<string>()
  /** Flag: skip first watch trigger (initial load) */
  let initialized = false
  /** Timestamp of last review auto-launch (cooldown prevention) */
  let lastReviewLaunchedAt = 0
  /** Debounce timer for rapid batch task updates */
  let debounceId: ReturnType<typeof setTimeout> | null = null

  watch(tasks, (newTasks) => {
    if (!dbPath.value) return

    if (!initialized) {
      previousStatuses = new Map(newTasks.map(t => [t.id, t.statut]))
      initialized = true
      return
    }

    // Debounce: collapse rapid batch updates into a single handler run (80ms window)
    if (debounceId !== null) clearTimeout(debounceId)
    debounceId = setTimeout(() => {
      debounceId = null
      const current = tasks.value

      // --- Auto-close on done transition ---
      if (settingsStore.autoLaunchAgentSessions) {
        for (const task of current) {
          const prevStatus = previousStatuses.get(task.id)
          if (prevStatus && prevStatus !== 'done' && task.statut === 'done' && task.agent_assigne_id) {
            const agent = agents.value.find(a => a.id === task.agent_assigne_id)
            if (agent && agent.auto_launch !== 0 && tabsStore.hasAgentTerminal(agent.name)) {
              scheduleClose(agent.name, agent.id)
            }
          }
        }
      }

      // --- Auto-close agents with no assigned tasks (task-creator, review, test, perf…) ---
      // Covers agents that never receive assigned tasks: their terminal stays open indefinitely
      // unless we poll their session status independently of any task transition. (T646)
      if (settingsStore.autoLaunchAgentSessions) {
        for (const agent of agents.value) {
          if (agent.auto_launch === 0) continue
          if (!tabsStore.hasAgentTerminal(agent.name)) continue
          if (pendingCloses.has(agent.name)) continue // already scheduled
          const hasActiveTasks = current.some(
            t =>
              t.agent_assigne_id === agent.id &&
              (t.statut === 'todo' || t.statut === 'in_progress')
          )
          if (!hasActiveTasks) {
            scheduleClose(agent.name, agent.id, FALLBACK_CLOSE_NOTASK_MS)
          }
        }
      }

      // --- T341: Auto-launch review session ---
      if (settingsStore.autoLaunchAgentSessions && settingsStore.autoReviewEnabled) {
        checkReviewThreshold(current)
      }

      // Update tracking state
      previousStatuses = new Map(current.map(t => [t.id, t.statut]))
    }, 80)
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
    // Fast O(N) count without array allocation — filter only when threshold is met (T533)
    let doneCount = 0
    for (const t of currentTasks) if (t.statut === 'done') doneCount++
    if (doneCount < settingsStore.autoReviewThreshold) return

    if (Date.now() - lastReviewLaunchedAt < REVIEW_COOLDOWN_MS) return

    const reviewAgent = agents.value.find(a => a.type === 'review')
    if (!reviewAgent) return

    if (tabsStore.hasAgentTerminal(reviewAgent.name)) return

    lastReviewLaunchedAt = Date.now()
    launchReviewSession(reviewAgent, currentTasks.filter(t => t.statut === 'done'))
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

  async function pollSessionStatus(agentName: string, agentId: number, path: string, notBefore: string): Promise<void> {
    try {
      // Only detect sessions that completed AFTER the close was scheduled, preventing
      // false positives from previous sessions completed within the last few minutes.
      const rows = await window.electronAPI.queryDb(
        path,
        `SELECT id FROM sessions WHERE agent_id = ? AND statut = 'completed' AND ended_at >= ? ORDER BY id DESC LIMIT 1`,
        [agentId, notBefore]
      ) as { id: number }[]
      if (rows.length > 0) {
        doClose(agentName)
      }
    } catch {
      // Ignore transient poll errors
    }
  }

  function scheduleClose(agentName: string, agentId: number, fallbackMs: number = FALLBACK_CLOSE_MS): void {
    const existing = pendingCloses.get(agentName)
    if (existing) {
      clearInterval(existing.intervalId)
      clearTimeout(existing.fallbackId)
    }

    const path = dbPath.value
    if (!path) return

    // Use a lookback window to cover the race condition where the agent writes ended_at
    // BEFORE the renderer detects the task-done transition (T835). Without this,
    // notBefore could be after ended_at → poll never fires, only fallback triggers.
    // The 5min window is acceptable: scheduleClose only runs when an agent has an
    // active terminal AND its task just transitioned to done.
    const notBefore = new Date(Date.now() - SCHEDULE_LOOKBACK_MS).toISOString()

    // Immediate poll — guarded to prevent N parallel polls when watch fires rapidly
    if (!pendingImmediatePolls.has(agentName)) {
      pendingImmediatePolls.add(agentName)
      setTimeout(() => {
        pendingImmediatePolls.delete(agentName)
        pollSessionStatus(agentName, agentId, path, notBefore)
      }, 0)
    }

    const intervalId = setInterval(
      () => pollSessionStatus(agentName, agentId, path, notBefore),
      POLL_INTERVAL_MS
    )

    const fallbackId = setTimeout(() => {
      doClose(agentName)
    }, fallbackMs)

    pendingCloses.set(agentName, { intervalId, fallbackId })
  }
}
