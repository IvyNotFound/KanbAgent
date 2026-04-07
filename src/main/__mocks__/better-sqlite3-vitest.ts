/**
 * WASM-based stub for better-sqlite3 used during Vitest tests.
 *
 * Wraps node-sqlite3-wasm to expose the better-sqlite3 synchronous API so
 * that src/main/ tests run under Node (Vitest) without requiring the native
 * binary compiled for Electron (MODULE_VERSION mismatch — T1523).
 *
 * Covered API surface:
 *   - Database: constructor, exec(), prepare(), pragma(), close()
 *   - Statement: get(), all(), run(), columns(), reader, finalize()
 */

const { Database: WasmDatabase } = require('node-sqlite3-wasm') as {
  Database: new (path?: string) => WasmDb
}

/** Minimal typings for the node-sqlite3-wasm internals we rely on. */
interface WasmDb {
  exec(sql: string): void
  prepare(sql: string): WasmStmt
  run(sql: string, values?: BindValues): RunResult
  close(): void
}

interface RunResult {
  changes: number
  lastInsertRowid: number | bigint
}

type SQLiteScalar = number | bigint | string | Uint8Array | null | boolean
type BindValues = SQLiteScalar | SQLiteScalar[] | Record<string, SQLiteScalar>

interface WasmStmt {
  get(values?: BindValues): Record<string, SQLiteScalar> | null
  all(values?: BindValues): Record<string, SQLiteScalar>[]
  run(values?: BindValues): RunResult
  finalize(): void
  /** Internal — not in public types but always present in node-sqlite3-wasm. */
  _getColumnNames(): string[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Detect multi-statement SQL (two or more non-empty statements separated by `;`).
 * better-sqlite3 throws when prepare() is called with multi-statement SQL.
 */
function isMultiStatement(sql: string): boolean {
  const parts = sql.split(';').map((s) => s.trim()).filter((s) => s.length > 0)
  return parts.length > 1
}

/** Detect whether a SQL statement returns rows (SELECT / PRAGMA / WITH / VALUES). */
function isReader(sql: string): boolean {
  const t = sql.trimStart().substring(0, 10).toUpperCase()
  return (
    t.startsWith('SELECT') ||
    t.startsWith('WITH') ||
    t.startsWith('VALUES') ||
    t.startsWith('PRAGMA')
  )
}

/** Normalise spread-or-array params to BindValues expected by node-sqlite3-wasm. */
function toBindValues(params: unknown[]): BindValues | undefined {
  if (params.length === 0) return undefined
  if (params.length === 1 && Array.isArray(params[0])) return params[0] as BindValues
  if (params.length === 1 && typeof params[0] === 'object' && params[0] !== null && !Array.isArray(params[0])) {
    return params[0] as BindValues
  }
  return params as BindValues
}

// ── WrappedStatement ──────────────────────────────────────────────────────────

class WrappedStatement {
  private _stmt: WasmStmt
  readonly reader: boolean

  constructor(stmt: WasmStmt, sql: string) {
    this._stmt = stmt
    this.reader = isReader(sql)
  }

  /** Returns column metadata — compatible with better-sqlite3 ColumnDefinition. */
  columns(): { name: string }[] {
    return this._stmt._getColumnNames().map((name) => ({ name }))
  }

  get(...params: unknown[]): Record<string, unknown> | undefined {
    return this._stmt.get(toBindValues(params)) ?? undefined
  }

  all(...params: unknown[]): Record<string, unknown>[] {
    return this._stmt.all(toBindValues(params))
  }

  run(...params: unknown[]): { changes: number; lastInsertRowid: number } {
    const r = this._stmt.run(toBindValues(params))
    return { changes: r.changes, lastInsertRowid: Number(r.lastInsertRowid) }
  }

  /** better-sqlite3 relies on GC — explicit finalize is optional but harmless. */
  finalize(): void {
    try { this._stmt.finalize() } catch { /* ignore double-finalize */ }
  }
}

// ── BetterSqlite3Compat ───────────────────────────────────────────────────────

class BetterSqlite3Compat {
  private _db: WasmDb

  constructor(path: string, _options?: Record<string, unknown>) {
    // node-sqlite3-wasm uses `undefined` for in-memory databases
    this._db = new WasmDatabase(path === ':memory:' ? undefined : path)
  }

  /**
   * Execute `PRAGMA <pragmaExpr>`.
   *
   * @param pragmaExpr  e.g. `'journal_mode = WAL'` or `'user_version'`
   * @param opts        `{ simple: true }` → return the scalar value directly
   */
  pragma(pragmaExpr: string, opts?: { simple?: boolean }): unknown {
    const stmt = this._db.prepare(`PRAGMA ${pragmaExpr}`)
    const rows = stmt.all()
    stmt.finalize()
    if (opts?.simple) {
      const first = rows[0]
      return first ? Object.values(first)[0] : undefined
    }
    return rows
  }

  prepare(sql: string): WrappedStatement {
    if (isMultiStatement(sql)) {
      throw new RangeError(
        'SQL contains multiple statements — use db.exec() for multi-statement SQL',
      )
    }
    return new WrappedStatement(this._db.prepare(sql), sql)
  }

  exec(sql: string): this {
    this._db.exec(sql)
    return this
  }

  close(): void {
    this._db.close()
  }
}

export default BetterSqlite3Compat
