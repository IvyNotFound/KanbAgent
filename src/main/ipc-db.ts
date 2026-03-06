/**
 * IPC Handlers — Database query, watch, migration, and locks
 *
 * Covers: query-db, watch-db, unwatch-db, migrate-db, get-locks
 * Note: watch/unwatch share watcher state — kept in the same module.
 *
 * @module ipc-db
 */

import { ipcMain, BrowserWindow } from 'electron'
import { watch, type FSWatcher } from 'fs'
import {
  assertDbPathAllowed,
  FORBIDDEN_WRITE_PATTERN,
  queryLive,
  migrateDb,
  clearDbCacheEntry,
} from './db'
import { startSessionCloser, stopSessionCloser } from './session-closer'

// ── Shared watcher state ──────────────────────────────────────────────────────

let watcher: FSWatcher | null = null
let debounceTimer: ReturnType<typeof setTimeout> | null = null

function notifyRenderer(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('db-changed')
  }
}

// ── Handler registration ──────────────────────────────────────────────────────

/** Register DB query, watch, migration, and lock IPC handlers. */
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
      startSessionCloser(dbPath)
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
   * Get all active (unreleased) file locks with agent names.
   * @param dbPath - Registered DB path
   * @returns {Array} Lock rows with agent_name joined
   */
  ipcMain.handle('get-locks', async (_event, dbPath: string) => {
    assertDbPathAllowed(dbPath)
    return queryLive(
      dbPath,
      `SELECT l.id, l.file, l.agent_id, a.name as agent_name,
              l.session_id, l.created_at, l.released_at
       FROM locks l
       JOIN agents a ON a.id = l.agent_id
       WHERE l.released_at IS NULL
       ORDER BY l.created_at DESC`,
      []
    )
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
