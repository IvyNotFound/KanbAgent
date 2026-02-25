/**
 * IPC Handlers for agent-viewer
 *
 * Provides secure communication between Electron main process and Vue renderer.
 * All file system and database operations run in the main process.
 *
 * @module ipc
 */

import { ipcMain, dialog, BrowserWindow, safeStorage } from 'electron'
import { watch, type FSWatcher, readdirSync, existsSync, type Dirent } from 'fs'
import { readFile, mkdir, writeFile, rename, stat, copyFile, unlink } from 'fs/promises'
import { join, dirname, resolve, isAbsolute } from 'path'
import { runTaskStatusMigration, runAddPriorityMigration, runTaskStatutI18nMigration, runAddConvIdToSessionsMigration, runRemoveThinkingModeBudgetTokensMigration, runDropCommentaireColumnMigration } from './migration'
import { DEFAULT_AGENTS } from './default-agents'

// ── DB Cache for queryLive ─────────────────────────────────────────────────────
interface DbCache {
  buf: Buffer
  mtime: number
  lastAccess: number // Timestamp for TTL-based eviction
}
const dbCache = new Map<string, DbCache>()

// TTL for cache entries (60 seconds of inactivity)
const CACHE_TTL_MS = 60000
// Maximum number of cached entries
const MAX_CACHE_ENTRIES = 3

/**
 * Evicts stale entries from dbCache based on TTL.
 * Should be called periodically or when getting a buffer.
 */
function evictStaleCacheEntries(): void {
  const now = Date.now()
  for (const [path, entry] of dbCache.entries()) {
    if (now - entry.lastAccess > CACHE_TTL_MS) {
      dbCache.delete(path)
    }
  }
}

/**
 * Limits cache to MAX_CACHE_ENTRIES by removing oldest entries.
 */
function enforceMaxCacheEntries(): void {
  if (dbCache.size >= MAX_CACHE_ENTRIES) {
    // Find and remove oldest entry
    let oldestPath: string | null = null
    let oldestTime = Infinity
    for (const [path, entry] of dbCache.entries()) {
      if (entry.lastAccess < oldestTime) {
        oldestTime = entry.lastAccess
        oldestPath = path
      }
    }
    if (oldestPath) {
      dbCache.delete(oldestPath)
    }
  }
}

/**
 * Gets database buffer with caching based on file mtime.
 * Avoids re-reading disk if file hasn't changed.
 * Falls back to direct `readFile` if stat fails (e.g. permission error).
 *
 * @param dbPath - Absolute path to the SQLite database file
 * @returns {Promise<Buffer>} File contents as a Node.js Buffer
 */
async function getDbBuffer(dbPath: string): Promise<Buffer> {
  // Evict stale entries before accessing cache
  evictStaleCacheEntries()
  enforceMaxCacheEntries()

  try {
    const statResult = await stat(dbPath)
    const mtimeMs = statResult.mtimeMs
    const now = Date.now()

    const cached = dbCache.get(dbPath)
    if (cached && cached.mtime === mtimeMs) {
      // Update lastAccess to keep entry alive
      cached.lastAccess = now
      return cached.buf
    }

    // Read from disk and update cache
    const buf = await readFile(dbPath)
    dbCache.set(dbPath, { buf, mtime: mtimeMs, lastAccess: now })
    return buf
  } catch {
    // On error, bypass cache and read directly
    return readFile(dbPath)
  }
}

// ── GitHub Token Encryption (safeStorage) ───────────────────────────────────
/**
 * Encrypts a string using OS-level encryption (Windows DPAPI, macOS Keychain, etc.)
 * Returns base64-encoded ciphertext, or original string if encryption fails.
 */
function encryptToken(plaintext: string): string {
  if (!plaintext) return ''
  try {
    if (safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(plaintext)
      return encrypted.toString('base64')
    }
  } catch (err) {
    console.warn('[IPC] safeStorage encryption failed:', err)
  }
  return plaintext // Fallback: store as-is if encryption unavailable
}

/**
 * Decrypts a base64-encoded ciphertext using OS-level encryption.
 * Returns original plaintext, or ciphertext if decryption fails.
 */
function decryptToken(ciphertext: string): string {
  if (!ciphertext) return ''
  try {
    if (safeStorage.isEncryptionAvailable()) {
      const buffer = Buffer.from(ciphertext, 'base64')
      return safeStorage.decryptString(buffer)
    }
  } catch (err) {
    console.warn('[IPC] safeStorage decryption failed:', err)
  }
  return ciphertext // Fallback: return as-is if decryption fails
}

interface FileNode {
  name: string
  path: string
  isDir: boolean
  children?: FileNode[]
}

const FS_SKIP = new Set(['node_modules', '.git', 'dist', 'dist-electron', '.DS_Store', '__pycache__'])

/**
 * Builds a directory tree structure for file explorer.
 *
 * Recursively scans a directory up to 4 levels deep,
 * skipping node_modules, .git, dist, and other build artifacts.
 *
 * @param dirPath - Root directory path to scan
 * @param depth - Current recursion depth (default: 0, max: 4)
 * @returns {FileNode[]} Array of file/directory nodes
 */
function buildTree(dirPath: string, depth = 0): FileNode[] {
  if (depth > 4) return []
  let entries: Dirent[]
  try { entries = readdirSync(dirPath, { withFileTypes: true }) } catch { return [] }
  return entries
    .filter(e => !FS_SKIP.has(e.name) && (e.name[0] !== '.' || e.name === '.claude'))
    .map(e => {
      const fullPath = join(dirPath, e.name)
      const isDir = e.isDirectory()
      return { name: e.name, path: fullPath, isDir, children: isDir ? buildTree(fullPath, depth + 1) : undefined }
    })
    .sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
      return a.name.localeCompare(b.name)
    })
}

/**
 * Migrates database schema to the latest version.
 *
 * Adds missing columns and tables for v2 schema compatibility:
 * - agents: system_prompt, system_prompt_suffix, thinking_mode, allowed_tools
 * - config table
 * - perimetres table
 * - Migrates legacy 'terminé' status to 'archivé'
 *
 * @param dbPath - Path to the SQLite database file
 * @returns {Promise<{ migrated: number }>} Number of tasks migrated
 * @throws {Error} If migration fails
 */
async function migrateDb(dbPath: string): Promise<{ migrated: number }> {
  // Create a backup before any modification. The backup is deleted on success;
  // kept for manual recovery if writeFile fails (disk full, crash, etc.).
  const backupPath = `${dbPath}.bak`
  await copyFile(dbPath, backupPath)

  const sqlJs = await getSqlJs()
  const buf = await readFile(dbPath)
  const db = new sqlJs.Database(buf)
  let changed = false

  try {
    // --- tasks: drop legacy commentaire column (must run FIRST — before any
    //     migration that recreates the tasks table, which would silently lose data) ---
    // Check before calling so we can flag `changed` regardless of migrated row count
    const tasksColsBefore = db.exec('PRAGMA table_info(tasks)')
    const hadCommentaire = tasksColsBefore.length > 0 &&
      tasksColsBefore[0].values.some((r: unknown[]) => r[1] === 'commentaire')
    const commentaireMigrated = runDropCommentaireColumnMigration(db)
    if (hadCommentaire) {
      changed = true
      console.log(`[migrateDb] dropped tasks.commentaire column (${commentaireMigrated} rows migrated to task_comments)`)
    }

    // --- agents: system_prompt, system_prompt_suffix ---
    const colResult = db.exec('PRAGMA table_info(agents)')
    const existingCols = new Set<string>()
    if (colResult.length > 0) {
      for (const row of colResult[0].values) existingCols.add(row[1] as string)
    }
    if (!existingCols.has('system_prompt')) {
      db.run('ALTER TABLE agents ADD COLUMN system_prompt TEXT')
      changed = true
    }
    if (!existingCols.has('system_prompt_suffix')) {
      db.run('ALTER TABLE agents ADD COLUMN system_prompt_suffix TEXT')
      changed = true
    }
    if (!existingCols.has('thinking_mode')) {
      db.run("ALTER TABLE agents ADD COLUMN thinking_mode TEXT CHECK(thinking_mode IN ('auto', 'disabled'))")
      changed = true
    }
    if (!existingCols.has('allowed_tools')) {
      db.run('ALTER TABLE agents ADD COLUMN allowed_tools TEXT')
      changed = true
    }

    // --- config table ---
    const tableResult = db.exec("SELECT name FROM sqlite_master WHERE type='table'")
    const existingTables = new Set<string>()
    if (tableResult.length > 0) {
      for (const row of tableResult[0].values) existingTables.add(row[0] as string)
    }
    if (!existingTables.has('config')) {
      db.run(`CREATE TABLE config (
        key        TEXT NOT NULL PRIMARY KEY,
        value      TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`)
      db.run(`INSERT INTO config (key, value) VALUES
        ('claude_md_commit', ''),
        ('schema_version', '2'),
        ('github_token', '')`)
      changed = true
    } else {
      // Ensure github_token row exists in pre-existing config tables
      db.run("INSERT OR IGNORE INTO config (key, value) VALUES ('github_token', '')")
      changed = true
    }

    // --- perimetres table ---
    if (!existingTables.has('perimetres')) {
      db.run(`CREATE TABLE perimetres (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT NOT NULL UNIQUE,
        dossier     TEXT,
        techno      TEXT,
        description TEXT,
        actif       INTEGER NOT NULL DEFAULT 1,
        created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
      )`)
      db.run(`INSERT INTO perimetres (name, dossier, techno, description) VALUES
        ('front-vuejs',   'renderer/', 'Vue 3 + TypeScript + Tailwind CSS', 'Interface utilisateur Electron'),
        ('back-electron', 'main/',     'Electron + Node.js + SQLite',       'Process principal, IPC, accès DB'),
        ('global',        '',          '—',                                  'Transversal, aucun périmètre spécifique')`)
      changed = true
    }

    // --- Indexes for performance (critical columns for frequent queries) ---
    // Using CREATE INDEX IF NOT EXISTS for idempotency
    db.run('CREATE INDEX IF NOT EXISTS idx_sessions_agent_id ON sessions(agent_id)')
    db.run('CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON sessions(started_at DESC)')
    db.run('CREATE INDEX IF NOT EXISTS idx_agent_logs_agent_id ON agent_logs(agent_id)')
    db.run('CREATE INDEX IF NOT EXISTS idx_agent_logs_created_at ON agent_logs(created_at DESC)')
    db.run('CREATE INDEX IF NOT EXISTS idx_locks_released_at ON locks(released_at)')
    db.run('CREATE INDEX IF NOT EXISTS idx_tasks_updated_at ON tasks(updated_at DESC)')
    db.run('CREATE INDEX IF NOT EXISTS idx_tasks_agent_assigne ON tasks(agent_assigne_id)')
    changed = true

    // --- sessions: claude_conv_id column (v0.4.0, task #218) ---
    const convIdAdded = runAddConvIdToSessionsMigration(db)
    if (convIdAdded) {
      changed = true
      console.log('[migrateDb] added claude_conv_id column to sessions')
    }

    // --- tasks: priority column (v0.4.0) ---
    const priorityAdded = runAddPriorityMigration(db)
    if (priorityAdded) {
      changed = true
      console.log('[migrateDb] added priority column to tasks')
    }

    // --- tasks: statut French → English (v0.4.0) ---
    const i18nMigrated = runTaskStatutI18nMigration(db)
    if (i18nMigrated > 0) {
      changed = true
      console.log(`[migrateDb] migrated ${i18nMigrated} tasks statuts from French to English`)
    }

    // --- agents: remove 'budget_tokens' from thinking_mode CHECK constraint (task #255) ---
    const thinkingModeMigrated = runRemoveThinkingModeBudgetTokensMigration(db)
    if (thinkingModeMigrated) {
      changed = true
      console.log('[migrateDb] removed budget_tokens from agents.thinking_mode CHECK constraint')
    }

    // --- backward compat: terminé → archivé (pre-v0.4.0, typically no-op after i18n) ---
    const migrated = runTaskStatusMigration(db)
    if (migrated > 0) {
      changed = true
      console.log(`[migrateDb] migrated ${migrated} tasks via legacy runTaskStatusMigration`)
    }

    if (changed) {
      const exported = db.export()
      await writeFile(dbPath, Buffer.from(exported))
      console.log('[migrateDb] schema updated:', dbPath)
    }

    // Migration successful: remove backup
    await unlink(backupPath).catch(() => {
      console.warn('[migrateDb] could not delete backup:', backupPath)
    })

    return { migrated }
  } catch (err) {
    console.error('[migrateDb] migration failed, backup kept at:', backupPath, err)
    throw err
  } finally {
    db.close()
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let SQL: any = null
let watcher: FSWatcher | null = null
let debounceTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Initializes and returns the sql.js module (SQLite in WebAssembly).
 *
 * Singleton pattern - loads sql.js once and caches the module.
 * Uses WASM for cross-platform SQLite support without native binaries.
 *
 * @returns {Promise<typeof import('sql.js')>} Initialized sql.js module
 */
async function getSqlJs() {
  if (!SQL) {
    // sql.js: loads SQLite as WASM, reads DB from a Buffer — bypasses all file locking
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const initSqlJs = require('sql.js')
    const wasmDir = dirname(require.resolve('sql.js'))
    SQL = await initSqlJs({
      locateFile: (file: string) => join(wasmDir, file)
    })
  }
  return SQL
}

/**
 * Executes a read-only SQL query on the database.
 *
 * Uses sql.js (WASM) to read the database file without file locking,
 * allowing concurrent access from multiple processes.
 *
 * @param dbPath - Path to the SQLite database file
 * @param query - SQL query to execute
 * @param params - Query parameters
 * @returns {Promise<unknown[]>} Array of result rows
 * @throws {Error} If query execution fails
 */
async function queryLive(dbPath: string, query: string, params: unknown[]): Promise<unknown[]> {
  const sqlJs = await getSqlJs()
  // Use cached buffer - avoids disk read if file mtime unchanged
  const buf = await getDbBuffer(dbPath)
  const db = new sqlJs.Database(buf)
  try {
    const stmt = db.prepare(query)
    const rows: Record<string, unknown>[] = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    stmt.bind(params as any)
    while (stmt.step()) {
      rows.push(stmt.getAsObject())
    }
    stmt.free()
    return rows
  } finally {
    db.close()
  }
}

/**
 * Locates a project database file in the given directory.
 *
 * Searches for .db files in:
 * 1. .claude/ directory
 * 2. Root project directory
 *
 * @param projectPath - Path to the project directory
 * @returns {string | null} Absolute path to database file, or null if not found
 */
function findProjectDb(projectPath: string): string | null {
  const claudeDir = join(projectPath, '.claude')
  if (existsSync(claudeDir)) {
    try {
      const files = readdirSync(claudeDir).filter(f => f.endsWith('.db'))
      if (files.length > 0) {
        const found = join(claudeDir, files[0])
        console.log('[findProjectDb] found:', found)
        return found
      }
    } catch { /* ignore */ }
  }
  try {
    const files = readdirSync(projectPath).filter(f => f.endsWith('.db'))
    if (files.length > 0) return join(projectPath, files[0])
  } catch { /* ignore */ }
  return null
}

/**
 * Notifies all renderer windows that the database has changed.
 *
 * Sends 'db-changed' event to trigger a refresh in the Vue app.
 *
 * @returns {void}
 */
function notifyRenderer(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('db-changed')
  }
}

/**
 * Registers all IPC handlers for the application.
 *
 * Handles communication between renderer and main process:
 * - Database operations (query, watch, migrate)
 * - File system operations
 * - Window controls
 * - Terminal management
 * - Agent configuration
 *
 * @throws {Error} If handler registration fails
 * @returns {void}
 */
export function registerIpcHandlers(): void {
  ipcMain.handle('select-project-dir', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Sélectionner le répertoire du projet',
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const projectPath = result.filePaths[0]
    const dbPath = findProjectDb(projectPath)
    const hasCLAUDEmd = existsSync(join(projectPath, 'CLAUDE.md'))
    if (!dbPath) return { projectPath, dbPath: null, error: null, hasCLAUDEmd }
    return { projectPath, dbPath, error: null, hasCLAUDEmd }
  })

  ipcMain.handle('create-project-db', async (_event, projectPath: string) => {
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
          statut TEXT NOT NULL DEFAULT 'en_cours' CHECK(statut IN ('en_cours','terminé','bloqué')),
          summary TEXT
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
        INSERT OR IGNORE INTO config (key, value) VALUES ('claude_md_commit',''),('schema_version','2'),('github_token','');
        INSERT OR IGNORE INTO perimetres (name, dossier, techno, description) VALUES
          ('front-vuejs','renderer/','Vue 3 + TypeScript + Tailwind CSS','Interface utilisateur Electron'),
          ('back-electron','main/','Electron + Node.js + SQLite','Process principal, IPC, accès DB'),
          ('global','','—','Transversal, aucun périmètre spécifique');
        -- Indexes for performance (critical columns for frequent queries)
        CREATE INDEX IF NOT EXISTS idx_sessions_agent_id ON sessions(agent_id);
        CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON sessions(started_at DESC);
        CREATE INDEX IF NOT EXISTS idx_agent_logs_agent_id ON agent_logs(agent_id);
        CREATE INDEX IF NOT EXISTS idx_agent_logs_created_at ON agent_logs(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_locks_released_at ON locks(released_at);
        CREATE INDEX IF NOT EXISTS idx_tasks_updated_at ON tasks(updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_tasks_agent_assigne ON tasks(agent_assigne_id);
      `)
      // Insert default agents with their system_prompt and system_prompt_suffix.
      // Using parameterized INSERT OR IGNORE to stay idempotent:
      // if agents already exist (e.g. user re-opens an existing DB), their custom prompts are preserved.
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
      console.log('[create-project-db] created:', dbPath)
      return { success: true, dbPath }
    } catch (err) {
      console.error('[IPC create-project-db]', err)
      return { success: false, error: String(err), dbPath: '' }
    }
  })

  // Write keywords that should be blocked from renderer
  // Use trailing space to avoid matching column names like "created_at", "updated_at"
  const FORBIDDEN_WRITE_KEYWORDS = [
    'INSERT', 'UPDATE ', 'DELETE', 'DROP', 'ALTER', 'CREATE ',
    'TRUNCATE', 'REPLACE', 'ATTACH', 'DETACH', 'VACUUM'
  ]

  ipcMain.handle('query-db', async (_event, dbPath: string, query: string, params: unknown[] = []) => {
    // Security: Validate query does not contain write operations
    const normalizedQuery = query.toUpperCase().trim()
    const matchedKeyword = FORBIDDEN_WRITE_KEYWORDS.find(keyword =>
      normalizedQuery.includes(keyword)
    )

    if (matchedKeyword) {
      console.warn('[IPC query-db] Blocked (false positive):', matchedKeyword, 'in query:', query.substring(0, 100))
      return { success: false, error: 'Write operations (INSERT/UPDATE/DELETE/DROP/etc.) are not allowed from the renderer. Use dedicated IPC handlers for write operations.', rows: [] }
    }

    try {
      return await queryLive(dbPath, query, params)
    } catch (err) {
      console.error('[IPC query-db]', err)
      throw err
    }
  })

  ipcMain.handle('watch-db', (_event, dbPath: string) => {
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

  ipcMain.handle('unwatch-db', (_event, dbPath?: string) => {
    if (watcher) { watcher.close(); watcher = null }
    if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null }
    // Clear the DB cache for this path when unwatching
    if (dbPath) {
      dbCache.delete(dbPath)
      console.log('[IPC unwatch-db] Cache cleared for:', dbPath)
    }
  })

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

  ipcMain.handle('select-new-project-dir', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Sélectionner le répertoire du nouveau projet',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('init-new-project', async (_event, projectPath: string) => {
    try {
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

  ipcMain.handle('find-project-db', (_event, projectPath: string) => {
    return findProjectDb(projectPath)
  })

  ipcMain.handle('window-minimize', () => {
    BrowserWindow.getFocusedWindow()?.minimize()
  })

  ipcMain.handle('window-maximize', () => {
    const win = BrowserWindow.getFocusedWindow()
    if (win?.isMaximized()) win.unmaximize()
    else win?.maximize()
  })

  ipcMain.handle('window-close', () => {
    BrowserWindow.getFocusedWindow()?.close()
  })

  ipcMain.handle('window-is-maximized', () => {
    return BrowserWindow.getFocusedWindow()?.isMaximized() ?? false
  })

  ipcMain.handle('get-locks', async (_event, dbPath: string) => {
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

  ipcMain.handle('get-locks-count', async (_event, dbPath: string) => {
    const rows = await queryLive(
      dbPath,
      'SELECT COUNT(*) as count FROM locks WHERE released_at IS NULL',
      []
    )
    return (rows[0] as { count: number })?.count ?? 0
  })

  ipcMain.handle('migrate-db', async (_event, dbPath: string) => {
    try {
      const { migrated } = await migrateDb(dbPath)
      return { success: true, migrated }
    } catch (err) {
      console.error('[IPC migrate-db]', err)
      return { success: false, error: String(err) }
    }
  })

  // Security: validate path is within allowed directory
  function isPathAllowed(filePath: string, allowedDir?: string): boolean {
    if (!allowedDir) {
      // If no allowed dir specified, reject absolute paths (security by default)
      return !isAbsolute(filePath)
    }
    // Resolve both paths and check if file is within allowed dir
    const resolved = resolve(filePath)
    const allowed = resolve(allowedDir)
    return resolved.startsWith(allowed)
  }

  ipcMain.handle('fs:listDir', (_event, dirPath: string, allowedDir?: string): FileNode[] => {
    // Security: validate path traversal and allowed directory
    if (dirPath.includes('..')) {
      console.warn('[IPC fs:listDir] Blocked path traversal attempt:', dirPath)
      return []
    }
    if (!isPathAllowed(dirPath, allowedDir)) {
      console.warn('[IPC fs:listDir] Path not in allowed directory:', dirPath, allowedDir)
      return []
    }
    return buildTree(dirPath)
  })

  ipcMain.handle('fs:readFile', async (_event, filePath: string, allowedDir?: string) => {
    // Security: validate path traversal and allowed directory
    if (filePath.includes('..')) {
      console.warn('[IPC fs:readFile] Blocked path traversal attempt:', filePath)
      return { success: false, error: 'Path traversal not allowed' }
    }
    if (!isPathAllowed(filePath, allowedDir)) {
      console.warn('[IPC fs:readFile] Path not in allowed directory:', filePath, allowedDir)
      return { success: false, error: 'Path not in allowed directory' }
    }
    try {
      const content = await readFile(filePath, 'utf-8')
      return { success: true, content }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('fs:writeFile', async (_event, filePath: string, content: string, allowedDir?: string): Promise<{ success: boolean; error?: string }> => {
    // Security: validate path traversal and allowed directory
    if (filePath.includes('..')) {
      console.warn('[IPC fs:writeFile] Blocked path traversal attempt:', filePath)
      return { success: false, error: 'Path traversal not allowed' }
    }
    if (!isPathAllowed(filePath, allowedDir)) {
      console.warn('[IPC fs:writeFile] Path not in allowed directory:', filePath, allowedDir)
      return { success: false, error: 'Path not in allowed directory. Write is only permitted within the project directory.' }
    }
    // Additional security: block writing to sensitive system files
    const sensitivePatterns = ['.ssh', '.bashrc', '.profile', '/etc/', '/.aws/']
    const isSensitive = sensitivePatterns.some(pattern => filePath.includes(pattern))
    if (isSensitive) {
      console.warn('[IPC fs:writeFile] Blocked attempt to write sensitive file:', filePath)
      return { success: false, error: 'Writing to sensitive system files is not allowed' }
    }
    try {
      await writeFile(filePath, content, 'utf-8')
      console.log('[IPC fs:writeFile] File written:', filePath)
      return { success: true }
    } catch (err) {
      console.error('[IPC fs:writeFile]', err)
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('close-agent-sessions', async (_event, dbPath: string, agentName: string) => {
    try {
      const sqlJs = await getSqlJs()
      const buf = await readFile(dbPath)
      const db = new sqlJs.Database(buf)
      try {
        db.run(
          `UPDATE sessions SET statut='terminé', ended_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
           WHERE statut='en_cours'
             AND agent_id=(SELECT id FROM agents WHERE name=?)`,
          [agentName]
        )
        const exported = db.export()
        await writeFile(dbPath, Buffer.from(exported))
        return { success: true }
      } finally {
        db.close()
      }
    } catch (err) {
      console.error('[IPC close-agent-sessions]', err)
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('rename-agent', async (_event, dbPath: string, agentId: number, newName: string) => {
    try {
      const sqlJs = await getSqlJs()
      const buf = await readFile(dbPath)
      const db = new sqlJs.Database(buf)
      try {
        db.run('UPDATE agents SET name = ? WHERE id = ?', [newName, agentId])
        const exported = db.export()
        await writeFile(dbPath, Buffer.from(exported))
        return { success: true }
      } finally {
        db.close()
      }
    } catch (err) {
      console.error('[IPC rename-agent]', err)
      return { success: false, error: String(err) }
    }
  })

  interface SearchFilters {
    statut?: string
    agent_id?: number
    perimetre?: string
  }

  ipcMain.handle('update-perimetre', async (_event, dbPath: string, id: number, oldName: string, newName: string, description: string) => {
    try {
      const sqlJs = await getSqlJs()
      const buf = await readFile(dbPath)
      const db = new sqlJs.Database(buf)
      try {
        db.run('UPDATE perimetres SET name = ?, description = ? WHERE id = ?', [newName, description || null, id])
        if (newName !== oldName) {
          db.run('UPDATE tasks SET perimetre = ? WHERE perimetre = ?', [newName, oldName])
          db.run('UPDATE agents SET perimetre = ? WHERE perimetre = ?', [newName, oldName])
        }
        const exported = db.export()
        await writeFile(dbPath, Buffer.from(exported))
        return { success: true }
      } finally {
        db.close()
      }
    } catch (err) {
      console.error('[IPC update-perimetre]', err)
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('update-agent-system-prompt', async (_event, dbPath: string, agentId: number, systemPrompt: string) => {
    try {
      const sqlJs = await getSqlJs()
      const buf = await readFile(dbPath)
      const db = new sqlJs.Database(buf)
      try {
        db.run('UPDATE agents SET system_prompt = ? WHERE id = ?', [systemPrompt || null, agentId])
        const exported = db.export()
        await writeFile(dbPath, Buffer.from(exported))
        return { success: true }
      } finally {
        db.close()
      }
    } catch (err) {
      console.error('[IPC update-agent-system-prompt]', err)
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('build-agent-prompt', async (_event, agentName: string, userPrompt: string, dbPath?: string, agentId?: number) => {
    const HIDDEN_SUFFIX = `Tu es agent ${agentName}. Va voir ton prompt system dans la table agent.`
    const body = userPrompt && userPrompt.trim() ? `${userPrompt.trim()}\n\n` : ''
    const base = `${body}${HIDDEN_SUFFIX}`

    // Inject pre-computed startup context (task #220) to avoid DB tool calls at agent startup.
    // Only injected when dbPath + agentId are provided (i.e. launched from LaunchSessionModal).
    if (!dbPath || !agentId) return base

    try {
      // Last terminated session summary for this agent
      const sessionRows = await queryLive(
        dbPath,
        `SELECT summary FROM sessions
         WHERE agent_id = ? AND statut = 'terminé' AND summary IS NOT NULL
         ORDER BY id DESC LIMIT 1`,
        [agentId]
      ) as Array<{ summary: string }>

      // Open tasks assigned to this agent
      const taskRows = await queryLive(
        dbPath,
        `SELECT id, titre, statut FROM tasks
         WHERE agent_assigne_id = ? AND statut IN ('a_faire','en_cours','todo','in_progress')
         ORDER BY id ASC LIMIT 5`,
        [agentId]
      ) as Array<{ id: number; titre: string; statut: string }>

      const parts: string[] = []

      if (sessionRows.length > 0 && sessionRows[0].summary) {
        const summary = sessionRows[0].summary.slice(0, 120)
        parts.push(`Session préc.: ${summary}`)
      }

      if (taskRows.length > 0) {
        const taskList = taskRows.map(t => `#${t.id}[${t.statut}]`).join(' ')
        parts.push(`Tâches: ${taskList}`)
      }

      if (parts.length === 0) return base

      // Build context prefix (max 300 chars total for context part)
      const contextPrefix = parts.join(' | ').slice(0, 300)
      return `${contextPrefix} -> ${base}`
    } catch {
      // If DB query fails (e.g. DB locked or path invalid), fall back to base prompt
      return base
    }
  })

  /**
   * Stores a Claude Code conversation ID on the most recent session of an agent.
   * Called by the renderer after detecting the UUID in PTY output (task #218).
   *
   * Associates the conv_id with the agent's latest session in the DB so the
   * next launch can use `--resume <conv_id>` to skip context re-injection.
   */
  ipcMain.handle('session:setConvId', async (_event, dbPath: string, agentId: number, convId: string) => {
    if (!dbPath || typeof agentId !== 'number' || !convId) {
      return { success: false, error: 'Invalid arguments' }
    }
    try {
      const sqlJs = await getSqlJs()
      const buf = await readFile(dbPath)
      const db = new sqlJs.Database(buf)
      try {
        db.run(
          `UPDATE sessions SET claude_conv_id = ?
           WHERE id = (
             SELECT id FROM sessions WHERE agent_id = ? ORDER BY id DESC LIMIT 1
           )`,
          [convId, agentId]
        )
        const exported = db.export()
        await writeFile(dbPath, Buffer.from(exported))
        console.log(`[IPC session:setConvId] agent=${agentId} conv_id=${convId}`)
        return { success: true }
      } finally {
        db.close()
      }
    } catch (err) {
      console.error('[IPC session:setConvId]', err)
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('get-agent-system-prompt', async (_event, dbPath: string, agentId: number) => {
    try {
      const rows = await queryLive(
        dbPath,
        'SELECT system_prompt, system_prompt_suffix, thinking_mode FROM agents WHERE id = ?',
        [agentId]
      )
      if (rows.length === 0) {
        return { success: false, error: 'Agent not found', systemPrompt: null, systemPromptSuffix: null, thinkingMode: null }
      }
      const row = rows[0] as { system_prompt: string | null; system_prompt_suffix: string | null; thinking_mode: string | null }
      return {
        success: true,
        systemPrompt: row.system_prompt,
        systemPromptSuffix: row.system_prompt_suffix,
        thinkingMode: row.thinking_mode
      }
    } catch (err) {
      console.error('[IPC get-agent-system-prompt]', err)
      return { success: false, error: String(err), systemPrompt: null, systemPromptSuffix: null, thinkingMode: null }
    }
  })

  ipcMain.handle('update-agent-thinking-mode', async (_event, dbPath: string, agentId: number, thinkingMode: string | null) => {
    // Validate: only 'auto', 'disabled', or null are valid values
    if (thinkingMode !== null && thinkingMode !== 'auto' && thinkingMode !== 'disabled') {
      return { success: false, error: `Invalid thinkingMode value: '${thinkingMode}'. Accepted: 'auto', 'disabled', null` }
    }
    try {
      const sqlJs = await getSqlJs()
      const buf = await readFile(dbPath)
      const db = new sqlJs.Database(buf)
      try {
        db.run('UPDATE agents SET thinking_mode = ? WHERE id = ?', [thinkingMode || null, agentId])
        const exported = db.export()
        await writeFile(dbPath, Buffer.from(exported))
        return { success: true }
      } finally {
        db.close()
      }
    } catch (err) {
      console.error('[IPC update-agent-thinking-mode]', err)
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('update-agent', async (_event, dbPath: string, agentId: number, updates: {
    name?: string
    type?: string
    perimetre?: string | null
    thinkingMode?: string | null
    allowedTools?: string | null
    systemPrompt?: string | null
    systemPromptSuffix?: string | null
  }) => {
    try {
      const sqlJs = await getSqlJs()
      const buf = await readFile(dbPath)
      const db = new sqlJs.Database(buf)
      try {
        if (updates.name !== undefined) {
          db.run('UPDATE agents SET name = ? WHERE id = ?', [updates.name, agentId])
        }
        if (updates.type !== undefined) {
          db.run('UPDATE agents SET type = ? WHERE id = ?', [updates.type, agentId])
        }
        if (updates.perimetre !== undefined) {
          db.run('UPDATE agents SET perimetre = ? WHERE id = ?', [updates.perimetre || null, agentId])
        }
        if (updates.thinkingMode !== undefined) {
          db.run('UPDATE agents SET thinking_mode = ? WHERE id = ?', [updates.thinkingMode || null, agentId])
        }
        if (updates.allowedTools !== undefined) {
          db.run('UPDATE agents SET allowed_tools = ? WHERE id = ?', [updates.allowedTools || null, agentId])
        }
        if (updates.systemPrompt !== undefined) {
          db.run('UPDATE agents SET system_prompt = ? WHERE id = ?', [updates.systemPrompt || null, agentId])
        }
        if (updates.systemPromptSuffix !== undefined) {
          db.run('UPDATE agents SET system_prompt_suffix = ? WHERE id = ?', [updates.systemPromptSuffix || null, agentId])
        }
        const exported = db.export()
        await writeFile(dbPath, Buffer.from(exported))
        return { success: true }
      } finally {
        db.close()
      }
    } catch (err) {
      console.error('[IPC update-agent]', err)
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('get-config-value', async (_event, dbPath: string, key: string) => {
    try {
      const rows = await queryLive(dbPath, 'SELECT value FROM config WHERE key = ?', [key])
      return { success: true, value: rows.length > 0 ? (rows[0] as { value: string }).value : null }
    } catch (err) {
      console.error('[IPC get-config-value]', err)
      return { success: false, value: null, error: String(err) }
    }
  })

  ipcMain.handle('set-config-value', async (_event, dbPath: string, key: string, value: string) => {
    try {
      // Encrypt github_token before storing (safeStorage - OS-level encryption)
      const storedValue = key === 'github_token' ? encryptToken(value) : value

      const sqlJs = await getSqlJs()
      const buf = await readFile(dbPath)
      const db = new sqlJs.Database(buf)
      try {
        db.run(
          'INSERT OR REPLACE INTO config (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
          [key, storedValue]
        )
        const exported = db.export()
        await writeFile(dbPath, Buffer.from(exported))
        return { success: true }
      } finally {
        db.close()
      }
    } catch (err) {
      console.error('[IPC set-config-value]', err)
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('check-master-md', async (_event, dbPath: string) => {
    try {
      // Read token from DB config (never from renderer — stays in main process)
      const tokenRows = await queryLive(dbPath, "SELECT value FROM config WHERE key = 'github_token'", [])
      const encryptedToken = tokenRows.length > 0 ? (tokenRows[0] as { value: string }).value : null
      const token = encryptedToken ? decryptToken(encryptedToken) : null

      // Read current local SHA from DB config
      const shaRows = await queryLive(dbPath, "SELECT value FROM config WHERE key = 'claude_md_commit'", [])
      const localSha = shaRows.length > 0 ? (shaRows[0] as { value: string }).value : ''

      // Fetch from GitHub API: IvyNotFound/master.md repo
      const headers: Record<string, string> = { Accept: 'application/vnd.github.v3+json' }
      if (token) headers['Authorization'] = `token ${token}`

      const response = await fetch(
        'https://api.github.com/repos/IvyNotFound/master.md/contents/CLAUDE.md',
        { headers }
      )
      if (!response.ok) {
        return { success: false, error: `GitHub API: HTTP ${response.status}` }
      }
      const data = await response.json() as { sha: string; content: string }
      const remoteSha: string = data.sha
      const content = Buffer.from(data.content, 'base64').toString('utf-8')
      const upToDate = localSha !== '' && localSha === remoteSha

      return { success: true, sha: remoteSha, content, upToDate, localSha }
    } catch (err) {
      console.error('[IPC check-master-md]', err)
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('apply-master-md', async (_event, dbPath: string, projectPath: string, content: string, sha: string) => {
    try {
      const claudeMdPath = join(projectPath, 'CLAUDE.md')
      const tmpPath = claudeMdPath + '.tmp'

      // Atomic write: write to .tmp then rename
      await writeFile(tmpPath, content, 'utf-8')
      await rename(tmpPath, claudeMdPath)
      console.log('[IPC apply-master-md] CLAUDE.md written atomically:', claudeMdPath)

      // Update claude_md_commit in DB config
      const sqlJs = await getSqlJs()
      const buf = await readFile(dbPath)
      const db = new sqlJs.Database(buf)
      try {
        db.run(
          "INSERT OR REPLACE INTO config (key, value, updated_at) VALUES ('claude_md_commit', ?, CURRENT_TIMESTAMP)",
          [sha]
        )
        const exported = db.export()
        await writeFile(dbPath, Buffer.from(exported))
      } finally {
        db.close()
      }

      return { success: true }
    } catch (err) {
      console.error('[IPC apply-master-md]', err)
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('search-tasks', async (
    _event,
    dbPath: string,
    query: string,
    filters?: SearchFilters
  ) => {
    try {
      const conditions: string[] = []
      const params: unknown[] = []

      // Full-text search on titre, description (commentaire removed - use task_comments table)
      if (query && query.trim()) {
        const q = `%${query.trim()}%`
        conditions.push('(t.titre LIKE ? OR t.description LIKE ?)')
        params.push(q, q)
      }

      // Optional filters
      if (filters?.statut) {
        conditions.push('t.statut = ?')
        params.push(filters.statut)
      }
      if (filters?.agent_id) {
        conditions.push('t.agent_assigne_id = ?')
        params.push(filters.agent_id)
      }
      if (filters?.perimetre) {
        conditions.push('t.perimetre = ?')
        params.push(filters.perimetre)
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

      // Build excerpt from description (first 100 chars)
      const sql = `
        SELECT
          t.id,
          t.titre,
          t.statut,
          t.perimetre,
          t.updated_at,
          t.description,
          SUBSTR(t.description, 1, 100) as description_excerpt,
          a.name as agent_assigne
        FROM tasks t
        LEFT JOIN agents a ON a.id = t.agent_assigne_id
        ${whereClause}
        ORDER BY t.updated_at DESC
        LIMIT 50
      `

      const rows = await queryLive(dbPath, sql, params)
      return { success: true, results: rows }
    } catch (err) {
      console.error('[IPC search-tasks]', err)
      return { success: false, error: String(err), results: [] }
    }
  })

  ipcMain.handle('test-github-connection', async (_event, dbPath: string, repoUrl: string) => {
    try {
      const match = repoUrl.match(/github\.com[/:]([^/]+)\/([^/.]+)/)
      if (!match) return { connected: false, error: 'URL invalide' }
      const owner = match[1]
      const repo = match[2].replace(/\.git$/, '')

      const tokenRows = await queryLive(dbPath, "SELECT value FROM config WHERE key = 'github_token'", [])
      const encryptedToken = tokenRows.length > 0 ? (tokenRows[0] as { value: string }).value : null
      const token = encryptedToken ? decryptToken(encryptedToken) : null

      const headers: Record<string, string> = {}
      if (token) headers['Authorization'] = `token ${token}`

      const response = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers })
      return { connected: response.ok }
    } catch (err) {
      console.error('[IPC test-github-connection]', err)
      return { connected: false, error: String(err) }
    }
  })

  ipcMain.handle('check-for-updates', async (_event, dbPath: string, repoUrl: string, currentVersion: string) => {
    try {
      const match = repoUrl.match(/github\.com[/:]([^/]+)\/([^/.]+)/)
      if (!match) return { hasUpdate: false, latestVersion: '', error: 'URL invalide' }
      const owner = match[1]
      const repo = match[2].replace(/\.git$/, '')

      const tokenRows = await queryLive(dbPath, "SELECT value FROM config WHERE key = 'github_token'", [])
      const encryptedToken = tokenRows.length > 0 ? (tokenRows[0] as { value: string }).value : null
      const token = encryptedToken ? decryptToken(encryptedToken) : null

      const headers: Record<string, string> = { Accept: 'application/vnd.github.v3+json' }
      if (token) headers['Authorization'] = `token ${token}`

      const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/latest`, { headers })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = await response.json() as { tag_name?: string }
      const latestVersion = data.tag_name?.replace(/^v/, '') || ''
      const hasUpdate = !!latestVersion && latestVersion > currentVersion
      return { hasUpdate, latestVersion }
    } catch (err) {
      console.error('[IPC check-for-updates]', err)
      return { hasUpdate: false, latestVersion: '', error: String(err) }
    }
  })

  const STANDARD_AGENT_SUFFIX = [
    '---',
    'AGENT PROTOCOL REMINDER (mandatory — do not override):',
    '- On startup: read input session (sessions.summary) + open tasks from project.db',
    '- Before modifying a file: check locks, then INSERT OR REPLACE INTO locks',
    "- When taking a task: UPDATE tasks SET statut='in_progress'",
    "- When finishing a task: UPDATE tasks SET statut='done' + INSERT INTO task_comments (task_id, agent_id, contenu) VALUES (?, ?, '<files changed · what was done · what remains>')",
    "- When ending session: release all locks + UPDATE sessions SET statut='terminé', summary='Done:... Pending:... Next:...' (this IS the input session for next startup)",
    '- Never commit directly to main in multi-user mode',
    '- Never edit project.db manually',
  ].join('\n')

  const SCOPED_TYPES = new Set(['dev', 'test', 'ux'])

  function insertAgentIntoClaudeMd(content: string, agentType: string, agentName: string, agentDescription: string): string {
    const isScoped = SCOPED_TYPES.has(agentType)
    const sectionHeader = isScoped ? '### Scopés par périmètre' : '### Globaux'
    const newRow = isScoped
      ? `| **${agentType}** | \`${agentName}\` | ${agentDescription} |`
      : `| **${agentName}** | ${agentDescription} |`

    const sectionIdx = content.indexOf(sectionHeader)
    if (sectionIdx === -1) return content

    const afterSection = content.slice(sectionIdx)
    const lines = afterSection.split('\n')
    let lastTableLineIdx = -1
    let inTable = false
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('|')) {
        inTable = true
        lastTableLineIdx = i
      } else if (inTable && lines[i].trim() === '') {
        break
      }
    }
    if (lastTableLineIdx === -1) return content
    lines.splice(lastTableLineIdx + 1, 0, newRow)
    return content.slice(0, sectionIdx) + lines.join('\n')
  }

  ipcMain.handle('create-agent', async (
    _event,
    dbPath: string,
    projectPath: string,
    data: { name: string; type: string; perimetre: string | null; thinkingMode: string | null; systemPrompt: string | null; description: string }
  ) => {
    try {
      // 1. Check for duplicate name
      const existing = await queryLive(dbPath, 'SELECT id FROM agents WHERE name = ?', [data.name])
      if (existing.length > 0) {
        return { success: false, error: `Un agent nommé "${data.name}" existe déjà` }
      }

      // 2. INSERT agent with standard suffix
      const sqlJs = await getSqlJs()
      const buf = await readFile(dbPath)
      const db = new sqlJs.Database(buf)
      let agentId: number
      try {
        db.run(
          'INSERT INTO agents (name, type, perimetre, thinking_mode, system_prompt, system_prompt_suffix) VALUES (?, ?, ?, ?, ?, ?)',
          [data.name, data.type, data.perimetre ?? null, data.thinkingMode ?? null, data.systemPrompt ?? null, STANDARD_AGENT_SUFFIX]
        )
        const rows = db.exec('SELECT last_insert_rowid() as id')
        agentId = rows[0].values[0][0] as number
        const exported = db.export()
        await writeFile(dbPath, Buffer.from(exported))
      } finally {
        db.close()
      }

      // 3. Update CLAUDE.md (best-effort — skip if locked or not found)
      let claudeMdUpdated = false
      try {
        const claudeMdPath = join(projectPath, 'CLAUDE.md')
        const claudeMdContent = await readFile(claudeMdPath, 'utf-8')
        const updated = insertAgentIntoClaudeMd(claudeMdContent, data.type, data.name, data.description)
        if (updated !== claudeMdContent) {
          const tmpPath = claudeMdPath + '.tmp'
          await writeFile(tmpPath, updated, 'utf-8')
          await rename(tmpPath, claudeMdPath)
          claudeMdUpdated = true
        }
      } catch (claudeErr) {
        console.warn('[IPC create-agent] CLAUDE.md update skipped:', claudeErr)
      }

      return { success: true, agentId, claudeMdUpdated }
    } catch (err) {
      console.error('[IPC create-agent]', err)
      return { success: false, error: String(err) }
    }
  })
}
