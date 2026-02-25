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
import { ref, computed } from 'vue'
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
      getLocksCount(dbPath: string): Promise<number>
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
      createAgent(dbPath: string, projectPath: string, data: { name: string; type: string; perimetre: string | null; thinkingMode: string | null; systemPrompt: string | null; description: string }): Promise<{ success: boolean; agentId?: number; claudeMdUpdated?: boolean; error?: string }>
      // GitHub (secure — token stays in main process)
      testGithubConnection(dbPath: string, repoUrl: string): Promise<{ connected: boolean; error?: string }>
      checkForUpdates(dbPath: string, repoUrl: string, currentVersion: string): Promise<{ hasUpdate: boolean; latestVersion: string; error?: string }>
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
export const useTasksStore = defineStore('tasks', () => {
  const { push: pushToast } = useToast()
  const projectPath = ref<string | null>(localStorage.getItem('projectPath'))
  const dbPath = ref<string | null>(localStorage.getItem('dbPath'))
  const tasks = ref<Task[]>([])
  const agents = ref<Agent[]>([])
  const locks = ref<Lock[]>([])
  const perimetresData = ref<Perimetre[]>([])
  const stats = ref<Stats>({ a_faire: 0, en_cours: 0, terminé: 0, archivé: 0 })
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

  const perimetres = computed(() => {
    const set = new Set<string>()
    for (const t of tasks.value) if (t.perimetre) set.add(t.perimetre)
    return [...set].sort()
  })

  const filteredTasks = computed(() =>
    tasks.value.filter(t => {
      if (selectedAgentId.value !== null && Number(t.agent_assigne_id) !== Number(selectedAgentId.value)) return false
      if (selectedPerimetre.value !== null && t.perimetre !== selectedPerimetre.value) return false
      return true
    })
  )

  const tasksByStatus = computed(() => ({
    a_faire: filteredTasks.value.filter(t => t.statut === 'a_faire'),
    en_cours: filteredTasks.value.filter(t => t.statut === 'en_cours'),
    terminé: filteredTasks.value.filter(t => t.statut === 'terminé'),
    archivé: filteredTasks.value.filter(t => t.statut === 'archivé' || t.statut === 'validé') // validé = legacy, migrated to archivé
  }))

  async function setProject(pPath: string, dPath: string): Promise<void> {
    projectPath.value = pPath
    dbPath.value = dPath
    localStorage.setItem('projectPath', pPath)
    localStorage.setItem('dbPath', dPath)
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
      const confirmed = await window.electronAPI.showConfirmDialog({
        title: 'Changer de projet',
        message: `${n} session${n > 1 ? 's' : ''} WSL ouverte${n > 1 ? 's' : ''}`,
        detail: 'Toutes les sessions WSL seront fermées. Continuer ?',
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
    if (unsubDbChange) { unsubDbChange(); unsubDbChange = null }
    window.electronAPI.unwatchDb()
    projectPath.value = null
    dbPath.value = null
    localStorage.removeItem('projectPath')
    localStorage.removeItem('dbPath')
    tasks.value = []
    agents.value = []
    locks.value = []
    perimetresData.value = []
    stats.value = { a_faire: 0, en_cours: 0, terminé: 0, archive: 0 }
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
    return window.electronAPI.queryDb(dbPath.value, sql, params) as Promise<T[]>
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
          ORDER BY t.updated_at DESC
        `),
        query<Agent>(`
          SELECT a.*,
            (SELECT s.statut FROM sessions s WHERE s.agent_id = a.id
             ORDER BY s.started_at DESC LIMIT 1) as session_statut,
            (SELECT s.started_at FROM sessions s WHERE s.agent_id = a.id
             ORDER BY s.started_at DESC LIMIT 1) as session_started_at,
            (SELECT MAX(l.created_at) FROM agent_logs l WHERE l.agent_id = a.id) as last_log_at
          FROM agents a WHERE a.type != 'setup' ORDER BY a.name
        `),
        query<Lock>(`
          SELECT l.*, a.name as agent_name FROM locks l
          JOIN agents a ON a.id = l.agent_id
          WHERE l.released_at IS NULL
        `),
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

      const s: Stats = { a_faire: 0, en_cours: 0, terminé: 0, archivé: 0 }
      for (const row of rawStats) {
        if (row.statut === 'validé') {
          s.archivé += row.count // válido = legacy, counts as archivé
        } else if (row.statut in s) {
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
    try {
      const [rawAgents, rawLocks] = await Promise.all([
        query<Agent>(`
          SELECT a.*,
            (SELECT s.statut FROM sessions s WHERE s.agent_id = a.id
             ORDER BY s.started_at DESC LIMIT 1) as session_statut,
            (SELECT s.started_at FROM sessions s WHERE s.agent_id = a.id
             ORDER BY s.started_at DESC LIMIT 1) as session_started_at,
            (SELECT MAX(l.created_at) FROM agent_logs l WHERE l.agent_id = a.id) as last_log_at
          FROM agents a WHERE a.type != 'setup' ORDER BY a.name
        `),
        query<Lock>(`
          SELECT l.*, a.name as agent_name FROM locks l
          JOIN agents a ON a.id = l.agent_id
          WHERE l.released_at IS NULL
        `),
      ])
      agents.value = rawAgents.map(normalizeRow)
      locks.value = rawLocks.map(normalizeRow)
    } catch {
      // silent: main refresh handles error display
    }
  }

  function startPolling(): void {
    stopPolling()
    pollInterval = setInterval(refresh, 5000)
    agentPollInterval = setInterval(agentRefresh, 1000)
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

  function startWatching(path: string): void {
    if (unsubDbChange) { unsubDbChange(); unsubDbChange = null }
    window.electronAPI.watchDb(path)
    unsubDbChange = window.electronAPI.onDbChanged(() => refresh())
  }

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
    window.electronAPI.migrateDb(dbPath.value).then(() => refresh()).then(() => {
      startPolling()
      startWatching(dbPath.value!)
    })
  }

  return {
    projectPath, dbPath, tasks, agents, locks, stats, lastRefresh, loading, error,
    selectedAgentId, toggleAgentFilter,
    selectedPerimetre, togglePerimetreFilter, perimetres, perimetresData,
    tasksByStatus, setProject, selectProject, closeProject, setProjectPathOnly, watchForDb,
    refresh, agentRefresh, startPolling, stopPolling,
    selectedTask, taskComments, openTask, closeTask,
    setupWizardTarget, closeWizard
  }
})
