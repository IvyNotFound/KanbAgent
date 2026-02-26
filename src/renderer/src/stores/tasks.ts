/**
 * Pinia store for tasks, agents, and project management.
 *
 * Manages:
 * - Project connection (dbPath, projectPath)
 * - Tasks CRUD and filtering
 * - Agents list with session status
 * - Locks management
 * - Real-time polling and file watching
 *
 * @module stores/tasks
 */

import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import type { Task, Agent, Lock, Stats, TaskComment, FileNode, Perimetre } from '@renderer/types'
import { useTabsStore } from '@renderer/stores/tabs'
import { useToast } from '@renderer/composables/useToast'

declare global {
  interface Window {
    electronAPI: {
      selectProjectDir(): Promise<{ projectPath: string; dbPath: string | null; error: string | null; hasCLAUDEmd: boolean } | null>
      createProjectDb(projectPath: string): Promise<{ success: boolean; dbPath: string; error?: string }>
      queryDb(dbPath: string, query: string, params?: unknown[]): Promise<unknown[]>
      watchDb(dbPath: string): Promise<void>
      unwatchDb(): Promise<void>
      onDbChanged(callback: () => void): () => void
      showConfirmDialog(opts: { title: string; message: string; detail?: string }): Promise<boolean>
      selectNewProjectDir(): Promise<string | null>
      initNewProject(projectPath: string): Promise<{ success: boolean; error?: string }>
      findProjectDb(projectPath: string): Promise<string | null>
      migrateDb(dbPath: string): Promise<{ success: boolean; error?: string }>
      getLocks(dbPath: string): Promise<unknown[]>
      // File system
      fsListDir(dirPath: string): Promise<FileNode[]>
      fsReadFile(filePath: string): Promise<{ success: boolean; content?: string; error?: string }>
      fsWriteFile(filePath: string, content: string): Promise<{ success: boolean; error?: string }>
      windowMinimize(): Promise<void>
      windowMaximize(): Promise<void>
      windowClose(): Promise<void>
      // Terminal
      terminalCreate(cols: number, rows: number, projectPath?: string): Promise<string>
      terminalWrite(id: string, data: string): Promise<void>
      terminalResize(id: string, cols: number, rows: number): Promise<void>
      terminalKill(id: string): Promise<void>
      terminalIsAlive(id: string): Promise<boolean>
      onTerminalData(id: string, cb: (data: string) => void): () => void
      onTerminalExit(id: string, cb: () => void): () => void
      closeAgentSessions(dbPath: string, agentName: string): Promise<{ success: boolean; error?: string }>
      renameAgent(dbPath: string, agentId: number, newName: string): Promise<{ success: boolean; error?: string }>
      updatePerimetre(dbPath: string, id: number, oldName: string, newName: string, description: string): Promise<{ success: boolean; error?: string }>
      updateAgentSystemPrompt(dbPath: string, agentId: number, systemPrompt: string): Promise<{ success: boolean; error?: string }>
      buildAgentPrompt(agentName: string, userPrompt: string): Promise<string>
      searchTasks(
        dbPath: string,
        query: string,
        filters?: { statut?: string; agent_id?: number; perimetre?: string }
      ): Promise<{ success: boolean; results: unknown[]; error?: string }>
      // Config DB
      getConfigValue(dbPath: string, key: string): Promise<{ success: boolean; value: string | null; error?: string }>
      setConfigValue(dbPath: string, key: string, value: string): Promise<{ success: boolean; error?: string }>
      // CLAUDE.md sync
      checkMasterClaudeMd(dbPath: string): Promise<{ success: boolean; sha?: string; content?: string; upToDate?: boolean; localSha?: string; error?: string }>
      applyMasterClaudeMd(dbPath: string, projectPath: string, content: string, sha: string): Promise<{ success: boolean; error?: string }>
      // Agents
      updateAgent(dbPath: string, agentId: number, updates: { name?: string; type?: string; perimetre?: string | null; thinkingMode?: string | null; allowedTools?: string | null; systemPrompt?: string | null; systemPromptSuffix?: string | null; autoLaunch?: boolean; permissionMode?: 'default' | 'auto' | null; maxSessions?: number }): Promise<{ success: boolean; error?: string }>
      createAgent(dbPath: string, projectPath: string, data: { name: string; type: string; perimetre: string | null; thinkingMode: string | null; systemPrompt: string | null; description: string }): Promise<{ success: boolean; agentId?: number; claudeMdUpdated?: boolean; error?: string }>
      // GitHub (secure — token stays in main process)
      testGithubConnection(dbPath: string, repoUrl: string): Promise<{ connected: boolean; error?: string }>
      checkForUpdates(dbPath: string, repoUrl: string, currentVersion: string): Promise<{ hasUpdate: boolean; latestVersion: string; error?: string }>
      // Task assignees (multi-agent — ADR-008)
      getTaskAssignees(dbPath: string, taskId: number): Promise<{ success: boolean; assignees: Array<{ agent_id: number; agent_name: string; role: string | null; assigned_at: string }>; error?: string }>
      setTaskAssignees(dbPath: string, taskId: number, assignees: Array<{ agentId: number; role?: string | null }>): Promise<{ success: boolean; error?: string }>
      tasksGetArchived(dbPath: string, params: { page: number; pageSize: number; agentId?: number | null; perimetre?: string | null }): Promise<{ rows: unknown[]; total: number }>
      deleteAgent(dbPath: string, agentId: number): Promise<{ success: boolean; hasHistory?: boolean; error?: string }>
      addPerimetre(dbPath: string, name: string): Promise<{ success: boolean; id?: number; error?: string }>
      tasksUpdateStatus(dbPath: string, taskId: number, statut: string): Promise<{ success: boolean; error?: string }>
      duplicateAgent(dbPath: string, agentId: number): Promise<{ success: boolean; agentId?: number; name?: string; error?: string }>
    }
  }
}

// sql.js returns Uint8Array for TEXT columns in some cases — convert to string
function toStr(v: unknown): unknown {
  if (v instanceof Uint8Array) return new TextDecoder().decode(v)
  return v
}

function normalizeRow<T extends Record<string, unknown>>(row: T): T {
  const out = {} as T
  for (const k in row) out[k] = toStr(row[k]) as T[typeof k]
  return out
}

/**
 * Main tasks store using Pinia composition API.
 *
 * State:
 * - projectPath, dbPath: Current project connection
 * - tasks, agents, locks: Data from SQLite
 * - stats: Task counts by status
 * - selectedTask, taskComments: Current task details
 *
 * Actions:
 * - setProject, selectProject, closeProject: Project lifecycle
 * - refresh: Fetch latest data from DB
 * - openTask, closeTask: Task drill-down
 *
 * Computed:
 * - filteredTasks: Tasks filtered by agent/perimetre
 * - tasksByStatus: Tasks grouped by status
 *
 * @returns {object} Store instance with state and methods
 */
// Shared SQL: agent list with latest session + last log timestamp + has_history flag
const AGENT_CTE_SQL = `
  WITH latest_sessions AS (
    SELECT agent_id, statut, started_at,
           ROW_NUMBER() OVER (PARTITION BY agent_id ORDER BY started_at DESC) as rn
    FROM sessions
  ),
  max_logs AS (
    SELECT agent_id, MAX(created_at) as last_log_at
    FROM agent_logs GROUP BY agent_id
  ),
  agent_history AS (
    SELECT a.id,
      CASE WHEN (
        (SELECT COUNT(*) FROM sessions WHERE agent_id = a.id) +
        (SELECT COUNT(*) FROM tasks WHERE agent_assigne_id = a.id) +
        (SELECT COUNT(*) FROM task_comments WHERE agent_id = a.id) +
        (SELECT COUNT(*) FROM agent_logs WHERE agent_id = a.id)
      ) > 0 THEN 1 ELSE 0 END as has_history
    FROM agents a
  )
  SELECT a.*, ls.statut as session_statut, ls.started_at as session_started_at, ml.last_log_at, ah.has_history
  FROM agents a
  LEFT JOIN latest_sessions ls ON ls.agent_id = a.id AND ls.rn = 1
  LEFT JOIN max_logs ml ON ml.agent_id = a.id
  LEFT JOIN agent_history ah ON ah.id = a.id
  WHERE a.type != 'setup' ORDER BY a.name
`

const LOCKS_SQL = `
  SELECT l.*, a.name as agent_name FROM locks l
  JOIN agents a ON a.id = l.agent_id
  WHERE l.released_at IS NULL
`

export const useTasksStore = defineStore('tasks', () => {
  const { push: pushToast } = useToast()
  const projectPath = ref<string | null>(localStorage.getItem('projectPath'))
  const dbPath = ref<string | null>(localStorage.getItem('dbPath'))
  const tasks = ref<Task[]>([])
  const agents = ref<Agent[]>([])
  const locks = ref<Lock[]>([])
  const perimetresData = ref<Perimetre[]>([])
  const stats = ref<Stats>({ todo: 0, in_progress: 0, done: 0, archived: 0 })
  const lastRefresh = ref<Date | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const selectedAgentId = ref<number | null>(null)
  const selectedPerimetre = ref<string | null>(null)
  const selectedTask = ref<Task | null>(null)
  const taskComments = ref<TaskComment[]>([])
  const setupWizardTarget = ref<{ projectPath: string; hasCLAUDEmd: boolean } | null>(null)

  let pollInterval: ReturnType<typeof setInterval> | null = null
  let agentPollInterval: ReturnType<typeof setInterval> | null = null
  let unsubDbChange: (() => void) | null = null

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

  async function setProject(pPath: string, dPath: string): Promise<void> {
    projectPath.value = pPath
    dbPath.value = dPath
    localStorage.setItem('projectPath', pPath)
    localStorage.setItem('dbPath', dPath)
    // Reset filters when switching projects — agent/perimetre IDs are project-specific
    selectedAgentId.value = null
    selectedPerimetre.value = null
    await window.electronAPI.migrateDb(dPath)
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
    perimetresData.value = []
    stats.value = { todo: 0, in_progress: 0, done: 0, archived: 0 }
    selectedTask.value = null
    taskComments.value = []
    selectedAgentId.value = null
    selectedPerimetre.value = null
    error.value = null
  }

  function setProjectPathOnly(path: string): void {
    projectPath.value = path
    localStorage.setItem('projectPath', path)
    // dbPath reste null jusqu'à ce que la db soit créée
  }

  let dbWatchInterval: ReturnType<typeof setInterval> | null = null
  let dbChangeDebounce: ReturnType<typeof setTimeout> | null = null

  function watchForDb(path: string): void {
    if (dbWatchInterval) clearInterval(dbWatchInterval)
    dbWatchInterval = setInterval(async () => {
      const db = await window.electronAPI.findProjectDb(path)
      if (db) {
        clearInterval(dbWatchInterval!)
        dbWatchInterval = null
        await setProject(path, db)
      }
    }, 2000)
  }

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
      const [rawTasks, rawAgents, rawLocks, rawStats, rawPerimetres] = await Promise.all([
        query<Task>(`
          SELECT t.*, a.name as agent_name, a.perimetre as agent_perimetre,
            c.name as agent_createur_name
          FROM tasks t
          LEFT JOIN agents a ON a.id = t.agent_assigne_id
          LEFT JOIN agents c ON c.id = t.agent_createur_id
          WHERE t.statut != 'archived'
          ORDER BY t.updated_at DESC
        `),
        query<Agent>(AGENT_CTE_SQL),
        query<Lock>(LOCKS_SQL),
        query<{ statut: string; count: number }>(`
          SELECT statut, COUNT(*) as count FROM tasks GROUP BY statut
        `),
        query<Perimetre>(`
          SELECT id, name, dossier, techno, description, actif
          FROM perimetres WHERE actif = 1 ORDER BY name
        `)
      ])

      tasks.value = rawTasks.map(normalizeRow)
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
    } catch (e) {
      error.value = String(e)
      pushToast(String(e))
    } finally {
      loading.value = false
    }
  }

  async function agentRefresh(): Promise<void> {
    if (!dbPath.value) return
    // Skip refresh when window is not visible to save resources
    if (document.visibilityState === 'hidden') return
    try {
      const [rawAgents, rawLocks] = await Promise.all([
        query<Agent>(AGENT_CTE_SQL),
        query<Lock>(LOCKS_SQL),
      ])
      agents.value = rawAgents.map(normalizeRow)
      locks.value = rawLocks.map(normalizeRow)
    } catch {
      // silent: main refresh handles error display
    }
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
    try {
      const rows = await query<TaskComment>(`
        SELECT tc.*, a.name as agent_name
        FROM task_comments tc
        LEFT JOIN agents a ON a.id = tc.agent_id
        WHERE tc.task_id = ?
        ORDER BY tc.created_at ASC
      `, [task.id])
      taskComments.value = rows.map(normalizeRow)
    } catch {
      // table absente ou erreur : on affiche le modal sans commentaires
    }
  }

  function closeTask(): void {
    selectedTask.value = null
    taskComments.value = []
  }

  function closeWizard(): void {
    setupWizardTarget.value = null
  }

  async function setTaskStatut(taskId: number, statut: 'in_progress'): Promise<void> {
    if (!dbPath.value) return
    await window.electronAPI.tasksUpdateStatus(dbPath.value, taskId, statut)
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
    projectPath, dbPath, tasks, agents, locks, stats, lastRefresh, loading, error,
    selectedAgentId, toggleAgentFilter,
    selectedPerimetre, togglePerimetreFilter, perimetres, perimetresData,
    filteredTasks, tasksByStatus,
    setProject, selectProject, closeProject, setProjectPathOnly, watchForDb,
    refresh, agentRefresh, startPolling, stopPolling, query, setTaskStatut,
    selectedTask, taskComments, openTask, closeTask,
    setupWizardTarget, closeWizard
  }
})
