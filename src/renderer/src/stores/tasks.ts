/**
 * Pinia store for tasks, agents, and project management.
 *
 * Manages:
 * - Project connection (dbPath, projectPath) — delegated to useProjectStore
 * - Agents list, groups — delegated to useAgentsStore
 * - Tasks CRUD and filtering
 * - Real-time polling and file watching — delegated to useTaskRefresh
 *
 * Acts as a facade: exposes all symbols from sub-stores for backward compatibility.
 *
 * @module stores/tasks
 */

import { defineStore, storeToRefs } from 'pinia'
import { ref, computed, watch } from 'vue'
import type { Task, Stats, TaskComment, TaskLink, Perimetre, TaskAssignee } from '@renderer/types'
import { useProjectStore } from '@renderer/stores/project'
import { useAgentsStore } from '@renderer/stores/agents'
import { useTabsStore } from '@renderer/stores/tabs'
import { useSettingsStore } from '@renderer/stores/settings'
import { useTaskRefresh } from '@renderer/stores/useTaskRefresh'

export { DONE_TASKS_LIMIT } from '@renderer/stores/useTaskRefresh'

export const useTasksStore = defineStore('tasks', () => {
  // Sub-stores
  const projectStore = useProjectStore()
  const agentsStore = useAgentsStore()
  const settingsStore = useSettingsStore()

  const { projectPath, dbPath, setupWizardTarget } = storeToRefs(projectStore)
  const { agents, agentGroups } = storeToRefs(agentsStore)

  // Local tasks state
  const tasks = ref<Task[]>([])
  const perimetresData = ref<Perimetre[]>([])
  const stats = ref<Stats>({ todo: 0, in_progress: 0, done: 0, archived: 0, rejected: 0 })
  const lastRefresh = ref<Date | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const selectedAgentId = ref<number | null>(null)
  const selectedPerimetre = ref<string | null>(null)
  const selectedTask = ref<Task | null>(null)
  const taskComments = ref<TaskComment[]>([])
  const taskLinks = ref<TaskLink[]>([])
  const taskAssignees = ref<TaskAssignee[]>([])
  const boardAssignees = ref<Map<number, TaskAssignee[]>>(new Map())
  const doneTasksLimited = ref(false)
  const migrationError = ref<string | null>(null)

  async function query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]> {
    if (!dbPath.value) return []
    const result = await window.electronAPI.queryDb(dbPath.value, sql, params)
    if (!Array.isArray(result)) {
      const r = result as { success?: boolean; error?: string } | null
      if (r && typeof r === 'object' && r.success === false && r.error === 'DB_CORRUPT') {
        error.value = 'DB_CORRUPT'
        return []
      }
      console.warn('[tasks query] Unexpected result type:', result)
      return []
    }
    return result as T[]
  }

  // Delegate refresh/polling/watching to composable
  const {
    refresh, startPolling, stopPolling, startWatching, cleanupTimers,
    watchForDb: _refreshWatchForDb,
  } = useTaskRefresh({
    dbPath, tasks, agents, perimetresData, stats,
    lastRefresh, loading, error, doneTasksLimited, boardAssignees, query,
  })

  function toggleAgentFilter(id: number | string): void {
    const numId = Number(id)
    selectedAgentId.value = Number(selectedAgentId.value) === numId ? null : numId
  }

  function togglePerimetreFilter(p: string): void {
    selectedPerimetre.value = selectedPerimetre.value === p ? null : p
  }

  const perimetres = computed((): string[] => {
    const seen = new Set<string>()
    for (const t of tasks.value) if (t.scope) seen.add(t.scope)
    return Array.from(seen).sort()
  })

  const filteredTasks = computed(() =>
    tasks.value.filter(t => {
      if (selectedAgentId.value !== null && Number(t.agent_assigned_id) !== Number(selectedAgentId.value)) return false
      if (selectedPerimetre.value !== null && t.scope !== selectedPerimetre.value) return false
      return true
    })
  )

  const tasksByStatus = computed(() => {
    const groups: { todo: Task[]; in_progress: Task[]; done: Task[]; archived: Task[]; rejected: Task[] } = {
      todo: [], in_progress: [], done: [], archived: [], rejected: [],
    }
    for (const t of filteredTasks.value) {
      if (t.status in groups) groups[t.status as keyof typeof groups].push(t)
    }
    return groups
  })

  async function setProject(pPath: string, dPath: string): Promise<void> {
    projectPath.value = pPath
    dbPath.value = dPath
    localStorage.setItem('projectPath', pPath)
    localStorage.setItem('dbPath', dPath)
    selectedAgentId.value = null
    selectedPerimetre.value = null
    const migResult = await window.electronAPI.migrateDb(dPath)
    if (!migResult.success) {
      console.error('[initProject] migration failed:', migResult.error)
      migrationError.value = migResult.error ?? 'Migration failed'
    } else {
      migrationError.value = null
    }
    // Load worktree default from config (T1143)
    await settingsStore.loadWorktreeDefault(dPath)
    // Load project primary CLI from config (T1918)
    await settingsStore.loadPrimaryCli(dPath)
    await refresh()
    startPolling()
    startWatching(dPath)
  }

  /**
   * Opens a native directory picker to change the current project.
   *
   * If terminal tabs are open, prompts the user for confirmation before closing them all.
   * Distinguishes WSL sessions from native terminal sessions in the confirmation message.
   * If the selected directory has no `.claude/project.db`, redirects to the setup wizard.
   *
   * @returns A promise that resolves when the project is selected and loaded, or immediately
   *   if the user cancels the dialog or the confirmation prompt.
   */
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
    cleanupTimers()
    window.electronAPI.unwatchDb(dbPath.value ?? undefined)
    projectPath.value = null
    dbPath.value = null
    localStorage.removeItem('projectPath')
    localStorage.removeItem('dbPath')
    tasks.value = []
    agents.value = []
    agentGroups.value = []
    perimetresData.value = []
    boardAssignees.value.clear()
    stats.value = { todo: 0, in_progress: 0, done: 0, archived: 0, rejected: 0 }
    selectedTask.value = null
    taskComments.value = []
    selectedAgentId.value = null
    selectedPerimetre.value = null
    error.value = null
  }

  async function setTaskStatut(taskId: number, statut: 'in_progress'): Promise<void> {
    if (!dbPath.value) return
    const task = tasks.value.find(t => t.id === taskId)
    const previousStatus = task?.status
    if (task) task.status = statut
    let res: { success: boolean; error?: string; blockers?: Array<{ id: number; title: string; status: string }> }
    try {
      res = await window.electronAPI.tasksUpdateStatus(dbPath.value, taskId, statut) as typeof res
    } catch (err) {
      if (task && previousStatus !== undefined) task.status = previousStatus
      throw err
    }
    if (!res.success) {
      if (task && previousStatus !== undefined) task.status = previousStatus
      throw Object.assign(new Error(res.error ?? 'UPDATE_FAILED'), { blockers: res.blockers ?? [] })
    }
  }

  /**
   * Selects a task and loads its associated data in parallel.
   *
   * Fetches three data sets concurrently via `Promise.all`:
   * - Task comments with agent names (via SQL JOIN on `agents`)
   * - Task links (dependency relationships between tasks)
   * - Task assignees (agents assigned to the task)
   *
   * Errors in individual fetches are silently ignored to avoid blocking the UI.
   *
   * @param task - The task to open and display in the detail panel.
   */
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
    `, [task.id]).then(rows => { taskComments.value = rows }).catch(() => {})
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

  function watchForDb(path: string): void {
    _refreshWatchForDb(path, (db) => setProject(path, db))
  }

  // Reset filters whenever the project changes
  watch(dbPath, (newPath, oldPath) => {
    if (newPath !== oldPath) {
      selectedAgentId.value = null
      selectedPerimetre.value = null
    }
  })

  watch(agents, (newAgents) => {
    if (selectedAgentId.value !== null) {
      const exists = newAgents.some(a => Number(a.id) === Number(selectedAgentId.value))
      if (!exists) selectedAgentId.value = null
    }
  })

  // Auto-start if dbPath already stored
  if (dbPath.value) {
    if (!projectPath.value) {
      const parts = dbPath.value.replace(/\\/g, '/').split('/').filter(Boolean)
      if (parts.length >= 2 && parts[parts.length - 2] === '.claude') {
        const derived = dbPath.value.replace(/[\\/]\.claude[\\/][^\\/]+$/, '')
        projectPath.value = derived
        localStorage.setItem('projectPath', derived)
      }
    }
    const ensureRegistered = projectPath.value
      ? window.electronAPI.findProjectDb(projectPath.value)
      : Promise.resolve(dbPath.value)
    ensureRegistered
      .then(() => window.electronAPI.migrateDb(dbPath.value!))
      .then((migResult) => {
        if (!migResult.success) {
          console.error('[cold-start] migration failed:', migResult.error)
          migrationError.value = migResult.error ?? 'Migration failed'
        } else {
          migrationError.value = null
        }
        return refresh()
      })
      .then(() => {
        startPolling()
        startWatching(dbPath.value!)
      })
  }

  return {
    // Project store re-exports (backward compat — prefer useProjectStore for new code)
    projectPath, dbPath, setupWizardTarget,
    // Agent store re-exports (backward compat — prefer useAgentsStore for new code)
    agents, agentGroups,
    tasks, stats, lastRefresh, loading, error, doneTasksLimited, migrationError,
    selectedAgentId, toggleAgentFilter,
    selectedPerimetre, togglePerimetreFilter, perimetres, perimetresData,
    filteredTasks, tasksByStatus,
    setProject, selectProject, closeProject, watchForDb,
    refresh, startPolling, stopPolling, query, setTaskStatut,
    selectedTask, taskComments, taskLinks, taskAssignees, boardAssignees, openTask, closeTask,
  }
})
