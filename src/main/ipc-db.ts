/**
 * IPC Handlers — Database query, watch, migration, and locks
 *
 * Covers: query-db, watch-db, unwatch-db, migrate-db
 * Note: watch/unwatch share watcher state — kept in the same module.
 *
 * @module ipc-db
 */

import { ipcMain, BrowserWindow } from 'electron'
import { watch, type FSWatcher } from 'fs'
import { dirname, basename } from 'path'
import {
  assertDbPathAllowed,
  FORBIDDEN_WRITE_PATTERN,
  queryLive,
  migrateDb,
  clearDbCacheEntry,
} from './db'
import { startSessionCloser, stopSessionCloser } from './session-closer'
import { pruneOrphanedWorktrees } from './worktree-manager'

// ── Default LIMIT for user queries (T1136) ────────────────────────────────────

const DEFAULT_QUERY_LIMIT = 1000

/**
 * Append a LIMIT clause to SELECT queries that don't already have one.
 * Prevents unbounded result sets from saturating main-process memory.
 * Only applies to SELECT statements — other SQL passes through unchanged.
 */
export function addDefaultLimit(sql: string, limit = DEFAULT_QUERY_LIMIT): string {
  if (/\bLIMIT\b/i.test(sql)) return sql
  if (!/\bSELECT\b/i.test(sql)) return sql
  // Strip trailing semicolons/whitespace before appending LIMIT
  const trimmed = sql.replace(/\s*;\s*$/, '')
  return `${trimmed} LIMIT ${limit}`
}

// ── Shared watcher state ──────────────────────────────────────────────────────

let watcher: FSWatcher | null = null
let debounceTimer: ReturnType<typeof setTimeout> | null = null

function notifyRenderer(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('db-changed')
  }
}

// ── Handler registration ──────────────────────────────────────────────────────

/** Register DB query, watch, and migration IPC handlers. */
export function registerDbHandlers(): void {
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
    if (!Array.isArray(params) || params.some(p => p !== null && typeof p !== 'string' && typeof p !== 'number' && typeof p !== 'boolean' && !(p instanceof Uint8Array))) {
      return { success: false, error: 'Invalid params: each element must be string, number, boolean, null, or Uint8Array.', rows: [] }
    }
    try {
      const safeQuery = addDefaultLimit(query)
      return await queryLive(dbPath, safeQuery, params)
    } catch (err) {
      const code = err && typeof err === 'object' && 'code' in err ? (err as { code: string }).code : 'UNKNOWN'
      if (code === 'SQLITE_CORRUPT') {
        console.warn('[IPC query-db] DB corrupt:', dbPath)
        return { success: false, error: 'DB_CORRUPT', rows: [] }
      }
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
      // Watch the parent directory to capture WAL-mode SQLite changes
      // (project.db-wal is written on each commit; main file only updated at checkpoint)
      watcher = watch(dirname(dbPath), { persistent: false }, (_event, filename) => {
        if (!filename || !filename.startsWith(basename(dbPath))) return
        if (debounceTimer) clearTimeout(debounceTimer)
        debounceTimer = setTimeout(() => notifyRenderer(), 300)
      })
      startSessionCloser(dbPath, (agentIds) => {
        for (const w of BrowserWindow.getAllWindows()) {
          if (!w.isDestroyed()) w.webContents.send('session:agents-completed', agentIds)
        }
      })
      const dbParentDir = dirname(dbPath)
      const repoRoot = basename(dbParentDir) === '.claude' ? dirname(dbParentDir) : dbParentDir
      void pruneOrphanedWorktrees(repoRoot, dbPath).catch((err) =>
        console.warn('[watch-db] pruneOrphanedWorktrees error:', err)
      )
    } catch (err) {
      console.error('[IPC watch-db]', err)
    }
  })

  /** Stop watching DB file and clear cache entry if dbPath provided. */
  ipcMain.handle('unwatch-db', (_event, dbPath?: string) => {
    if (watcher) { watcher.close(); watcher = null }
    if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null }
    stopSessionCloser()
    if (dbPath) {
      clearDbCacheEntry(dbPath)
      console.log('[IPC unwatch-db] Cache cleared for:', dbPath)
    }
  })

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
}
