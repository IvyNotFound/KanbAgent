/**
 * IPC Handlers for agent-viewer
 *
 * Barrel module: registers all IPC handlers from domain-specific modules.
 * Project, DB, and window handlers remain here; agents, settings, and
 * filesystem handlers are in dedicated modules.
 *
 * @module ipc
 */

import { ipcMain, dialog, BrowserWindow } from 'electron'
import { watch, type FSWatcher } from 'fs'
import { access, mkdir, readdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { DEFAULT_AGENTS } from './default-agents'
import {
  registerDbPath,
  registerProjectPath,
  assertDbPathAllowed,
  assertProjectPathAllowed,
  getSqlJs,
  queryLive,
  writeDb,
  migrateDb,
  FORBIDDEN_WRITE_PATTERN,
  clearDbCacheEntry
} from './db'
import { registerFsHandlers } from './ipc-fs'
import { registerAgentHandlers } from './ipc-agents'
import { registerSettingsHandlers } from './ipc-settings'

// Re-export for consumers (index.ts, tests)
export { registerDbPath, registerProjectPath } from './db'

// ── Helpers ──────────────────────────────────────────────────────────────────

let watcher: FSWatcher | null = null
let debounceTimer: ReturnType<typeof setTimeout> | null = null

function notifyRenderer(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('db-changed')
  }
}

async function findProjectDb(projectPath: string): Promise<string | null> {
  const claudeDir = join(projectPath, '.claude')
  try {
    await access(claudeDir)
    const files = (await readdir(claudeDir)).filter(f => f.endsWith('.db'))
    if (files.length > 0) {
      const found = join(claudeDir, files[0])
      console.log('[findProjectDb] found:', found)
      return found
    }
  } catch { /* ignore */ }
  try {
    const files = (await readdir(projectPath)).filter(f => f.endsWith('.db'))
    if (files.length > 0) return join(projectPath, files[0])
  } catch { /* ignore */ }
  return null
}

// ── Handler registration ─────────────────────────────────────────────────────

/** Register all core IPC handlers (project, DB, window, locks, migration) and delegate to domain modules. */
export function registerIpcHandlers(): void {
  // ── Project selection / creation ──────────────────────────────────────────

  /** @returns {{ projectPath: string, dbPath: string|null, error: null, hasCLAUDEmd: boolean } | null} */
  ipcMain.handle('select-project-dir', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Sélectionner le répertoire du projet',
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const projectPath = result.filePaths[0]
    const dbPath = await findProjectDb(projectPath)
    registerDbPath(dbPath)
    registerProjectPath(projectPath)
    let hasCLAUDEmd = false
    try { await access(join(projectPath, 'CLAUDE.md')); hasCLAUDEmd = true } catch { /* not found */ }
    if (!dbPath) return { projectPath, dbPath: null, error: null, hasCLAUDEmd }
    return { projectPath, dbPath, error: null, hasCLAUDEmd }
  })

  /**
   * Create a new project.db with full schema and default agents.
   * @param projectPath - Absolute path to the project root
   * @returns {{ success: boolean, dbPath: string, error?: string }}
   */
  ipcMain.handle('create-project-db', async (_event, projectPath: string) => {
    assertProjectPathAllowed(projectPath)
    try {
      const claudeDir = join(projectPath, '.claude')
      await mkdir(claudeDir, { recursive: true })
      const dbPath = join(claudeDir, 'project.db')
      const sqlJs = await getSqlJs()
      const db = new sqlJs.Database()
      db.run(`
        CREATE TABLE IF NOT EXISTS agents (
          id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE,
          type TEXT NOT NULL, perimetre TEXT, system_prompt TEXT,
          system_prompt_suffix TEXT,
          thinking_mode TEXT CHECK(thinking_mode IN ('auto', 'disabled')),
          allowed_tools TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS sessions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          agent_id INTEGER NOT NULL REFERENCES agents(id),
          started_at DATETIME DEFAULT CURRENT_TIMESTAMP, ended_at DATETIME,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          statut TEXT NOT NULL DEFAULT 'started' CHECK(statut IN ('started','completed','blocked')),
          summary TEXT,
          claude_conv_id TEXT,
          tokens_in INTEGER DEFAULT 0,
          tokens_out INTEGER DEFAULT 0,
          tokens_cache_read INTEGER DEFAULT 0,
          tokens_cache_write INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS agent_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id INTEGER NOT NULL REFERENCES sessions(id),
          agent_id INTEGER NOT NULL REFERENCES agents(id),
          niveau TEXT NOT NULL DEFAULT 'info' CHECK(niveau IN ('info','warn','error','debug')),
          action TEXT NOT NULL, detail TEXT, fichiers TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS tasks (
          id INTEGER PRIMARY KEY AUTOINCREMENT, titre TEXT NOT NULL,
          description TEXT,
          statut TEXT NOT NULL DEFAULT 'todo'
            CHECK(statut IN ('todo','in_progress','done','archived')),
          agent_createur_id INTEGER REFERENCES agents(id),
          agent_assigne_id INTEGER REFERENCES agents(id),
          agent_valideur_id INTEGER REFERENCES agents(id),
          parent_task_id INTEGER REFERENCES tasks(id),
          session_id INTEGER REFERENCES sessions(id),
          perimetre TEXT, effort INTEGER CHECK(effort IN (1,2,3)),
          priority TEXT NOT NULL DEFAULT 'normal'
            CHECK(priority IN ('low','normal','high','critical')),
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          started_at DATETIME, completed_at DATETIME, validated_at DATETIME
        );
        CREATE TABLE IF NOT EXISTS task_links (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          from_task INTEGER NOT NULL REFERENCES tasks(id),
          to_task INTEGER NOT NULL REFERENCES tasks(id),
          type TEXT NOT NULL CHECK(type IN ('bloque','dépend_de','lié_à','duplique')),
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS task_comments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          task_id INTEGER NOT NULL REFERENCES tasks(id),
          agent_id INTEGER REFERENCES agents(id),
          contenu TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS locks (
          id INTEGER PRIMARY KEY AUTOINCREMENT, fichier TEXT NOT NULL UNIQUE,
          agent_id INTEGER NOT NULL REFERENCES agents(id),
          session_id INTEGER REFERENCES sessions(id),
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP, released_at DATETIME
        );
        CREATE TABLE IF NOT EXISTS config (
          key TEXT NOT NULL PRIMARY KEY, value TEXT NOT NULL,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS perimetres (
          id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE,
          dossier TEXT, techno TEXT, description TEXT,
          actif INTEGER NOT NULL DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        INSERT OR IGNORE INTO config (key, value) VALUES ('claude_md_commit',''),('schema_version','3');
        INSERT OR IGNORE INTO perimetres (name, dossier, techno, description) VALUES
          ('front-vuejs','renderer/','Vue 3 + TypeScript + Tailwind CSS','Interface utilisateur Electron'),
          ('back-electron','main/','Electron + Node.js + SQLite','Process principal, IPC, accès DB'),
          ('global','','—','Transversal, aucun périmètre spécifique');
        CREATE INDEX IF NOT EXISTS idx_sessions_agent_id ON sessions(agent_id);
        CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON sessions(started_at DESC);
        CREATE INDEX IF NOT EXISTS idx_agent_logs_agent_id ON agent_logs(agent_id);
        CREATE INDEX IF NOT EXISTS idx_agent_logs_created_at ON agent_logs(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_locks_released_at ON locks(released_at);
        CREATE INDEX IF NOT EXISTS idx_tasks_updated_at ON tasks(updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_tasks_agent_assigne ON tasks(agent_assigne_id);
        CREATE INDEX IF NOT EXISTS idx_sessions_agent_started ON sessions(agent_id, started_at DESC);
        CREATE INDEX IF NOT EXISTS idx_task_comments_task_id ON task_comments(task_id);
      `)
      for (const agent of DEFAULT_AGENTS) {
        db.run(
          `INSERT OR IGNORE INTO agents (name, type, perimetre, system_prompt, system_prompt_suffix)
           VALUES (?, ?, ?, ?, ?)`,
          [agent.name, agent.type, agent.perimetre ?? null, agent.system_prompt ?? null, agent.system_prompt_suffix ?? null]
        )
      }
      const exported = db.export()
      db.close()
      await writeFile(dbPath, Buffer.from(exported))
      registerDbPath(dbPath)
      console.log('[create-project-db] created:', dbPath)
      return { success: true, dbPath }
    } catch (err) {
      console.error('[IPC create-project-db]', err)
      return { success: false, error: String(err), dbPath: '' }
    }
  })

  // ── DB query / watch ─────────────────────────────────────────────────────

  /**
   * Execute a read-only SQL query on the project DB.
   * @param dbPath - Registered DB path
   * @param query - SQL SELECT query (write keywords are blocked)
   * @param params - Bind parameters
   * @returns {Record<string, unknown>[]} Query result rows
   * @throws {Error} If dbPath is not registered or query fails
   */
  ipcMain.handle('query-db', async (_event, dbPath: string, query: string, params: unknown[] = []) => {
    assertDbPathAllowed(dbPath)
    const matchedKeyword = FORBIDDEN_WRITE_PATTERN.exec(query)
    if (matchedKeyword) {
      console.warn('[IPC query-db] Blocked write keyword:', matchedKeyword[1], 'in query:', query.substring(0, 100))
      return { success: false, error: 'Write operations (INSERT/UPDATE/DELETE/DROP/etc.) are not allowed from the renderer. Use dedicated IPC handlers for write operations.', rows: [] }
    }
    try {
      return await queryLive(dbPath, query, params)
    } catch (err) {
      console.error('[IPC query-db]', err)
      throw err
    }
  })

  /**
   * Start watching a DB file for changes. Triggers 'db-changed' event to all renderer windows.
   * @param dbPath - Registered DB path to watch
   */
  ipcMain.handle('watch-db', (_event, dbPath: string) => {
    assertDbPathAllowed(dbPath)
    if (watcher) { watcher.close(); watcher = null }
    try {
      watcher = watch(dbPath, () => {
        if (debounceTimer) clearTimeout(debounceTimer)
        debounceTimer = setTimeout(() => notifyRenderer(), 300)
      })
    } catch (err) {
      console.error('[IPC watch-db]', err)
    }
  })

  /** Stop watching DB file and clear cache entry if dbPath provided. */
  ipcMain.handle('unwatch-db', (_event, dbPath?: string) => {
    if (watcher) { watcher.close(); watcher = null }
    if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null }
    if (dbPath) {
      clearDbCacheEntry(dbPath)
      console.log('[IPC unwatch-db] Cache cleared for:', dbPath)
    }
  })

  // ── Dialogs ──────────────────────────────────────────────────────────────

  /**
   * Show a native confirmation dialog.
   * @param opts - Dialog options (title, message, detail)
   * @returns {boolean} true if user clicked "Continuer"
   */
  ipcMain.handle('show-confirm-dialog', async (_event, opts: { title: string; message: string; detail?: string }) => {
    const result = await dialog.showMessageBox({
      type: 'warning',
      buttons: ['Continuer', 'Annuler'],
      defaultId: 1,
      cancelId: 1,
      title: opts.title,
      message: opts.message,
      detail: opts.detail,
    })
    return result.response === 0
  })

  /** @returns {string|null} Selected directory path, or null if canceled */
  ipcMain.handle('select-new-project-dir', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Sélectionner le répertoire du nouveau projet',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const selectedPath = result.filePaths[0]
    registerProjectPath(selectedPath)
    return selectedPath
  })

  /**
   * Initialize a new project: create .claude/ dir and download CLAUDE.md from GitHub.
   * @param projectPath - Registered project path
   * @returns {{ success: boolean, error?: string }}
   */
  ipcMain.handle('init-new-project', async (_event, projectPath: string) => {
    try {
      assertProjectPathAllowed(projectPath)
      const claudeDir = join(projectPath, '.claude')
      await mkdir(claudeDir, { recursive: true })

      const response = await fetch('https://raw.githubusercontent.com/IvyNotFound/claude.md/main/CLAUDE.md')
      if (!response.ok) throw new Error(`HTTP ${response.status} lors du téléchargement de CLAUDE.md`)
      const content = await response.text()

      await writeFile(join(projectPath, 'CLAUDE.md'), content, 'utf-8')
      return { success: true }
    } catch (err) {
      console.error('[IPC init-new-project]', err)
      return { success: false, error: String(err) }
    }
  })

  /**
   * Locate project.db inside .claude/ subdirectory.
   * @param projectPath - Project root path
   * @returns {string|null} Found DB path, or null
   */
  ipcMain.handle('find-project-db', async (_event, projectPath: string) => {
    if (!projectPath) throw new Error('PROJECT_PATH_REQUIRED')
    registerProjectPath(projectPath)
    const dbPath = await findProjectDb(projectPath)
    registerDbPath(dbPath)
    return dbPath
  })

  // ── Window controls ──────────────────────────────────────────────────────

  /** Minimize the focused window. */
  ipcMain.handle('window-minimize', () => {
    BrowserWindow.getFocusedWindow()?.minimize()
  })

  /** Toggle maximize/unmaximize on the focused window. */
  ipcMain.handle('window-maximize', () => {
    const win = BrowserWindow.getFocusedWindow()
    if (win?.isMaximized()) win.unmaximize()
    else win?.maximize()
  })

  /** Close the focused window. */
  ipcMain.handle('window-close', () => {
    BrowserWindow.getFocusedWindow()?.close()
  })

  /** @returns {boolean} Whether the focused window is maximized */
  ipcMain.handle('window-is-maximized', () => {
    return BrowserWindow.getFocusedWindow()?.isMaximized() ?? false
  })

  // ── Locks ────────────────────────────────────────────────────────────────

  /**
   * Get all active (unreleased) file locks with agent names.
   * @param dbPath - Registered DB path
   * @returns {Array} Lock rows with agent_name joined
   */
  ipcMain.handle('get-locks', async (_event, dbPath: string) => {
    assertDbPathAllowed(dbPath)
    return queryLive(
      dbPath,
      `SELECT l.id, l.fichier, l.agent_id, a.name as agent_name,
              l.session_id, l.created_at, l.released_at
       FROM locks l
       JOIN agents a ON a.id = l.agent_id
       WHERE l.released_at IS NULL
       ORDER BY l.created_at DESC`,
      []
    )
  })

  // ── Migration ────────────────────────────────────────────────────────────

  /**
   * Run all pending schema migrations on the DB.
   * @param dbPath - Registered DB path
   * @returns {{ success: boolean, migrated: number, error?: string }}
   */
  ipcMain.handle('migrate-db', async (_event, dbPath: string) => {
    try {
      assertDbPathAllowed(dbPath)
      const { migrated } = await migrateDb(dbPath)
      return { success: true, migrated }
    } catch (err) {
      console.error('[IPC migrate-db]', err)
      return { success: false, error: String(err) }
    }
  })

  // ── Archived tasks pagination ─────────────────────────────────────────────

  /**
   * Paginated query for archived tasks — independent of refresh().
   * @param dbPath - Registered DB path
   * @param params - { page, pageSize, agentId?, perimetre? }
   * @returns {{ rows: Record<string,unknown>[], total: number }}
   */
  ipcMain.handle('tasks:getArchived', async (_event, dbPath: string, params: {
    page: number
    pageSize: number
    agentId?: number | null
    perimetre?: string | null
  }) => {
    assertDbPathAllowed(dbPath)
    const offset = params.page * params.pageSize
    const conditions: string[] = ["t.statut = 'archived'"]
    const binds: unknown[] = []
    if (params.agentId != null) {
      conditions.push('t.agent_assigne_id = ?')
      binds.push(params.agentId)
    }
    if (params.perimetre != null) {
      conditions.push('t.perimetre = ?')
      binds.push(params.perimetre)
    }
    const where = conditions.join(' AND ')
    const [rows, countRows] = await Promise.all([
      queryLive(dbPath, `
        SELECT t.*, a.name as agent_name, a.perimetre as agent_perimetre,
          c.name as agent_createur_name
        FROM tasks t
        LEFT JOIN agents a ON a.id = t.agent_assigne_id
        LEFT JOIN agents c ON c.id = t.agent_createur_id
        WHERE ${where}
        ORDER BY t.updated_at DESC
        LIMIT ? OFFSET ?
      `, [...binds, params.pageSize, offset]),
      queryLive(dbPath, `SELECT COUNT(*) as total FROM tasks t WHERE ${where}`, binds)
    ])
    const total = (countRows[0] as Record<string, unknown>)?.total ?? 0
    return { rows, total: Number(total) }
  })

  /**
   * Update a task's status in the DB (used by drag & drop, etc.)
   * @param dbPath - Registered DB path
   * @param taskId - Task ID to update
   * @param statut - New status: 'todo' | 'in_progress' | 'done' | 'archived'
   */
  const ALLOWED_TASK_STATUTS = ['todo', 'in_progress', 'done', 'archived'] as const
  ipcMain.handle('tasks:updateStatus', async (_event, dbPath: string, taskId: number, statut: string) => {
    assertDbPathAllowed(dbPath)
    if (!ALLOWED_TASK_STATUTS.includes(statut as typeof ALLOWED_TASK_STATUTS[number])) {
      return { success: false, error: `Invalid statut: ${statut}` }
    }
    try {
      if (statut === 'in_progress') {
        const blockers = await queryLive(
          dbPath,
          `SELECT t.id, t.titre, t.statut
           FROM task_links tl JOIN tasks t ON t.id = tl.from_task
           WHERE tl.to_task = ? AND tl.type = 'bloque' AND t.statut NOT IN ('done','archived')
           UNION
           SELECT t.id, t.titre, t.statut
           FROM task_links tl JOIN tasks t ON t.id = tl.to_task
           WHERE tl.from_task = ? AND tl.type = 'dépend_de' AND t.statut NOT IN ('done','archived')`,
          [taskId, taskId]
        ) as Array<{ id: number; titre: string; statut: string }>
        if (blockers.length) {
          return { success: false, error: 'TASK_BLOCKED', blockers }
        }
      }
      await writeDb(dbPath, (db) => {
        db.run(
          `UPDATE tasks SET statut=?, updated_at=datetime('now') WHERE id=?`,
          [statut, taskId]
        )
      })
      return { success: true }
    } catch (err) {
      console.error('[IPC tasks:updateStatus]', err)
      return { success: false, error: String(err) }
    }
  })

  // ── Domain-specific handlers ─────────────────────────────────────────────

  registerFsHandlers()
  registerAgentHandlers()
  registerSettingsHandlers()
}
