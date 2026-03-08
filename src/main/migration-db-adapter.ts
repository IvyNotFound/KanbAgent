/**
 * MigrationDb adapter — wraps better-sqlite3 with a sql.js-compatible interface.
 *
 * Provides run(), exec(), prepare(), getRowsModified(), and close() methods
 * matching the sql.js Database API, so migration functions and writeDb callbacks
 * work unchanged after the sql.js → better-sqlite3 migration (T1157).
 *
 * @module migration-db-adapter
 */

import type Database from 'better-sqlite3'

/** sql.js-compatible result format: { columns, values } */
export interface ExecResult {
  columns: string[]
  values: unknown[][]
}

/** sql.js-compatible prepared statement interface */
export interface MigrationStmt {
  bind(params: unknown[]): MigrationStmt
  step(): boolean
  getAsObject(): Record<string, unknown>
  free(): void
  run(params?: unknown[]): void
}

/** sql.js-compatible Database interface used by migrations and writeDb callbacks */
export interface MigrationDb {
  run(sql: string, params?: unknown[]): void
  exec(sql: string): ExecResult[]
  prepare(sql: string): MigrationStmt
  getRowsModified(): number
  close(): void
}

/**
 * Create a MigrationDb adapter wrapping a better-sqlite3 Database instance.
 */
export function createMigrationAdapter(db: Database.Database): MigrationDb {
  let lastChanges = 0

  return {
    /**
     * Execute SQL (DDL/DML). Supports multi-statement SQL when no params are given.
     * Tracks change count for getRowsModified().
     */
    run(sql: string, params?: unknown[]): void {
      if (params && params.length > 0) {
        const info = db.prepare(sql).run(...params)
        lastChanges = info.changes
      } else {
        // Multi-statement SQL or single statement without params.
        // Try single-statement first (tracks changes), fall back to exec for multi-statement.
        try {
          const stmt = db.prepare(sql)
          if (stmt.reader) {
            // SELECT-like statement called via run() — just execute it
            stmt.all()
            lastChanges = 0
          } else {
            const info = stmt.run()
            lastChanges = info.changes
          }
        } catch {
          // Multi-statement SQL — db.prepare() only handles single statements
          db.exec(sql)
          lastChanges = 0
        }
      }
    },

    /**
     * Execute a single SELECT statement and return results in sql.js format.
     * Returns [] for empty result sets or non-SELECT statements.
     */
    exec(sql: string): ExecResult[] {
      try {
        const stmt = db.prepare(sql)
        if (!stmt.reader) {
          // Non-SELECT statement — execute and return empty
          stmt.run()
          return []
        }
        const columns = stmt.columns().map(c => c.name)
        const rawRows = stmt.all() as Record<string, unknown>[]
        if (rawRows.length === 0) return []
        const values = rawRows.map(row => columns.map(col => row[col]))
        return [{ columns, values }]
      } catch {
        // If prepare fails (shouldn't happen for valid SQL), try exec
        db.exec(sql)
        return []
      }
    },

    /**
     * Prepare a single statement. Returns a sql.js-compatible statement object
     * with bind/step/getAsObject/free/run methods.
     */
    prepare(sql: string): MigrationStmt {
      const bsStmt = db.prepare(sql)
      let bound: unknown[] = []
      let rows: Record<string, unknown>[] = []
      let rowIndex = -1
      let fetched = false

      return {
        bind(params: unknown[]): MigrationStmt {
          bound = params
          rows = []
          rowIndex = -1
          fetched = false
          return this
        },
        step(): boolean {
          if (!fetched) {
            rows = bsStmt.reader
              ? (bsStmt.all(...bound) as Record<string, unknown>[])
              : []
            fetched = true
            rowIndex = -1
          }
          rowIndex++
          return rowIndex < rows.length
        },
        getAsObject(): Record<string, unknown> {
          return rows[rowIndex] ?? {}
        },
        free(): void {
          // Reset iteration state — GC handles better-sqlite3 cleanup
          rows = []
          rowIndex = -1
          fetched = false
        },
        run(params?: unknown[]): void {
          const info = bsStmt.run(...(params ?? bound))
          lastChanges = info.changes
        },
      }
    },

    getRowsModified(): number {
      return lastChanges
    },

    close(): void {
      // Pool manages lifecycle — no-op in writeDb context
      // In migrateDb context, caller closes directly
    },
  }
}
