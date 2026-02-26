/**
 * Database infrastructure for agent-viewer
 *
 * Provides sql.js (WASM) caching, read/write helpers with concurrency
 * protection, and security registries for allowed paths.
 *
 * @module db
 */

import { readFile, writeFile, rename, stat, copyFile, unlink } from 'fs/promises'
import { join, dirname, resolve } from 'path'
import {
  runTaskStatusMigration,
  runAddPriorityMigration,
  runTaskStatutI18nMigration,
  runAddConvIdToSessionsMigration,
  runAddTokensToSessionsMigration,
  runRemoveThinkingModeBudgetTokensMigration,
  runDropCommentaireColumnMigration,
  runSessionStatutI18nMigration,
  runMakeAgentAssigneNotNullMigration,
  runMakeCommentAgentNotNullMigration,
  runAddAgentGroupsMigration
} from './migration'

// ── T282: Registry of allowed DB paths ────────────────────────────────────────
const allowedDbPaths = new Set<string>()

/** Register a dbPath as allowed for write operations. Called by project open/create handlers. */
export function registerDbPath(dbPath: string | null | undefined): void {
  if (dbPath) allowedDbPaths.add(resolve(dbPath))
}

/**
 * Throws if dbPath was not registered via registerDbPath().
 * @throws {Error} DB_PATH_NOT_ALLOWED if path is not in the allow-list.
 */
export function assertDbPathAllowed(dbPath: string): void {
  if (!dbPath || !allowedDbPaths.has(resolve(dbPath))) {
    throw new Error('DB_PATH_NOT_ALLOWED: ' + dbPath)
  }
}

// ── T283: Registry of allowed project paths ──────────────────────────────────
const allowedProjectPaths = new Set<string>()

/** Register a projectPath as allowed for write operations. */
export function registerProjectPath(projectPath: string | null | undefined): void {
  if (projectPath) allowedProjectPaths.add(resolve(projectPath))
}

/**
 * Throws if projectPath was not registered via registerProjectPath().
 * @throws {Error} PROJECT_PATH_NOT_ALLOWED if path is not in the allow-list.
 */
export function assertProjectPathAllowed(projectPath: string): void {
  if (!projectPath || !allowedProjectPaths.has(resolve(projectPath))) {
    throw new Error('PROJECT_PATH_NOT_ALLOWED: ' + projectPath)
  }
}

// ── DB Cache ─────────────────────────────────────────────────────────────────
interface DbCacheEntry {
  buf: Buffer
  mtime: number
  lastAccess: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any | null // Cached sql.js Database instance (lazily created)
}
const dbCache = new Map<string, DbCacheEntry>()

const CACHE_TTL_MS = 60000
const MAX_CACHE_ENTRIES = 3

function evictStaleCacheEntries(): void {
  const now = Date.now()
  for (const [path, entry] of dbCache.entries()) {
    if (now - entry.lastAccess > CACHE_TTL_MS) {
      if (entry.db) { try { entry.db.close() } catch { /* already closed */ } }
      dbCache.delete(path)
    }
  }
}

function enforceMaxCacheEntries(): void {
  if (dbCache.size >= MAX_CACHE_ENTRIES) {
    let oldestPath: string | null = null
    let oldestTime = Infinity
    for (const [path, entry] of dbCache.entries()) {
      if (entry.lastAccess < oldestTime) {
        oldestTime = entry.lastAccess
        oldestPath = path
      }
    }
    if (oldestPath) {
      const entry = dbCache.get(oldestPath)
      if (entry?.db) { try { entry.db.close() } catch { /* already closed */ } }
      dbCache.delete(oldestPath)
    }
  }
}

/**
 * Gets database buffer with caching based on file mtime.
 * Avoids re-reading disk if file hasn't changed.
 */
export async function getDbBuffer(dbPath: string): Promise<Buffer> {
  evictStaleCacheEntries()
  enforceMaxCacheEntries()

  try {
    const statResult = await stat(dbPath)
    const mtimeMs = statResult.mtimeMs
    const now = Date.now()

    const cached = dbCache.get(dbPath)
    if (cached && cached.mtime === mtimeMs) {
      cached.lastAccess = now
      return cached.buf
    }

    if (cached?.db) { try { cached.db.close() } catch { /* already closed */ } }

    const buf = await readFile(dbPath)
    dbCache.set(dbPath, { buf, mtime: mtimeMs, lastAccess: now, db: null })
    return buf
  } catch {
    return readFile(dbPath)
  }
}

// ── sql.js singleton ─────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let SQL: any = null

/**
 * Get the sql.js WASM singleton. Lazily initialized on first call.
 * @returns {Promise} sql.js module instance
 */
export async function getSqlJs() {
  if (!SQL) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const initSqlJs = require('sql.js')
    const wasmDir = dirname(require.resolve('sql.js'))
    SQL = await initSqlJs({
      locateFile: (file: string) => join(wasmDir, file)
    })
  }
  return SQL
}

// ── T313: Per-path write mutex ───────────────────────────────────────────────
const writeMutex = new Map<string, Promise<unknown>>()

/**
 * Shared write helper — reads via cached buffer, runs mutation, exports + writes.
 * Uses per-path mutex and atomic write (temp file + rename).
 * @param dbPath - Absolute path to the SQLite database file
 * @param fn - Callback receiving a sql.js Database instance to run mutations on
 * @returns The value returned by the callback
 * @throws If the database read, mutation, or atomic write fails
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function writeDb<T = void>(dbPath: string, fn: (db: any) => T): Promise<T> {
  const prev = writeMutex.get(dbPath) ?? Promise.resolve()
  let release: () => void
  const gate = new Promise<void>((r) => { release = r })
  writeMutex.set(dbPath, gate)

  try {
    await prev
    const sqlJs = await getSqlJs()
    const buf = await getDbBuffer(dbPath)
    const db = new sqlJs.Database(buf)
    try {
      const result = fn(db)
      const exported = db.export()
      const newBuf = Buffer.from(exported)
      const tmpPath = dbPath + '.tmp'
      await writeFile(tmpPath, newBuf)
      // On Windows, rename over a locked file throws EPERM — fall back to copyFile + unlink
      try {
        await rename(tmpPath, dbPath)
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code === 'EPERM') {
          await copyFile(tmpPath, dbPath)
          await unlink(tmpPath)
        } else {
          throw err
        }
      }
      // Update cache: refresh buffer + recreate DB instance from exported data
      // so the next queryLive doesn't need to reinstantiate (~10-50ms saved)
      const statResult = await stat(dbPath)
      const entry = dbCache.get(dbPath)
      if (entry?.db) { try { entry.db.close() } catch { /* ignore */ } }
      const freshDb = new sqlJs.Database(newBuf)
      if (entry) {
        entry.buf = newBuf
        entry.mtime = statResult.mtimeMs
        entry.lastAccess = Date.now()
        entry.db = freshDb
      } else {
        dbCache.set(dbPath, { buf: newBuf, mtime: statResult.mtimeMs, lastAccess: Date.now(), db: freshDb })
      }
      return result
    } finally {
      db.close()
    }
  } finally {
    release!()
    if (writeMutex.get(dbPath) === gate) writeMutex.delete(dbPath)
  }
}

// ── queryLive ────────────────────────────────────────────────────────────────

/**
 * Execute a read-only SQL query using cached DB buffer and sql.js instance.
 * Retries once on malformed DB errors (cache invalidation).
 * @param dbPath - Path to the SQLite database
 * @param query - SQL query string
 * @param params - Bind parameters
 * @returns {Promise<Record<string, unknown>[]>} Query result rows
 * @throws {Error} If query fails after retry
 */
export async function queryLive(dbPath: string, query: string, params: unknown[]): Promise<unknown[]> {
  return queryLiveAttempt(dbPath, query, params, true)
}

async function queryLiveAttempt(
  dbPath: string, query: string, params: unknown[], canRetry: boolean
): Promise<unknown[]> {
  const sqlJs = await getSqlJs()
  const buf = await getDbBuffer(dbPath)

  const entry = dbCache.get(dbPath)
  let db = entry?.db
  if (!db) {
    db = new sqlJs.Database(buf)
    if (entry) entry.db = db
  }

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
  } catch (err) {
    if (entry && entry.db === db) {
      try { db.close() } catch { /* ignore */ }
      entry.db = null
    }
    const msg = String(err)
    if (canRetry && (msg.includes('malformed') || msg.includes('not a database'))) {
      console.warn('[queryLive] Malformed DB buffer — evicting cache and retrying once:', msg)
      dbCache.delete(dbPath)
      return queryLiveAttempt(dbPath, query, params, false)
    }
    throw err
  }
}

// ── Migration ────────────────────────────────────────────────────────────────

/** Current schema version — bump when adding migrations or indexes. */
const CURRENT_SCHEMA_VERSION = '7'

/**
 * Run all pending schema migrations on a project database.
 * Creates a backup (.bak) before migrating and deletes it on success.
 * @param dbPath - Path to the SQLite database
 * @returns {Promise<{ migrated: number }>} Number of rows migrated
 * @throws {Error} If migration fails (backup is kept)
 */
export async function migrateDb(dbPath: string): Promise<{ migrated: number }> {
  // T382: Fast-path — skip full migration if schema is already up to date
  const sqlJs = await getSqlJs()
  try {
    const checkBuf = await getDbBuffer(dbPath)
    const checkDb = new sqlJs.Database(checkBuf)
    try {
      const result = checkDb.exec("SELECT value FROM config WHERE key = 'schema_version'")
      if (result.length > 0 && result[0].values.length > 0 && result[0].values[0][0] === CURRENT_SCHEMA_VERSION) {
        return { migrated: 0 }
      }
    } finally {
      checkDb.close()
    }
  } catch { /* config table may not exist yet — run full migration */ }

  const backupPath = `${dbPath}.bak`
  await copyFile(dbPath, backupPath)

  const buf = await readFile(dbPath)
  const db = new sqlJs.Database(buf)
  let changed = false

  try {
    const tasksColsBefore = db.exec('PRAGMA table_info(tasks)')
    const hadCommentaire = tasksColsBefore.length > 0 &&
      tasksColsBefore[0].values.some((r: unknown[]) => r[1] === 'commentaire')
    const commentaireMigrated = runDropCommentaireColumnMigration(db)
    if (hadCommentaire) {
      changed = true
      console.log(`[migrateDb] dropped tasks.commentaire column (${commentaireMigrated} rows migrated to task_comments)`)
    }

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
    if (!existingCols.has('auto_launch')) {
      db.run('ALTER TABLE agents ADD COLUMN auto_launch INTEGER NOT NULL DEFAULT 1')
      changed = true
      console.log('[migrateDb] added auto_launch column to agents')
    }
    if (!existingCols.has('permission_mode')) {
      db.run("ALTER TABLE agents ADD COLUMN permission_mode TEXT CHECK(permission_mode IN ('default', 'auto')) DEFAULT 'default'")
      changed = true
      console.log('[migrateDb] added permission_mode column to agents')
    }
    if (!existingCols.has('max_sessions')) {
      db.run('ALTER TABLE agents ADD COLUMN max_sessions INTEGER NOT NULL DEFAULT 3')
      changed = true
      console.log('[migrateDb] added max_sessions column to agents')
    }

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
        ('schema_version', '2')`)
      changed = true
    }

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

    db.run('CREATE INDEX IF NOT EXISTS idx_sessions_agent_id ON sessions(agent_id)')
    db.run('CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON sessions(started_at DESC)')
    db.run('CREATE INDEX IF NOT EXISTS idx_agent_logs_agent_id ON agent_logs(agent_id)')
    db.run('CREATE INDEX IF NOT EXISTS idx_agent_logs_created_at ON agent_logs(created_at DESC)')
    db.run('CREATE INDEX IF NOT EXISTS idx_locks_released_at ON locks(released_at)')
    db.run('CREATE INDEX IF NOT EXISTS idx_tasks_updated_at ON tasks(updated_at DESC)')
    db.run('CREATE INDEX IF NOT EXISTS idx_tasks_agent_assigne ON tasks(agent_assigne_id)')
    // T374: Composite index for ROW_NUMBER() OVER (PARTITION BY agent_id ORDER BY started_at DESC)
    db.run('CREATE INDEX IF NOT EXISTS idx_sessions_agent_started ON sessions(agent_id, started_at DESC)')
    // T375: Index for task_comments JOIN on task_id
    db.run('CREATE INDEX IF NOT EXISTS idx_task_comments_task_id ON task_comments(task_id)')
    changed = true

    // T414 (schema v4): task_agents table for multi-agent assignment
    if (!existingTables.has('task_agents')) {
      db.run(`CREATE TABLE IF NOT EXISTS task_agents (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id     INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        agent_id    INTEGER NOT NULL REFERENCES agents(id),
        role        TEXT CHECK(role IN ('primary', 'support', 'reviewer')),
        assigned_at TEXT DEFAULT (datetime('now')),
        UNIQUE(task_id, agent_id)
      )`)
      changed = true
      console.log('[migrateDb] created task_agents table')
    }
    db.run('CREATE INDEX IF NOT EXISTS idx_task_agents_task_id ON task_agents(task_id)')
    db.run('CREATE INDEX IF NOT EXISTS idx_task_agents_agent_id ON task_agents(agent_id)')

    const convIdAdded = runAddConvIdToSessionsMigration(db)
    if (convIdAdded) {
      changed = true
      console.log('[migrateDb] added claude_conv_id column to sessions')
    }

    const tokensAdded = runAddTokensToSessionsMigration(db)
    if (tokensAdded > 0) {
      changed = true
      console.log(`[migrateDb] added ${tokensAdded} token tracking columns to sessions`)
    }

    const priorityAdded = runAddPriorityMigration(db)
    if (priorityAdded) {
      changed = true
      console.log('[migrateDb] added priority column to tasks')
    }

    const i18nMigrated = runTaskStatutI18nMigration(db)
    if (i18nMigrated > 0) {
      changed = true
      console.log(`[migrateDb] migrated ${i18nMigrated} tasks statuts from French to English`)
    }

    const thinkingModeMigrated = runRemoveThinkingModeBudgetTokensMigration(db)
    if (thinkingModeMigrated) {
      changed = true
      console.log('[migrateDb] removed budget_tokens from agents.thinking_mode CHECK constraint')
    }

    const legacyMigrated = runTaskStatusMigration(db)
    if (legacyMigrated > 0) {
      changed = true
      console.log(`[migrateDb] migrated ${legacyMigrated} tasks via legacy runTaskStatusMigration`)
    }

    // --- tasks: agent_assigne_id NOT NULL (T342) ---
    const assigneMigrated = runMakeAgentAssigneNotNullMigration(db)
    if (assigneMigrated) {
      changed = true
      console.log('[migrateDb] made agent_assigne_id and agent_createur_id NOT NULL on tasks table')
    }

    const commentAgentMigrated = runMakeCommentAgentNotNullMigration(db)
    if (commentAgentMigrated) {
      changed = true
      console.log('[migrateDb] made agent_id NOT NULL on task_comments table')
    }

    // --- T556: agent_groups + agent_group_members ---
    const agentGroupsMigrated = runAddAgentGroupsMigration(db)
    if (agentGroupsMigrated) {
      changed = true
      console.log('[migrateDb] created agent_groups and agent_group_members tables')
    }

    // --- sessions: statut French → English (T329) ---
    const sessionsMigrated = runSessionStatutI18nMigration(db)
    if (sessionsMigrated > 0) {
      changed = true
      console.log(`[migrateDb] migrated ${sessionsMigrated} sessions statuts from French to English`)
    }

    if (changed) {
      // T382: Stamp schema version so next startup skips full migration
      db.run("INSERT OR REPLACE INTO config (key, value, updated_at) VALUES ('schema_version', ?, CURRENT_TIMESTAMP)", [CURRENT_SCHEMA_VERSION])
      const exported = db.export()
      await writeFile(dbPath, Buffer.from(exported))
      console.log('[migrateDb] schema updated:', dbPath)
    }

    await unlink(backupPath).catch(() => {
      console.warn('[migrateDb] could not delete backup:', backupPath)
    })

    const migrated = i18nMigrated + legacyMigrated + sessionsMigrated
    return { migrated }
  } catch (err) {
    console.error('[migrateDb] migration failed, backup kept at:', backupPath, err)
    throw err
  } finally {
    db.close()
  }
}

// ── SQL write guard ──────────────────────────────────────────────────────────

export const FORBIDDEN_WRITE_PATTERN = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|REPLACE|ATTACH|DETACH|VACUUM)\b/i

/** Clear cached DB entry for a given path (used when unwatching). */
export function clearDbCacheEntry(dbPath: string): void {
  const entry = dbCache.get(dbPath)
  if (entry?.db) { try { entry.db.close() } catch { /* ignore */ } }
  dbCache.delete(dbPath)
}
