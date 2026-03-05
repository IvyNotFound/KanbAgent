/**
 * Pinia store for tasks, agents, and project management.
 *
 * Manages:
 * - Project connection (dbPath, projectPath) — delegated to useProjectStore
 * - Agents list, locks, groups — delegated to useAgentsStore
 * - Tasks CRUD and filtering
 * - Real-time polling and file watching
 *
 * Acts as a facade: exposes all symbols from sub-stores for backward compatibility.
 *
 * @module stores/tasks
 */

import { defineStore, storeToRefs } from 'pinia'
import { ref, computed, watch } from 'vue'
import type { Task, Agent, Lock, Stats, TaskComment, TaskLink, Perimetre, TaskAssignee } from '@renderer/types'
import { useProjectStore } from '@renderer/stores/project'
import { useAgentsStore, AGENT_CTE_SQL, LOCKS_SQL } from '@renderer/stores/agents'
import { useTabsStore } from '@renderer/stores/tabs'
import { useSettingsStore } from '@renderer/stores/settings'
import { useToast } from '@renderer/composables/useToast'
import { normalizeRow } from '@renderer/utils/db'

/** Debounce: last notification timestamp per task (prevent spam). */
const _lastNotifTs: Record<number, number> = {}

/** Max number of 'done' tasks loaded in live refresh — older ones accessible via archive lazy-load. */
export const DONE_TASKS_LIMIT = 100

export const useTasksStore = defineStore('tasks', () => {
  const { push: pushToast } = useToast()

  // Sub-stores
  const projectStore = useProjectStore()
  const agentsStore = useAgentsStore()
  const settingsStore = useSettingsStore()

  // Reactive refs delegated from sub-stores (storeToRefs gives back the original refs — mutations propagate)
  const { projectPath, dbPath, setupWizardTarget } = storeToRefs(projectStore)
  const { agents, locks, agentGroups } = storeToRefs(agentsStore)

  // Local tasks state
  const tasks = ref<Task[]>([])
  const perimetresData = ref<Perimetre[]>([])
  const stats = ref<Stats>({ todo: 0, in_progress: 0, done: 0, archived: 0 })
  const lastRefresh = ref<Date | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  /** Stale task threshold in minutes — loaded from config `stale_threshold_minutes`, default 120. */
  const staleThresholdMinutes = ref<number>(120)
  const selectedAgentId = ref<number | null>(null)
  const selectedPerimetre = ref<string | null>(null)
  const selectedTask = ref<Task | null>(null)
  const taskComments = ref<TaskComment[]>([])
  const taskLinks = ref<TaskLink[]>([])
  const taskAssignees = ref<TaskAssignee[]>([])
  /** Board-level assignees indexed by task_id — loaded once in refresh(), no per-card IPC (T787) */
  const boardAssignees = ref<Map<number, TaskAssignee[]>>(new Map())
  /** True when done tasks are capped at DONE_TASKS_LIMIT — signals UI that older done tasks exist */
  const doneTasksLimited = ref(false)

  let pollInterval: ReturnType<typeof setInterval> | null = null
  let agentPollInterval: ReturnType<typeof setInterval> | null = null
  let unsubDbChange: (() => void) | null = null
  let dbWatchInterval: ReturnType<typeof setInterval> | null = null
  let dbChangeDebounce: ReturnType<typeof setTimeout> | null = null

  function toggleAgentFilter(id: number | string): void {
    const numId = Number(id)
    selectedAgentId.value = Number(selectedAgentId.value) === numId ? null : numId
  }

  function togglePerimetreFilter(p: string): void {
    selectedPerimetre.value = selectedPerimetre.value === p ? null : p
  }

  // P3-B: single O(N) pass over tasks — Set deduplicates, Array.from+sort at the end only
  const perimetres = computed((): string[] => {
    const seen = new Set<string>()
    for (const t of tasks.value) if (t.perimetre) seen.add(t.perimetre)
    return Array.from(seen).sort()
  })

  const filteredTasks = computed(() =>
    tasks.value.filter(t => {
      if (selectedAgentId.value !== null && Number(t.agent_assigne_id) !== Number(selectedAgentId.value)) return false
      if (selectedPerimetre.value !== null && t.perimetre !== selectedPerimetre.value) return false
      return true
    })
  )

  // P3-A: single O(N) pass — replaces 4 separate .filter() calls (one per status)
  const tasksByStatus = computed(() => {
    const groups: { todo: Task[]; in_progress: Task[]; done: Task[]; archived: Task[] } = {
      todo: [], in_progress: [], done: [], archived: [],
    }
    for (const t of filteredTasks.value) {
      if (t.statut in groups) groups[t.statut as keyof typeof groups].push(t)
    }
    return groups
  })

  async function query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]> {
    if (!dbPath.value) return []
    const result = await window.electronAPI.queryDb(dbPath.value, sql, params)
    // Handle error responses from IPC (e.g., blocked write attempts)
    if (!Array.isArray(result)) {
      console.warn('[tasks query] Unexpected result type:', result)
      return []
    }
    return result as T[]
  }

  async function refresh(): Promise<void> {
    if (!dbPath.value) return
    loading.value = true
    error.value = null
    try {
      // Split tasks query: load all active tasks + cap done tasks to avoid memory bloat (T819)
      const [rawLiveTasks, rawDoneTasks, rawAgents, rawLocks, rawStats, rawPerimetres, rawBoardAssignees] = await Promise.all([
        query<Task>(`
          SELECT t.*, a.name as agent_name, a.perimetre as agent_perimetre,
            c.name as agent_createur_name
          FROM tasks t
          LEFT JOIN agents a ON a.id = t.agent_assigne_id
          LEFT JOIN agents c ON c.id = t.agent_createur_id
          WHERE t.statut IN ('todo', 'in_progress')
          ORDER BY t.updated_at DESC
        `),
        query<Task>(`
          SELECT t.*, a.name as agent_name, a.perimetre as agent_perimetre,
            c.name as agent_createur_name
          FROM tasks t
          LEFT JOIN agents a ON a.id = t.agent_assigne_id
          LEFT JOIN agents c ON c.id = t.agent_createur_id
          WHERE t.statut = 'done'
          ORDER BY t.updated_at DESC
          LIMIT ${DONE_TASKS_LIMIT}
        `),
        query<Agent>(AGENT_CTE_SQL),
        query<Lock>(LOCKS_SQL),
        query<{ statut: string; count: number }>(`
          SELECT statut, COUNT(*) as count FROM tasks GROUP BY statut
        `),
        query<Perimetre>(`
          SELECT id, name, dossier, techno, description, actif
          FROM perimetres WHERE actif = 1 ORDER BY name
        `),
        // Batch load all board assignees in one query — eliminates N per-card IPC calls (T787)
        query<{ task_id: number; agent_id: number; agent_name: string; role: string | null }>(`
          SELECT ta.task_id, ta.agent_id, a.name as agent_name, ta.role
          FROM task_agents ta
          JOIN agents a ON a.id = ta.agent_id
          JOIN tasks t ON t.id = ta.task_id
          WHERE t.statut != 'archived'
        `)
      ])
      const rawTasks = [...rawLiveTasks, ...rawDoneTasks]
      doneTasksLimited.value = rawDoneTasks.length === DONE_TASKS_LIMIT

      const newTasks = rawTasks.map(normalizeRow) as Task[]
      // Desktop notifications — detect statut transitions (T755)
      if (settingsStore.notificationsEnabled && Notification.permission === 'granted' && tasks.value.length > 0) {
        const prevMap = new Map(tasks.value.map(t => [t.id, t.statut]))
        const now = Date.now()
        for (const t of newTasks) {
          const prev = prevMap.get(t.id)
          if (prev && prev !== t.statut && ['in_progress', 'done'].includes(t.statut)) {
            // Debounce: skip if notified for this task in last 5s
            if (now - (_lastNotifTs[t.id] ?? 0) < 5000) continue
            _lastNotifTs[t.id] = now
            new Notification(`Tâche ${t.statut === 'done' ? 'terminée' : 'démarrée'}`, {
              body: `${t.titre} — ${(t as Task & { agent_name?: string }).agent_name ?? '?'}`,
              silent: false,
            })
          }
        }
      }
      tasks.value = newTasks
      // Rebuild boardAssignees in-place — avoids new Map allocation each refresh (T819)
      boardAssignees.value.clear()
      for (const row of rawBoardAssignees) {
        if (!boardAssignees.value.has(row.task_id)) boardAssignees.value.set(row.task_id, [])
        boardAssignees.value.get(row.task_id)!.push({
          agent_id: row.agent_id,
          agent_name: row.agent_name,
          role: row.role as TaskAssignee['role'],
          assigned_at: '',
        })
      }
      // Update agentsStore state via storeToRefs refs — mutations propagate to the sub-store
      agents.value = rawAgents.map(normalizeRow)
      locks.value = rawLocks.map(normalizeRow)
      perimetresData.value = rawPerimetres.map(normalizeRow)

      const s: Stats = { todo: 0, in_progress: 0, done: 0, archived: 0 }
      for (const row of rawStats) {
        if (row.statut in s) {
          s[row.statut as keyof Stats] = row.count
        }
      }
      stats.value = s
      lastRefresh.value = new Date()
      // Reload agent groups alongside main refresh
      agentsStore.fetchAgentGroups()
    } catch (e) {
      error.value = String(e)
      pushToast(String(e))
    } finally {
      loading.value = false
    }
  }

  // Delegate to agentsStore — updates agents/locks state in sub-store
  async function agentRefresh(): Promise<void> {
    await agentsStore.agentRefresh()
  }

  async function setProject(pPath: string, dPath: string): Promise<void> {
    projectPath.value = pPath
    dbPath.value = dPath
    localStorage.setItem('projectPath', pPath)
    localStorage.setItem('dbPath', dPath)
    // Reset filters when switching projects — agent/perimetre IDs are project-specific
    selectedAgentId.value = null
    selectedPerimetre.value = null
    await window.electronAPI.migrateDb(dPath)
    // Load stale threshold from config (T749)
    try {
      const cfgRes = await window.electronAPI.getConfigValue(dPath, 'stale_threshold_minutes')
      if (cfgRes.success && cfgRes.value !== null) {
        const parsed = parseInt(cfgRes.value, 10)
        if (!isNaN(parsed) && parsed > 0) staleThresholdMinutes.value = parsed
      }
    } catch { /* ignore — fallback to default 120 */ }
    await refresh()
    startPolling()
    startWatching(dPath)
  }

  async function selectProject(): Promise<void> {
    const tabsStore = useTabsStore()
    const openTerminals = tabsStore.tabs.filter(t => t.type === 'terminal')

    if (openTerminals.length > 0) {
      const n = openTerminals.length
      const wslCount = openTerminals.filter(t => t.wslDistro).length
      const nonWslCount = n - wslCount
      let label: string
      if (wslCount === n) {
        label = `${n} session${n > 1 ? 's' : ''} WSL ouverte${n > 1 ? 's' : ''}`
      } else if (wslCount === 0) {
        label = `${n} session${n > 1 ? 's' : ''} terminal ouverte${n > 1 ? 's' : ''}`
      } else {
        label = `${wslCount} session${wslCount > 1 ? 's' : ''} WSL + ${nonWslCount} terminal`
      }
      const confirmed = await window.electronAPI.showConfirmDialog({
        title: 'Changer de projet',
        message: label,
        detail: 'Toutes les sessions terminal seront fermées. Continuer ?',
      })
      if (!confirmed) return
      tabsStore.closeAllTerminals()
    }

    const result = await window.electronAPI.selectProjectDir()
    if (!result) return
    if (!result.dbPath) {
      setupWizardTarget.value = { projectPath: result.projectPath, hasCLAUDEmd: result.hasCLAUDEmd }
      return
    }
    error.value = null
    await setProject(result.projectPath, result.dbPath)
  }

  function closeProject(): void {
    stopPolling()
    if (dbChangeDebounce) { clearTimeout(dbChangeDebounce); dbChangeDebounce = null }
    if (dbWatchInterval) { clearInterval(dbWatchInterval); dbWatchInterval = null }
    if (unsubDbChange) { unsubDbChange(); unsubDbChange = null }
    window.electronAPI.unwatchDb(dbPath.value ?? undefined)
    projectPath.value = null
    dbPath.value = null
    localStorage.removeItem('projectPath')
    localStorage.removeItem('dbPath')
    tasks.value = []
    agents.value = []
    locks.value = []
    agentGroups.value = []
    perimetresData.value = []
    stats.value = { todo: 0, in_progress: 0, done: 0, archived: 0 }
    selectedTask.value = null
    taskComments.value = []
    selectedAgentId.value = null
    selectedPerimetre.value = null
    error.value = null
    // Clear debounce to prevent stale refresh after close (T796)
    if (dbChangeDebounce) { clearTimeout(dbChangeDebounce); dbChangeDebounce = null }
  }

  // Delegate to projectStore
  function setProjectPathOnly(path: string): void {
    projectStore.setProjectPathOnly(path)
  }

  function watchForDb(path: string): void {
    if (dbWatchInterval) clearInterval(dbWatchInterval)
    dbWatchInterval = setInterval(async () => {
      if (document.visibilityState === 'hidden') return
      const db = await window.electronAPI.findProjectDb(path)
      if (db) {
        clearInterval(dbWatchInterval!)
        dbWatchInterval = null
        await setProject(path, db)
      }
    }, 2000)
  }

  function startPolling(): void {
    stopPolling()
    // 5min fallback — file watcher is primary, these only trigger if watcher silently fails
    pollInterval = setInterval(refresh, 300000)
    agentPollInterval = setInterval(agentRefresh, 300000)
  }

  function stopPolling(): void {
    if (pollInterval) {
      clearInterval(pollInterval)
      pollInterval = null
    }
    if (agentPollInterval) {
      clearInterval(agentPollInterval)
      agentPollInterval = null
    }
  }

  async function openTask(task: Task): Promise<void> {
    selectedTask.value = task
    taskComments.value = []
    taskLinks.value = []
    taskAssignees.value = []
    const commentsPromise = query<TaskComment>(`
      SELECT tc.*, a.name as agent_name
      FROM task_comments tc
      LEFT JOIN agents a ON a.id = tc.agent_id
      WHERE tc.task_id = ?
      ORDER BY tc.created_at ASC
    `, [task.id]).then(rows => { taskComments.value = rows.map(normalizeRow) }).catch(() => {})
    const linksPromise = dbPath.value
      ? window.electronAPI.getTaskLinks(dbPath.value, task.id)
          .then(res => { if (res.success) taskLinks.value = res.links as TaskLink[] })
          .catch(() => {})
      : Promise.resolve()
    const assigneesPromise = dbPath.value
      ? window.electronAPI.getTaskAssignees(dbPath.value, task.id)
          .then(res => { if (res.success) taskAssignees.value = res.assignees as TaskAssignee[] })
          .catch(() => {})
      : Promise.resolve()
    await Promise.all([commentsPromise, linksPromise, assigneesPromise])
  }

  function closeTask(): void {
    selectedTask.value = null
    taskComments.value = []
    taskLinks.value = []
    taskAssignees.value = []
  }

  // Delegate to projectStore
  function closeWizard(): void {
    projectStore.closeWizard()
  }

  // Agent group operations — delegate to agentsStore
  async function fetchAgentGroups(): Promise<void> {
    await agentsStore.fetchAgentGroups()
  }

  async function createAgentGroup(name: string) {
    return agentsStore.createAgentGroup(name)
  }

  async function renameAgentGroup(groupId: number, name: string): Promise<void> {
    return agentsStore.renameAgentGroup(groupId, name)
  }

  async function deleteAgentGroup(groupId: number): Promise<void> {
    return agentsStore.deleteAgentGroup(groupId)
  }

  async function setAgentGroup(agentId: number, groupId: number | null, sortOrder?: number): Promise<void> {
    return agentsStore.setAgentGroup(agentId, groupId, sortOrder)
  }

  async function setTaskStatut(taskId: number, statut: 'in_progress'): Promise<void> {
    if (!dbPath.value) return
    // Optimistic update — move card instantly, rollback on failure
    const task = tasks.value.find(t => t.id === taskId)
    const previousStatut = task?.statut
    if (task) task.statut = statut
    let res: { success: boolean; error?: string; blockers?: Array<{ id: number; titre: string; statut: string }> }
    try {
      res = await window.electronAPI.tasksUpdateStatus(dbPath.value, taskId, statut) as typeof res
    } catch (err) {
      if (task && previousStatut !== undefined) task.statut = previousStatut
      throw err
    }
    if (!res.success) {
      if (task && previousStatut !== undefined) task.statut = previousStatut
      throw Object.assign(new Error(res.error ?? 'UPDATE_FAILED'), { blockers: res.blockers ?? [] })
    }
  }

  function startWatching(path: string): void {
    if (unsubDbChange) { unsubDbChange(); unsubDbChange = null }
    window.electronAPI.watchDb(path)
    // File watcher triggers refresh with 150ms debounce to coalesce burst writes
    unsubDbChange = window.electronAPI.onDbChanged(() => {
      if (dbChangeDebounce) clearTimeout(dbChangeDebounce)
      dbChangeDebounce = setTimeout(() => {
        dbChangeDebounce = null
        refresh()
      }, 150)
    })
  }

  // Reset agent/perimetre filters whenever the project changes (IDs are project-specific)
  watch(dbPath, (newPath, oldPath) => {
    if (newPath !== oldPath) {
      selectedAgentId.value = null
      selectedPerimetre.value = null
    }
  })

  // Auto-clear selectedAgentId if the agent doesn't exist in the current project
  // (prevents invisible stale filters after switching projects)
  watch(agents, (newAgents) => {
    if (selectedAgentId.value !== null) {
      const exists = newAgents.some(a => Number(a.id) === Number(selectedAgentId.value))
      if (!exists) selectedAgentId.value = null
    }
  })

  // Auto-start if dbPath already stored
  if (dbPath.value) {
    // Migration: derive projectPath from dbPath if not yet stored (.claude/xxx.db → parent dir)
    if (!projectPath.value) {
      const parts = dbPath.value.replace(/\\/g, '/').split('/').filter(Boolean)
      if (parts.length >= 2 && parts[parts.length - 2] === '.claude') {
        const derived = dbPath.value.replace(/[\\/]\.claude[\\/][^\\/]+$/, '')
        projectPath.value = derived
        localStorage.setItem('projectPath', derived)
      }
    }
    // Re-register dbPath in main process (allowedDbPaths is cleared on each app restart)
    const ensureRegistered = projectPath.value
      ? window.electronAPI.findProjectDb(projectPath.value)
      : Promise.resolve(dbPath.value)
    ensureRegistered
      .then(() => window.electronAPI.migrateDb(dbPath.value!))
      .then(() => refresh())
      .then(() => {
        startPolling()
        startWatching(dbPath.value!)
      })
  }

  return {
    // Project state (via projectStore)
    projectPath, dbPath, setupWizardTarget,
    setProjectPathOnly, closeWizard,
    // Agents state (via agentsStore)
    agents, locks, agentGroups,
    agentRefresh, fetchAgentGroups,
    createAgentGroup, renameAgentGroup, deleteAgentGroup, setAgentGroup,
    // Tasks state
    tasks, stats, lastRefresh, loading, error, staleThresholdMinutes, doneTasksLimited,
    selectedAgentId, toggleAgentFilter,
    selectedPerimetre, togglePerimetreFilter, perimetres, perimetresData,
    filteredTasks, tasksByStatus,
    setProject, selectProject, closeProject, watchForDb,
    refresh, startPolling, stopPolling, query, setTaskStatut,
    selectedTask, taskComments, taskLinks, taskAssignees, boardAssignees, openTask, closeTask,
  }
})
