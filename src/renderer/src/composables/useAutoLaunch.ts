/**
 * Composable for auto-closing agent terminals and auto-launching review sessions.
 *
 * Watches task changes and:
 * - Closes the terminal when the task transitions to 'done', polling the DB
 *   until the agent session reaches status='completed' (Option B — robust).
 *   Falls back to force-close after FALLBACK_CLOSE_MS if the session never
 *   terminates on its own.
 * - For no-task agents (review, doc…): polls for session completion with no
 *   fallback (T1246) and a 30s post-complete delay (T1249).
 * - Launches a review session when done-task count reaches threshold (T341)
 *
 * Each tab is tracked independently by tabId (T1249). Chemin 1 links tab to
 * task via taskId; Chemin 2 handles tabs without a taskId (no-task agents).
 *
 * NOTE: Auto-launch on new task creation was removed in T345.
 * Sessions are now launched via board drag & drop (todo → in_progress).
 *
 * @module composables/useAutoLaunch
 */

import { watch, onUnmounted, type Ref } from 'vue'
import { useTabsStore } from '@renderer/stores/tabs'
import type { Tab } from '@renderer/stores/tabs'
import { useSettingsStore } from '@renderer/stores/settings'
import { useLaunchSession } from '@renderer/composables/useLaunchSession'
import type { Task, Agent } from '@renderer/types'

/** How often (ms) to poll the DB for agent session status after task goes done */
const POLL_INTERVAL_MS = 5_000

/** Fallback delay (ms): force-close terminal if session never reaches 'completed' (T1930: 60s, was 15s) */
const FALLBACK_CLOSE_MS = 60 * 1000

/** Delay (ms) between agentKill signal and closeTab (allows the process to flush) */
const KILL_DELAY_MS = 2_000

/**
 * Post-complete delay (ms) for no-task tabs (review, doc…).
 * Longer window because these agents may output a final summary after session ends.
 * No fallback is set for these tabs (T1246): duration is too unpredictable.
 */
const NO_TASK_POST_COMPLETE_DELAY_MS = 30_000

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
  agentId: number
  path: string
  notBefore: string
  fallbackId: ReturnType<typeof setTimeout> | null
  postCompleteDelayMs: number
}

/**
 * Watch task transitions and manage auto-close / auto-review behaviours.
 *
 * - Chemin 1: When a task moves to `done`, finds the specific terminal tab linked
 *   to that task (agentName + taskId) and schedules a close with DB polling.
 * - Chemin 2: For tabs without a taskId (review, doc…), polls for session
 *   completion without a fallback timer (T1246).
 * - When the number of `done` tasks reaches a configurable threshold, auto-launches
 *   a review session (subject to cooldown).
 *
 * Each tab is keyed by its unique tabId so multiple tabs for the same agent
 * are tracked independently (T1249).
 *
 * @param options - Reactive refs for tasks, agents and the current database path.
 * @returns void — side-effects only (watchers, timers).
 */
export function useAutoLaunch({ tasks, agents, dbPath }: AutoLaunchOptions): void {
  const tabsStore = useTabsStore()
  const settingsStore = useSettingsStore()
  const { launchReviewSession } = useLaunchSession()

  /** Track tasks that were not 'done' to detect transitions to 'done' */
  let previousStatuses = new Map<number, string>()
  /** Pending close pollers keyed by tabId (unique per tab — T1249) */
  const pendingCloses = new Map<string, PendingClose>()
  /** Single shared interval that polls DB for all pending-close tabs (T1962) */
  let sharedIntervalId: ReturnType<typeof setInterval> | null = null
  /** Guard: prevents duplicate immediate polls when watch fires rapidly for the same tab */
  const pendingImmediatePolls = new Set<string>()
  /** Flag: skip first watch trigger (initial load) */
  let initialized = false
  /** Timestamp of last review auto-launch (cooldown prevention) */
  let lastReviewLaunchedAt = 0
  /** Debounce timer for rapid batch task updates */
  let debounceId: ReturnType<typeof setTimeout> | null = null
  /** Track fire-and-forget timeouts (doClose delay, immediate polls) for cleanup */
  const looseTimeouts = new Set<ReturnType<typeof setTimeout>>()

  watch(tasks, (newTasks) => {
    if (!dbPath.value) return

    if (!initialized) {
      previousStatuses = new Map(newTasks.map(t => [t.id, t.status]))
      initialized = true
      // Check threshold on initial load — tasks already done before app restart must trigger review
      if (settingsStore.autoReviewEnabled) {
        checkReviewThreshold(newTasks)
      }
      return
    }

    // Debounce: collapse rapid batch updates into a single handler run (80ms window)
    if (debounceId !== null) clearTimeout(debounceId)
    debounceId = setTimeout(() => {
      debounceId = null
      const current = tasks.value

      if (settingsStore.autoLaunchAgentSessions) {
        // --- Chemin 1: task → done, find specific tab by agentName + taskId ---
        for (const task of current) {
          const prevStatus = previousStatuses.get(task.id)
          if (prevStatus && prevStatus !== 'done' && task.status === 'done' && task.agent_assigned_id) {
            const agent = agents.value.find(a => a.id === task.agent_assigned_id)
            if (!agent || agent.auto_launch === 0) continue
            if (agent.type === 'planner') continue // never auto-close: planner agents are interactive
            // Find the specific tab linked to this task (T1249)
            const tab = tabsStore.tabs.find(t =>
              t.type === 'terminal' &&
              t.agentName === agent.name &&
              t.taskId === task.id
            )
            if (tab) scheduleClose(tab, agent.id)
          }
        }

        // --- Chemin 2: tabs without taskId (review, doc…) ---
        // Iterate over open terminal tabs; skip task-linked tabs (handled by Chemin 1).
        // No fallback timer (T1246): session duration is unpredictable for these agents.
        for (const tab of tabsStore.tabs.filter(t => t.type === 'terminal')) {
          if (!tab.agentName) continue
          const agentForTab = agents.value.find(a => a.name === tab.agentName)
          if (agentForTab?.type === 'planner') continue // never auto-close: planner agents are interactive
          const agent = agentForTab
          if (!agent || agent.auto_launch === 0) continue
          if (tab.taskId) continue // task-linked tab: handled by Chemin 1
          if (tab.streamId) continue // T1937: don't auto-close tabs with an active agent process
          if (!pendingCloses.has(tab.id)) {
            // lookbackMs=0: only match sessions that completed AFTER this schedule (T1242 Fix 3)
            // fallbackMs=120s: safety net for tabs that never get a session completion (T1820)
            scheduleClose(tab, agent.id, 120_000, 0, NO_TASK_POST_COMPLETE_DELAY_MS)
          }
        }
      }

      // --- T341: Auto-launch review session ---
      if (settingsStore.autoReviewEnabled) {
        checkReviewThreshold(current)
      }

      // Update tracking state
      previousStatuses = new Map(current.map(t => [t.id, t.status]))
    }, 80)
  }, { deep: false })

  // Reset tracking when project changes
  watch(dbPath, () => {
    initialized = false
    previousStatuses = new Map()
    lastReviewLaunchedAt = 0
    if (debounceId !== null) {
      clearTimeout(debounceId)
      debounceId = null
    }
    for (const pending of pendingCloses.values()) {
      if (pending.fallbackId) clearTimeout(pending.fallbackId)
    }
    pendingCloses.clear()
    stopSharedPoller()
  })

  onUnmounted(() => {
    if (debounceId !== null) {
      clearTimeout(debounceId)
      debounceId = null
    }
    for (const pending of pendingCloses.values()) {
      if (pending.fallbackId) clearTimeout(pending.fallbackId)
    }
    pendingCloses.clear()
    stopSharedPoller()
    for (const id of looseTimeouts) {
      clearTimeout(id)
    }
    looseTimeouts.clear()
    pendingImmediatePolls.clear()
  })

  function checkReviewThreshold(currentTasks: Task[]): void {
    // Fast O(N) count without array allocation — filter only when threshold is met (T533)
    let doneCount = 0
    for (const t of currentTasks) if (t.status === 'done') doneCount++
    if (doneCount < settingsStore.autoReviewThreshold) return

    if (Date.now() - lastReviewLaunchedAt < REVIEW_COOLDOWN_MS) return

    const reviewAgent = agents.value.find(a => a.type === 'review')
    if (!reviewAgent) return

    if (tabsStore.hasAgentTerminal(reviewAgent.name)) return

    lastReviewLaunchedAt = Date.now()
    launchReviewSession(reviewAgent, currentTasks.filter(t => t.status === 'done'))
  }

  function doClose(tabId: string): void {
    if (!pendingCloses.has(tabId)) return // T1243 race guard
    const pending = pendingCloses.get(tabId)!
    if (pending.fallbackId) clearTimeout(pending.fallbackId)
    pendingCloses.delete(tabId)
    if (pendingCloses.size === 0) stopSharedPoller()

    const tab = tabsStore.tabs.find(t => t.id === tabId)
    if (tab) {
      if (tab.streamId) window.electronAPI.agentKill(tab.streamId).catch(() => {})
      const closeId = setTimeout(() => {
        looseTimeouts.delete(closeId)
        tabsStore.closeTab(tab.id)
      }, pending.postCompleteDelayMs)
      looseTimeouts.add(closeId)
    }
  }

  async function pollSessionStatus(tabId: string, agentId: number, path: string, notBefore: string): Promise<void> {
    try {
      // Only detect sessions that completed AFTER the close was scheduled, preventing
      // false positives from previous sessions completed within the last few minutes.
      // T1820: removed NOT EXISTS clause — zombie 'started' sessions were blocking detection.
      // The ended_at >= notBefore filter is sufficient to avoid false positives.
      const rows = await window.electronAPI.queryDb(
        path,
        `SELECT id FROM sessions WHERE agent_id = ? AND status = 'completed' AND ended_at >= ?
         ORDER BY id DESC LIMIT 1`,
        [agentId, notBefore]
      ) as { id: number }[]
      if (rows.length > 0) {
        doClose(tabId)
      }
    } catch {
      // Ignore transient poll errors
    }
  }

  function scheduleClose(tab: Tab, agentId: number, fallbackMs: number = FALLBACK_CLOSE_MS, lookbackMs: number = SCHEDULE_LOOKBACK_MS, postCompleteDelayMs: number = KILL_DELAY_MS): void {
    const key = tab.id
    const existing = pendingCloses.get(key)
    if (existing) {
      if (existing.fallbackId) clearTimeout(existing.fallbackId)
    }

    const path = dbPath.value
    if (!path) return

    // Use a lookback window to cover the race condition where the agent writes ended_at
    // BEFORE the renderer detects the task-done transition (T835). Without this,
    // notBefore could be after ended_at → poll never fires, only fallback triggers.
    // The 5min window is acceptable: scheduleClose only runs when an agent has an
    // active terminal AND its task just transitioned to done.
    //
    // T906: SQLite stores ended_at via CURRENT_TIMESTAMP as "YYYY-MM-DD HH:MM:SS"
    // (space separator, no T, no milliseconds, no Z). JS .toISOString() produces
    // "YYYY-MM-DDTHH:MM:SS.mmmZ". Lexicographic comparison: space (ASCII 32) < T
    // (ASCII 84), so ISO strings always compare GREATER than SQLite timestamps,
    // making ended_at >= notBefore always false. Fix: use SQLite datetime format.
    const notBefore = new Date(Date.now() - lookbackMs).toISOString().replace('T', ' ').slice(0, 19)

    // Immediate poll — guarded to prevent N parallel polls when watch fires rapidly
    if (!pendingImmediatePolls.has(key)) {
      pendingImmediatePolls.add(key)
      const pollId = setTimeout(() => {
        looseTimeouts.delete(pollId)
        pendingImmediatePolls.delete(key)
        void pollSessionStatus(key, agentId, path, notBefore)
      }, 0)
      looseTimeouts.add(pollId)
    }

    // fallbackMs=0 means no fallback (T1246: no forced close for no-task agents)
    const fallbackId = fallbackMs > 0 ? setTimeout(() => {
      doClose(key)
    }, fallbackMs) : null

    // Store poll data in the entry — the single shared interval reads it each tick (T1962)
    pendingCloses.set(key, { agentId, path, notBefore, fallbackId, postCompleteDelayMs })
    startSharedPoller()
  }

  /** Start the single shared poll interval if not already running (T1962) */
  function startSharedPoller(): void {
    if (sharedIntervalId !== null) return
    sharedIntervalId = setInterval(() => {
      for (const [tabId, pending] of pendingCloses) {
        void pollSessionStatus(tabId, pending.agentId, pending.path, pending.notBefore)
      }
    }, POLL_INTERVAL_MS)
  }

  /** Stop the single shared poll interval (T1962) */
  function stopSharedPoller(): void {
    if (sharedIntervalId === null) return
    clearInterval(sharedIntervalId)
    sharedIntervalId = null
  }
}
