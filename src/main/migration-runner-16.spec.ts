import { describe, it, expect, vi, beforeEach } from 'vitest'
import { migrateDb } from './migration'

function makeMockDb({
  userVersion = 0,
  colMap = {} as Record<string, string[]>,
}: {
  userVersion?: number
  colMap?: Record<string, string[]>
} = {}) {
  let currentVersion = userVersion

  const exec = vi.fn().mockImplementation((query: string) => {
    if (query.includes('PRAGMA user_version')) {
      return [{ columns: ['user_version'], values: [[currentVersion]] }]
    }
    if (query.includes("key = 'schema_version'")) return []
    const tiMatch = query.match(/PRAGMA table_info\((\w+)\)/)
    if (tiMatch) {
      const tableName = tiMatch[1]
      const cols = colMap[tableName]
      if (!cols || cols.length === 0) return []
      return [{ columns: ['cid', 'name', 'type', 'notnull', 'dflt_value', 'pk'], values: cols.map((n, i) => [i, n, 'TEXT', 0, null, 0]) }]
    }
    return []
  })

  const run = vi.fn().mockImplementation((sql: string) => {
    const m = sql.match(/PRAGMA user_version\s*=\s*(\d+)/)
    if (m) currentVersion = Number(m[1])
  })

  return { exec, run, _getVersion: () => currentVersion }
}

// ── v38: add sessions.model_used (T1923) ─────────────────────────────────────

describe('migrateDb v38 — add sessions.model_used column', () => {
  beforeEach(() => vi.clearAllMocks())

  it('adds model_used column when absent', () => {
    const db = makeMockDb({
      userVersion: 37,
      colMap: { sessions: ['id', 'agent_id', 'status', 'cli_type'] },
    })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.some(s => s.includes('ALTER TABLE sessions ADD COLUMN model_used TEXT'))).toBe(true)
  })

  it('is idempotent — does NOT re-add model_used when column already exists', () => {
    const db = makeMockDb({
      userVersion: 37,
      colMap: { sessions: ['id', 'agent_id', 'status', 'cli_type', 'model_used'] },
    })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.every(s => !s.includes('ADD COLUMN model_used'))).toBe(true)
  })

  it('is a no-op when sessions table does not exist (PRAGMA returns empty)', () => {
    const db = makeMockDb({ userVersion: 37, colMap: {} })
    expect(() => migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)).not.toThrow()
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.every(s => !s.includes('ADD COLUMN model_used'))).toBe(true)
  })

  it('updates user_version to 40 (v38 + v39 + v40 + v41)', () => {
    const db = makeMockDb({ userVersion: 37, colMap: { sessions: ['id', 'status'] } })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    expect(db._getVersion()).toBe(41)
  })

  it('applies v38, v39, and v40 when starting from v37', () => {
    const db = makeMockDb({ userVersion: 37, colMap: { sessions: ['id', 'status'] } })
    const applied = migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    expect(applied).toBe(3)
  })
})
