import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Task, Agent, Lock, Stats, TaskComment } from '@renderer/types'
import { useTabsStore } from '@renderer/stores/tabs'

declare global {
  interface Window {
    electronAPI: {
      selectProjectDir(): Promise<{ projectPath: string; dbPath: string | null; error: string | null } | null>
      queryDb(dbPath: string, query: string, params?: unknown[]): Promise<unknown[]>
      watchDb(dbPath: string): Promise<void>
      unwatchDb(): Promise<void>
      onDbChanged(callback: () => void): () => void
      showConfirmDialog(opts: { title: string; message: string; detail?: string }): Promise<boolean>
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
    }
  }
}

export const useTasksStore = defineStore('tasks', () => {
  const projectPath = ref<string | null>(localStorage.getItem('projectPath'))
  const dbPath = ref<string | null>(localStorage.getItem('dbPath'))
  const tasks = ref<Task[]>([])
  const agents = ref<Agent[]>([])
  const locks = ref<Lock[]>([])
  const stats = ref<Stats>({ a_faire: 0, en_cours: 0, terminé: 0, validé: 0 })
  const lastRefresh = ref<Date | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const selectedAgentId = ref<number | null>(null)
  const selectedPerimetre = ref<string | null>(null)
  const selectedTask = ref<Task | null>(null)
  const taskComments = ref<TaskComment[]>([])

  let pollInterval: ReturnType<typeof setInterval> | null = null
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
    validé: filteredTasks.value.filter(t => t.statut === 'validé')
  }))

  async function setProject(pPath: string, dPath: string): Promise<void> {
    projectPath.value = pPath
    dbPath.value = dPath
    localStorage.setItem('projectPath', pPath)
    localStorage.setItem('dbPath', dPath)
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
      error.value = result.error ?? 'Aucun fichier .db trouvé dans .claude/ ni à la racine du projet'
      return
    }
    error.value = null
    await setProject(result.projectPath, result.dbPath)
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
      const [rawTasks, rawAgents, rawLocks, rawStats] = await Promise.all([
        query<Task>(`
          SELECT t.*, a.name as agent_name, a.perimetre as agent_perimetre
          FROM tasks t
          LEFT JOIN agents a ON a.id = t.agent_assigne_id
          ORDER BY t.updated_at DESC
        `),
        query<Agent>(`
          SELECT a.*,
            (SELECT s.statut FROM sessions s WHERE s.agent_id = a.id
             ORDER BY s.started_at DESC LIMIT 1) as session_statut,
            (SELECT MAX(l.created_at) FROM agent_logs l WHERE l.agent_id = a.id) as last_log_at
          FROM agents a ORDER BY a.name
        `),
        query<Lock>(`
          SELECT l.*, a.name as agent_name FROM locks l
          JOIN agents a ON a.id = l.agent_id
          WHERE l.released_at IS NULL
        `),
        query<{ statut: string; count: number }>(`
          SELECT statut, COUNT(*) as count FROM tasks GROUP BY statut
        `)
      ])

      tasks.value = rawTasks
      agents.value = rawAgents
      locks.value = rawLocks

      const s: Stats = { a_faire: 0, en_cours: 0, terminé: 0, validé: 0 }
      for (const row of rawStats) {
        if (row.statut in s) s[row.statut as keyof Stats] = row.count
      }
      stats.value = s
      lastRefresh.value = new Date()
    } catch (e) {
      error.value = String(e)
    } finally {
      loading.value = false
    }
  }

  function startPolling(): void {
    stopPolling()
    pollInterval = setInterval(refresh, 5000)
  }

  function stopPolling(): void {
    if (pollInterval) {
      clearInterval(pollInterval)
      pollInterval = null
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
      taskComments.value = rows
    } catch {
      // table absente ou erreur : on affiche le modal sans commentaires
    }
  }

  function closeTask(): void {
    selectedTask.value = null
    taskComments.value = []
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
    refresh().then(() => {
      startPolling()
      startWatching(dbPath.value!)
    })
  }

  return {
    projectPath, dbPath, tasks, agents, locks, stats, lastRefresh, loading, error,
    selectedAgentId, toggleAgentFilter,
    selectedPerimetre, togglePerimetreFilter, perimetres,
    tasksByStatus, setProject, selectProject, refresh, startPolling, stopPolling,
    selectedTask, taskComments, openTask, closeTask
  }
})
