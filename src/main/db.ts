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
import { migrateDb as applyMigrations, CURRENT_SCHEMA_VERSION } from './migration'

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

/**
 * Run all pending schema migrations on a project database.
 * Creates a backup (.bak) before migrating and deletes it on success.
 *
 * Fast-path: skips migration if PRAGMA user_version is already at CURRENT_SCHEMA_VERSION.
 *
 * @param dbPath - Path to the SQLite database
 * @returns {Promise<{ migrated: number }>} Number of migrations applied
 * @throws {Error} If migration fails (backup is kept)
 */
export async function migrateDb(dbPath: string): Promise<{ migrated: number }> {
  const sqlJs = await getSqlJs()

  // Fast-path: check user_version before loading the full DB
  try {
    const checkBuf = await getDbBuffer(dbPath)
    const checkDb = new sqlJs.Database(checkBuf)
    try {
      const uvResult = checkDb.exec('PRAGMA user_version')
      const currentVersion = uvResult.length > 0 && uvResult[0].values.length > 0
        ? (uvResult[0].values[0][0] as number) : 0
      if (currentVersion >= CURRENT_SCHEMA_VERSION) return { migrated: 0 }
    } finally {
      checkDb.close()
    }
  } catch { /* DB unreadable — proceed to full migration */ }

  const backupPath = `${dbPath}.bak`
  await copyFile(dbPath, backupPath)

  const buf = await readFile(dbPath)
  const db = new sqlJs.Database(buf)

  try {
    const migrated = applyMigrations(db)

    if (migrated > 0) {
      const exported = db.export()
      await writeFile(dbPath, Buffer.from(exported))
      console.log('[migrateDb] schema updated:', dbPath)
    }

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

// ── SQL write guard ──────────────────────────────────────────────────────────

export const FORBIDDEN_WRITE_PATTERN = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|REPLACE|ATTACH|DETACH|VACUUM)\b/i

/** Clear cached DB entry for a given path (used when unwatching). */
export function clearDbCacheEntry(dbPath: string): void {
  const entry = dbCache.get(dbPath)
  if (entry?.db) { try { entry.db.close() } catch { /* ignore */ } }
  dbCache.delete(dbPath)
}
