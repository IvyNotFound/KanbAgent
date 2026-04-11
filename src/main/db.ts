/**
 * Database infrastructure for KanbAgent
 *
 * Provides better-sqlite3 (native) connection pool, read/write helpers
 * with concurrency protection, and security registries for allowed paths.
 *
 * Replaces the sql.js (WASM) implementation — T1157.
 *
 * @module db
 */

import { copyFile, unlink } from 'fs/promises'
import { homedir } from 'os'
import { resolve, sep } from 'path'
import Database from 'better-sqlite3'
import { migrateDb as applyMigrations, CURRENT_SCHEMA_VERSION } from './migration'
import { acquireWriteLock, releaseWriteLock } from './db-lock'
import type { MigrationDb } from './migration-db-adapter'
import { createMigrationAdapter } from './migration-db-adapter'

// Re-export MigrationDb for consumers that type writeDb callbacks
export type { MigrationDb } from './migration-db-adapter'

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

/** Returns the list of currently registered project paths (for persistence). */
export function getAllowedProjectPaths(): string[] {
  return [...allowedProjectPaths]
}

/** Returns true if projectPath is currently in the in-memory allow-list. */
export function isProjectPathAllowed(projectPath: string): boolean {
  return !!projectPath && allowedProjectPaths.has(resolve(projectPath))
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

// ── T1871: Transcript path validation ────────────────────────────────────────

/**
 * Throws if transcriptPath is not within cwd or the user's ~/.claude/ directory.
 * Prevents arbitrary file reads via crafted transcript_path in hook payloads.
 * @throws {Error} TRANSCRIPT_PATH_NOT_ALLOWED
 */
export function assertTranscriptPathAllowed(transcriptPath: string, cwd: string): void {
  const resolved = resolve(transcriptPath)
  const resolvedCwd = resolve(cwd)
  const claudeDir = resolve(homedir(), '.claude')

  if (
    !resolved.startsWith(resolvedCwd + sep) &&
    !resolved.startsWith(claudeDir + sep)
  ) {
    throw new Error('TRANSCRIPT_PATH_NOT_ALLOWED: ' + transcriptPath)
  }
}

// ── Connection pool ──────────────────────────────────────────────────────────
const dbPool = new Map<string, Database.Database>()

/**
 * Get or create a better-sqlite3 connection for the given path.
 * Enables WAL mode, busy_timeout, and foreign keys on first open.
 */
function getDb(dbPath: string): Database.Database {
  let db = dbPool.get(dbPath)
  if (db) return db
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('busy_timeout = 5000')
  db.pragma('foreign_keys = ON')
  dbPool.set(dbPath, db)
  return db
}

/** Close and remove a connection from the pool. */
export function clearDbCacheEntry(dbPath: string): void {
  const db = dbPool.get(dbPath)
  if (db) {
    try { db.close() } catch { /* already closed */ }
    dbPool.delete(dbPath)
  }
}

// ── T313: Per-path write mutex ───────────────────────────────────────────────
const writeMutex = new Map<string, Promise<unknown>>()

/**
 * Shared write helper — opens a connection, runs mutation via MigrationDb adapter.
 * Uses per-path mutex and cross-process advisory lock for concurrency safety.
 *
 * better-sqlite3 writes directly to the file — no export/import cycle needed.
 *
 * @param dbPath - Absolute path to the SQLite database file
 * @param fn - Callback receiving a MigrationDb adapter to run mutations on
 * @returns The value returned by the callback
 * @throws If the mutation fails
 */
export async function writeDb<T = void>(dbPath: string, fn: (db: MigrationDb) => T): Promise<T> {
  return writeDbNative(dbPath, (db) => fn(createMigrationAdapter(db)))
}

/**
 * Native write helper — opens a connection, runs mutation via raw better-sqlite3 Database.
 * Uses per-path mutex and cross-process advisory lock for concurrency safety.
 *
 * Use this for code that uses the native better-sqlite3 API directly (stmt.get/run/all).
 *
 * @param dbPath - Absolute path to the SQLite database file
 * @param fn - Callback receiving a native better-sqlite3 Database instance
 * @returns The value returned by the callback
 * @throws If the mutation fails
 */
export async function writeDbNative<T = void>(dbPath: string, fn: (db: Database.Database) => T): Promise<T> {
  const prev = writeMutex.get(dbPath) ?? Promise.resolve()
  let release: () => void
  const gate = new Promise<void>((r) => { release = r })
  writeMutex.set(dbPath, gate)

  try {
    await prev
    const lockPath = await acquireWriteLock(dbPath)
    try {
      const db = getDb(dbPath)
      const result = fn(db)
      return result
    } finally {
      await releaseWriteLock(lockPath)
    }
  } finally {
    release!()
    if (writeMutex.get(dbPath) === gate) writeMutex.delete(dbPath)
  }
}

// ── queryLive ────────────────────────────────────────────────────────────────

/**
 * Execute a read-only SQL query using a pooled better-sqlite3 connection.
 * Returns rows as plain JS objects (strings, not Uint8Array).
 *
 * @param dbPath - Path to the SQLite database
 * @param query - SQL query string
 * @param params - Bind parameters
 * @returns Query result rows as objects
 */
export async function queryLive(dbPath: string, query: string, params: unknown[]): Promise<unknown[]> {
  const db = getDb(dbPath)
  try {
    const stmt = db.prepare(query)
    return params.length > 0 ? stmt.all(...params) : stmt.all()
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'SQLITE_CORRUPT') {
      clearDbCacheEntry(dbPath)
      const wrapped = new Error('DB_CORRUPT: ' + dbPath)
      ;(wrapped as Error & { code: string }).code = 'SQLITE_CORRUPT'
      throw wrapped
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
 * @returns Number of migrations applied
 * @throws If migration fails (backup is kept)
 */
export async function migrateDb(dbPath: string): Promise<{ migrated: number }> {
  // Fast-path: check user_version before full migration
  try {
    const db = getDb(dbPath)
    const row = db.pragma('user_version', { simple: true })
    const currentVersion = typeof row === 'number' ? row : 0
    if (currentVersion >= CURRENT_SCHEMA_VERSION) return { migrated: 0 }
  } catch { /* DB unreadable — proceed to full migration */ }

  // Migration needed — acquire cross-process lock before backup + write
  const lockPath = await acquireWriteLock(dbPath)
  try {
    const backupPath = `${dbPath}.bak`
    await copyFile(dbPath, backupPath)

    // Close pooled connection before migration (will reopen after)
    clearDbCacheEntry(dbPath)

    const db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
    db.pragma('busy_timeout = 5000')
    db.pragma('foreign_keys = OFF')

    try {
      const adapter = createMigrationAdapter(db)
      const migrated = applyMigrations(adapter)

      if (migrated > 0) {
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
  } finally {
    await releaseWriteLock(lockPath)
  }
}

// ── SQL write guard ──────────────────────────────────────────────────────────

export const FORBIDDEN_WRITE_PATTERN = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|REPLACE|ATTACH|DETACH|VACUUM)\b/i
