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

// ── v39: add idx_tasks_scope ON tasks(scope) (T1967) ─────────────────────────

describe('migrateDb v39 — add idx_tasks_scope index', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates idx_tasks_scope index', () => {
    const db = makeMockDb({ userVersion: 38 })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.some(s => s.includes('CREATE INDEX IF NOT EXISTS idx_tasks_scope ON tasks(scope)'))).toBe(true)
  })

  it('updates user_version to 40', () => {
    const db = makeMockDb({ userVersion: 38 })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    expect(db._getVersion()).toBe(41)
  })

  it('applies v39 + v40 when starting from v38', () => {
    const db = makeMockDb({ userVersion: 38 })
    const applied = migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    expect(applied).toBe(2)
  })

  it('is a no-op for idx_tasks_scope when already at v39', () => {
    const db = makeMockDb({ userVersion: 39 })
    const applied = migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    expect(applied).toBe(1) // only v40 applied
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.every(s => !s.includes('idx_tasks_scope'))).toBe(true)
  })
})

// ── v40: add idx_agm_agent on agent_group_members(agent_id) (T1970) ──────────

describe('migrateDb v40 — idx_agm_agent on agent_group_members(agent_id)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates idx_agm_agent index when migrating from v39', () => {
    const db = makeMockDb({ userVersion: 39 })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.some(s => s.includes('idx_agm_agent') && s.includes('agent_group_members(agent_id)'))).toBe(true)
  })

  it('uses CREATE INDEX IF NOT EXISTS (idempotent)', () => {
    const db = makeMockDb({ userVersion: 39 })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    const indexCall = calls.find(s => s.includes('idx_agm_agent'))
    expect(indexCall).toMatch(/CREATE INDEX IF NOT EXISTS/)
  })

  it('updates user_version to 40', () => {
    const db = makeMockDb({ userVersion: 39 })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    expect(db._getVersion()).toBe(41)
  })

  it('applies only v40 when starting from v39', () => {
    const db = makeMockDb({ userVersion: 39 })
    const applied = migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    expect(applied).toBe(1)
  })

  it('is a no-op when already at v40', () => {
    const db = makeMockDb({ userVersion: 40 })
    const applied = migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    expect(applied).toBe(0)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.every(s => !s.includes('idx_agm_agent'))).toBe(true)
  })
})
