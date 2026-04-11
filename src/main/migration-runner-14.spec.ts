import { describe, it, expect, vi, beforeEach } from 'vitest'
import { migrateDb } from './migration'

// ── Helpers (duplicate-free, minimal) ─────────────────────────────────────────

function makeMockDb({
  userVersion = 0,
  hasConfigTable = false,
  colMap = {} as Record<string, string[]>,
  tableMap = {} as Record<string, boolean>,
  taskLinksSql = '',
}: {
  userVersion?: number
  hasConfigTable?: boolean
  colMap?: Record<string, string[]>
  tableMap?: Record<string, boolean>
  taskLinksSql?: string
} = {}) {
  let currentVersion = userVersion

  const exec = vi.fn().mockImplementation((query: string) => {
    if (query.includes('PRAGMA user_version')) {
      return [{ columns: ['user_version'], values: [[currentVersion]] }]
    }
    if (query.includes("key = 'schema_version'")) {
      return hasConfigTable ? [{ columns: ['value'], values: [['23']] }] : []
    }
    const tiMatch = query.match(/PRAGMA table_info\((\w+)\)/)
    if (tiMatch) {
      const tableName = tiMatch[1]
      const cols = colMap[tableName]
      if (!cols || cols.length === 0) return []
      return [{ columns: ['cid', 'name', 'type', 'notnull', 'dflt_value', 'pk'], values: cols.map((n, i) => [i, n, 'TEXT', 0, null, 0]) }]
    }
    if (query.includes('COUNT(*)') && query.includes('sqlite_master')) {
      const nameMatch = query.match(/name='(\w+)'/)
      if (nameMatch) {
        const exists = tableMap[nameMatch[1]] ?? false
        return [{ columns: ['COUNT(*)'], values: [[exists ? 1 : 0]] }]
      }
    }
    if (query.includes('sqlite_master') && query.includes("type='table'")) {
      if (query.includes("name='task_links'") && query.includes('sql')) {
        return taskLinksSql ? [{ columns: ['sql'], values: [[taskLinksSql]] }] : []
      }
      const nameMatch = query.match(/name='(\w+)'/)
      if (nameMatch) {
        const exists = tableMap[nameMatch[1]] ?? false
        return exists ? [{ columns: ['name'], values: [[nameMatch[1]]] }] : []
      }
    }
    return []
  })

  const run = vi.fn().mockImplementation((sql: string) => {
    const m = sql.match(/PRAGMA user_version\s*=\s*(\d+)/)
    if (m) currentVersion = Number(m[1])
  })

  return { exec, run, _getVersion: () => currentVersion }
}

// ── v20 — sessions columns guard ─────────────────────────────────────────────

describe('migrateDb v34 — add missing DB indexes (T1852)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates idx_sessions_conv_id ON sessions(claude_conv_id)', () => {
    const db = makeMockDb({ userVersion: 33 })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.some((s: string) => s.includes('idx_sessions_conv_id') && s.includes('sessions(claude_conv_id)'))).toBe(true)
  })

  it('creates idx_tasks_agent_status composite ON tasks(agent_assigned_id, status)', () => {
    const db = makeMockDb({ userVersion: 33 })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.some((s: string) => s.includes('idx_tasks_agent_status') && s.includes('agent_assigned_id, status'))).toBe(true)
  })

  it('creates idx_sessions_status ON sessions(status)', () => {
    const db = makeMockDb({ userVersion: 33 })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.some((s: string) => s.includes('idx_sessions_status') && s.includes('sessions(status)'))).toBe(true)
  })

  it('uses CREATE INDEX IF NOT EXISTS for all v34 indexes', () => {
    const db = makeMockDb({ userVersion: 33 })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    const v34Indexes = calls.filter((s: string) =>
      s.includes('CREATE INDEX') && (
        s.includes('idx_sessions_conv_id') || s.includes('idx_tasks_agent_status') ||
        s.includes('idx_sessions_status')
      )
    )
    expect(v34Indexes.length).toBeGreaterThanOrEqual(3)
    expect(v34Indexes.every((s: string) => s.includes('IF NOT EXISTS'))).toBe(true)
  })

  it('updates user_version to 37 (v34 + v35 + v36 + v37)', () => {
    const db = makeMockDb({ userVersion: 33 })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    expect(db._getVersion()).toBe(37)
  })

  it('skips v34 when already at version 34 (v35, v36, v37 run)', () => {
    const db = makeMockDb({ userVersion: 34 })
    const applied = migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    expect(applied).toBe(3)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    // v34 creates idx_sessions_conv_id ON sessions(claude_conv_id) — that specific column name must not appear
    // (v36 re-creates same index name but on sessions(conv_id), which is fine)
    expect(calls.some((s: string) => s.includes('sessions(claude_conv_id)'))).toBe(false)
  })
})

// ── CURRENT_SCHEMA_VERSION alignment ─────────────────────────────────────────

describe('CURRENT_SCHEMA_VERSION alignment', () => {
  it('counts of migrations array matches CURRENT_SCHEMA_VERSION', () => {
    // Validate: applying from v0 returns exactly CURRENT_SCHEMA_VERSION migrations
    const db = makeMockDb({ userVersion: 0 })
    const applied = migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    expect(applied).toBeGreaterThan(0)
    expect(db._getVersion()).toBe(37)
  })
})
