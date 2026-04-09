/**
 * Composable handling task refresh, polling, and file watching.
 * Extracted from tasks.ts to keep the store under 400 lines.
 *
 * @module stores/useTaskRefresh
 */

import type { Ref } from 'vue'
import type { Task, Agent, Stats, Perimetre, TaskAssignee } from '@renderer/types'
import { useAgentsStore, AGENT_CTE_SQL } from '@renderer/stores/agents'
import { useSettingsStore } from '@renderer/stores/settings'
import { useToast } from '@renderer/composables/useToast'

/** Debounce: last notification timestamp per task (prevent spam). */
const _lastNotifTs: Record<number, number> = {}

/** Max number of 'done' tasks loaded in live refresh — older ones accessible via archive lazy-load. */
export const DONE_TASKS_LIMIT = 100

export interface TaskRefreshDeps {
  dbPath: Ref<string | null>
  tasks: Ref<Task[]>
  agents: Ref<Agent[]>
  perimetresData: Ref<Perimetre[]>
  stats: Ref<Stats>
  lastRefresh: Ref<Date | null>
  loading: Ref<boolean>
  error: Ref<string | null>
  doneTasksLimited: Ref<boolean>
  boardAssignees: Ref<Map<number, TaskAssignee[]>>
  query: <T = unknown>(sql: string, params?: unknown[]) => Promise<T[]>
}

export function useTaskRefresh(deps: TaskRefreshDeps) {
  const { push: pushToast } = useToast()
  const agentsStore = useAgentsStore()
  const settingsStore = useSettingsStore()

  let pollInterval: ReturnType<typeof setInterval> | null = null
  let unsubDbChange: (() => void) | null = null
  let dbWatchInterval: ReturnType<typeof setInterval> | null = null
  let dbChangeDebounce: ReturnType<typeof setTimeout> | null = null

  async function refresh(): Promise<void> {
    if (!deps.dbPath.value) return
    deps.loading.value = true
    deps.error.value = null
    try {
      const [rawLiveTasks, rawDoneTasks, rawAgents, rawStats, rawPerimetres, rawBoardAssignees] = await Promise.all([
        deps.query<Task>(`
          SELECT t.*, a.name as agent_name, a.scope as agent_scope,
            c.name as agent_creator_name
          FROM tasks t
          LEFT JOIN agents a ON a.id = t.agent_assigned_id
          LEFT JOIN agents c ON c.id = t.agent_creator_id
          WHERE t.status IN ('todo', 'in_progress')
          ORDER BY t.updated_at DESC
          LIMIT 500
        `),
        deps.query<Task>(`
          SELECT t.*, a.name as agent_name, a.scope as agent_scope,
            c.name as agent_creator_name
          FROM tasks t
          LEFT JOIN agents a ON a.id = t.agent_assigned_id
          LEFT JOIN agents c ON c.id = t.agent_creator_id
          WHERE t.status = 'done'
          ORDER BY t.updated_at DESC
          LIMIT ${DONE_TASKS_LIMIT}
        `),
        deps.query<Agent>(AGENT_CTE_SQL),
        deps.query<{ status: string; count: number }>(`
          SELECT status, COUNT(*) as count FROM tasks GROUP BY status
        `),
        deps.query<Perimetre>(`
          SELECT id, name, folder, techno, description, active
          FROM scopes WHERE active = 1 ORDER BY name
        `),
        deps.query<{ task_id: number; agent_id: number; agent_name: string; role: string | null }>(`
          SELECT ta.task_id, ta.agent_id, a.name as agent_name, ta.role
          FROM task_agents ta
          JOIN agents a ON a.id = ta.agent_id
          JOIN tasks t ON t.id = ta.task_id
          WHERE t.status != 'archived'
        `)
      ])
      const rawTasks = [...rawLiveTasks, ...rawDoneTasks]
      deps.doneTasksLimited.value = rawDoneTasks.length === DONE_TASKS_LIMIT

      const newTasks = rawTasks as Task[]
      // Desktop notifications — detect status transitions (T755)
      if (settingsStore.notificationsEnabled && Notification.permission === 'granted' && deps.tasks.value.length > 0) {
        const prevMap = new Map(deps.tasks.value.map(t => [t.id, t.status]))
        const now = Date.now()
        for (const t of newTasks) {
          const prev = prevMap.get(t.id)
          if (prev && prev !== t.status && ['in_progress', 'done'].includes(t.status)) {
            if (now - (_lastNotifTs[t.id] ?? 0) < 5000) continue
            _lastNotifTs[t.id] = now
            new Notification(`Task ${t.status === 'done' ? 'completed' : 'started'}`, {
              body: `${t.title} — ${(t as Task & { agent_name?: string }).agent_name ?? '?'}`,
              silent: false,
            })
          }
        }
        const cutoff = now - 60_000
        for (const [id, ts] of Object.entries(_lastNotifTs)) {
          if (ts < cutoff) delete _lastNotifTs[Number(id)]
        }
      }
      deps.tasks.value = newTasks
      // Rebuild boardAssignees in-place (T819)
      deps.boardAssignees.value.clear()
      for (const row of rawBoardAssignees) {
        if (!deps.boardAssignees.value.has(row.task_id)) deps.boardAssignees.value.set(row.task_id, [])
        deps.boardAssignees.value.get(row.task_id)!.push({
          agent_id: row.agent_id,
          agent_name: row.agent_name,
          role: row.role as TaskAssignee['role'],
          assigned_at: '',
        })
      }
      deps.agents.value = rawAgents
      deps.perimetresData.value = rawPerimetres

      const s: Stats = { todo: 0, in_progress: 0, done: 0, archived: 0 }
      for (const row of rawStats) {
        if (row.status in s) {
          s[row.status as keyof Stats] = row.count
        }
      }
      deps.stats.value = s
      deps.lastRefresh.value = new Date()
      agentsStore.fetchAgentGroups()
    } catch (e) {
      deps.error.value = String(e)
      pushToast(String(e))
    } finally {
      deps.loading.value = false
    }
  }

  function startPolling(): void {
    stopPolling()
    pollInterval = setInterval(refresh, 30000)
  }

  function stopPolling(): void {
    if (pollInterval) { clearInterval(pollInterval); pollInterval = null }
  }

  function startWatching(path: string): void {
    if (unsubDbChange) { unsubDbChange(); unsubDbChange = null }
    window.electronAPI.watchDb(path)
    unsubDbChange = window.electronAPI.onDbChanged(() => {
      if (dbChangeDebounce) clearTimeout(dbChangeDebounce)
      dbChangeDebounce = setTimeout(() => {
        dbChangeDebounce = null
        refresh()
      }, 150)
    })
  }

  function watchForDb(path: string): void {
    if (dbWatchInterval) clearInterval(dbWatchInterval)
    dbWatchInterval = setInterval(async () => {
      if (document.visibilityState === 'hidden') return
      const db = await window.electronAPI.findProjectDb(path)
      if (db) {
        clearInterval(dbWatchInterval!)
        dbWatchInterval = null
        return db
      }
      return null
    }, 2000)
  }

  function cleanupTimers(): void {
    stopPolling()
    if (dbChangeDebounce) { clearTimeout(dbChangeDebounce); dbChangeDebounce = null }
    if (dbWatchInterval) { clearInterval(dbWatchInterval); dbWatchInterval = null }
    if (unsubDbChange) { unsubDbChange(); unsubDbChange = null }
  }

  return {
    refresh,
    startPolling, stopPolling,
    startWatching, watchForDb,
    cleanupTimers,
  }
}
