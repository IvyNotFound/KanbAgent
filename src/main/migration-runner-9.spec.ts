import { describe, it, expect, vi, beforeEach } from 'vitest'
import { migrateDb, CURRENT_SCHEMA_VERSION } from './migration'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeMockDb({
  userVersion = 0,
  colMap = {} as Record<string, string[]>,
  tableSchemas = {} as Record<string, string>,
  tables = [] as string[],
}: {
  userVersion?: number
  colMap?: Record<string, string[]>
  tableSchemas?: Record<string, string>
  tables?: string[]
} = {}) {
  let currentVersion = userVersion

  const exec = vi.fn().mockImplementation((query: string) => {
    if (query.includes('PRAGMA user_version')) {
      return [{ columns: ['user_version'], values: [[currentVersion]] }]
    }
    if (query.includes("key = 'schema_version'")) return []
    const tiMatch = query.match(/PRAGMA table_info\((\w+)\)/)
    if (tiMatch) {
      const cols = colMap[tiMatch[1]]
      if (!cols || cols.length === 0) return []
      return [{ columns: ['cid', 'name', 'type', 'notnull', 'dflt_value', 'pk'], values: cols.map((n, i) => [i, n, 'TEXT', 0, null, 0]) }]
    }
    // sqlite_master queries for table schema (SELECT sql ...)
    if (query.includes('sqlite_master') && query.includes('SELECT sql')) {
      const nameMatch = query.match(/name='(\w+)'/)
      if (nameMatch) {
        const schema = tableSchemas[nameMatch[1]]
        if (schema) return [{ columns: ['sql'], values: [[schema]] }]
      }
      return []
    }
    // sqlite_master queries for table existence (SELECT name/COUNT ...)
    if (query.includes('sqlite_master') && query.includes("type='table'")) {
      const nameMatch = query.match(/name='(\w+)'/)
      if (nameMatch && tables.includes(nameMatch[1])) {
        return [{ columns: ['name'], values: [[nameMatch[1]]] }]
      }
      return []
    }
    return []
  })

  const run = vi.fn().mockImplementation((sql: string) => {
    const m = sql.match(/PRAGMA user_version\s*=\s*(\d+)/)
    if (m) currentVersion = Number(m[1])
  })

  return { exec, run, _getVersion: () => currentVersion }
}

// ── v35: add 'rejected' terminal status ──────────────────────────────────────

describe('migrateDb v35 — add rejected status to tasks CHECK constraint', () => {
  beforeEach(() => vi.clearAllMocks())

  it('CURRENT_SCHEMA_VERSION is 39', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(41)
  })

  it('recreates tasks table with rejected in CHECK when starting from v34', () => {
    const db = makeMockDb({
      userVersion: 34,
      tableSchemas: {
        tasks: "CREATE TABLE tasks (status TEXT CHECK(status IN ('todo','in_progress','done','archived')))",
      },
      tables: ['tasks_fts'],
    })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)

    const calls = db.run.mock.calls.map((c: unknown[]) => c[0] as string)

    // Should drop FTS triggers
    expect(calls.some(s => s.includes('DROP TRIGGER IF EXISTS tasks_fts_ai'))).toBe(true)
    expect(calls.some(s => s.includes('DROP TRIGGER IF EXISTS tasks_fts_au'))).toBe(true)
    expect(calls.some(s => s.includes('DROP TRIGGER IF EXISTS tasks_fts_ad'))).toBe(true)

    // Should use legacy_alter_table
    expect(calls.some(s => s.includes('PRAGMA legacy_alter_table = ON'))).toBe(true)
    expect(calls.some(s => s.includes('PRAGMA legacy_alter_table = OFF'))).toBe(true)

    // Should rename to temp table
    expect(calls.some(s => s.includes('RENAME TO tasks_rejected_old'))).toBe(true)

    // Should create table with 'rejected' in CHECK
    expect(calls.some(s => s.includes("'rejected'") && s.includes('CREATE TABLE tasks'))).toBe(true)

    // Should copy data from old table
    expect(calls.some(s => s.includes('INSERT INTO tasks SELECT') && s.includes('tasks_rejected_old'))).toBe(true)

    // Should drop old table
    expect(calls.some(s => s.includes('DROP TABLE tasks_rejected_old'))).toBe(true)

    // Should recreate FTS triggers (tasks_fts exists)
    expect(calls.some(s => s.includes('CREATE TRIGGER tasks_fts_ai'))).toBe(true)
    expect(calls.some(s => s.includes('CREATE TRIGGER tasks_fts_au'))).toBe(true)
    expect(calls.some(s => s.includes('CREATE TRIGGER tasks_fts_ad'))).toBe(true)

    // Should recreate all indexes
    expect(calls.some(s => s.includes('idx_tasks_updated_at'))).toBe(true)
    expect(calls.some(s => s.includes('idx_tasks_agent_assigne'))).toBe(true)
    expect(calls.some(s => s.includes('idx_tasks_status'))).toBe(true)
    expect(calls.some(s => s.includes('idx_tasks_agent_status'))).toBe(true)

    expect(db._getVersion()).toBe(41)
  })

  it('is idempotent — skips when CHECK already contains rejected', () => {
    const db = makeMockDb({
      userVersion: 34,
      tableSchemas: {
        tasks: "CREATE TABLE tasks (status TEXT CHECK(status IN ('todo','in_progress','done','archived','rejected')))",
      },
    })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)

    const calls = db.run.mock.calls.map((c: unknown[]) => c[0] as string)

    // Should NOT recreate the table
    expect(calls.every(s => !s.includes('RENAME TO tasks_rejected_old'))).toBe(true)
    expect(calls.every(s => !s.includes('CREATE TABLE tasks'))).toBe(true)

    expect(db._getVersion()).toBe(41)
  })

  it('skips FTS trigger recreation when tasks_fts does not exist', () => {
    const db = makeMockDb({
      userVersion: 34,
      tableSchemas: {
        tasks: "CREATE TABLE tasks (status TEXT CHECK(status IN ('todo','in_progress','done','archived')))",
      },
      tables: [], // no tasks_fts
    })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)

    const calls = db.run.mock.calls.map((c: unknown[]) => c[0] as string)

    // Should still drop triggers (IF EXISTS — safe)
    expect(calls.some(s => s.includes('DROP TRIGGER IF EXISTS tasks_fts_ai'))).toBe(true)

    // Should NOT recreate FTS triggers
    expect(calls.every(s => !s.includes('CREATE TRIGGER tasks_fts_ai'))).toBe(true)

    expect(db._getVersion()).toBe(41)
  })

  it('returns false (no-op) when tasks table does not exist', () => {
    const db = makeMockDb({
      userVersion: 34,
      tableSchemas: {}, // no tasks schema
    })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)

    const calls = db.run.mock.calls.map((c: unknown[]) => c[0] as string)
    expect(calls.every(s => !s.includes('RENAME TO tasks_rejected_old'))).toBe(true)
    expect(db._getVersion()).toBe(41)
  })
})
