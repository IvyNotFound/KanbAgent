import { describe, it, expect, vi, beforeEach } from 'vitest'
import { migrateDb } from './migration'

// ── Helpers ───────────────────────────────────────────────────────────────────

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
      const cols = colMap[tiMatch[1]]
      if (!cols || cols.length === 0) return []
      return [{ columns: ['cid', 'name', 'type', 'notnull', 'dflt_value', 'pk'], values: cols.map((n, i) => [i, n, 'TEXT', 0, null, 0]) }]
    }
    if (query.includes('sqlite_master')) return []
    return []
  })

  const run = vi.fn().mockImplementation((sql: string) => {
    const m = sql.match(/PRAGMA user_version\s*=\s*(\d+)/)
    if (m) currentVersion = Number(m[1])
  })

  return { exec, run, _getVersion: () => currentVersion }
}

// ── v32: repair sessions columns on DBs bootstrapped before T1393 ─────────────

describe('migrateDb v32 — repair sessions.cost_usd/duration_ms/num_turns on legacy DBs', () => {
  beforeEach(() => vi.clearAllMocks())

  it('adds cost_usd, duration_ms, num_turns when DB is at user_version=31 and columns are absent', () => {
    // Simulates a DB incorrectly bootstrapped before T1393: user_version=31
    // but sessions table lacks cost_usd/duration_ms/num_turns (v20 was skipped).
    const db = makeMockDb({
      userVersion: 31,
      colMap: { sessions: ['id', 'status', 'cli_type'] },
    })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: unknown[]) => c[0] as string)
    expect(calls.some(s => s.includes('ADD COLUMN cost_usd'))).toBe(true)
    expect(calls.some(s => s.includes('ADD COLUMN duration_ms'))).toBe(true)
    expect(calls.some(s => s.includes('ADD COLUMN num_turns'))).toBe(true)
    expect(db._getVersion()).toBe(32)
  })

  it('is idempotent — does NOT re-add cost_usd/duration_ms/num_turns when columns already exist', () => {
    const db = makeMockDb({
      userVersion: 31,
      colMap: { sessions: ['id', 'status', 'cost_usd', 'duration_ms', 'num_turns', 'cli_type'] },
    })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: unknown[]) => c[0] as string)
    expect(calls.every(s => !s.includes('ADD COLUMN cost_usd'))).toBe(true)
    expect(calls.every(s => !s.includes('ADD COLUMN duration_ms'))).toBe(true)
    expect(calls.every(s => !s.includes('ADD COLUMN num_turns'))).toBe(true)
    expect(db._getVersion()).toBe(32)
  })

  it('returns early without error when sessions PRAGMA table_info returns empty (table missing)', () => {
    const db = makeMockDb({
      userVersion: 31,
      colMap: {},  // sessions absent → PRAGMA returns []
    })
    expect(() => migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)).not.toThrow()
    const calls = db.run.mock.calls.map((c: unknown[]) => c[0] as string)
    expect(calls.every(s => !s.includes('ADD COLUMN cost_usd'))).toBe(true)
  })

  it('adds only the missing columns when some are already present (partial repair)', () => {
    // cost_usd already exists but duration_ms and num_turns are absent
    const db = makeMockDb({
      userVersion: 31,
      colMap: { sessions: ['id', 'status', 'cost_usd', 'cli_type'] },
    })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: unknown[]) => c[0] as string)
    expect(calls.every(s => !s.includes('ADD COLUMN cost_usd'))).toBe(true)
    expect(calls.some(s => s.includes('ADD COLUMN duration_ms'))).toBe(true)
    expect(calls.some(s => s.includes('ADD COLUMN num_turns'))).toBe(true)
  })
})
