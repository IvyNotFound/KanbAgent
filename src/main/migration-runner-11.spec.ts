import { describe, it, expect, vi, beforeEach } from 'vitest'
import { migrateDb, CURRENT_SCHEMA_VERSION } from './migration'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeMockDb({
  userVersion = 0,
  hasConfigTable = false,
  configResultOverride = undefined as undefined | ReturnType<typeof vi.fn>,
  colMap = {} as Record<string, string[]>,
  tableMap = {} as Record<string, boolean>,
  tableRowCounts = {} as Record<string, number>,  // for COUNT(*) exact values
  taskLinksSql = '',
  uvResultOverride = undefined as undefined | unknown[],
}: {
  userVersion?: number
  hasConfigTable?: boolean
  configResultOverride?: ReturnType<typeof vi.fn>
  colMap?: Record<string, string[]>
  tableMap?: Record<string, boolean>
  tableRowCounts?: Record<string, number>
  taskLinksSql?: string
  uvResultOverride?: unknown[]
} = {}) {
  let currentVersion = userVersion

  const exec = vi.fn().mockImplementation((query: string) => {
    if (query.includes('PRAGMA user_version')) {
      if (uvResultOverride !== undefined) return uvResultOverride
      return [{ columns: ['user_version'], values: [[currentVersion]] }]
    }
    if (query.includes("key = 'schema_version'")) {
      if (configResultOverride !== undefined) return configResultOverride(query)
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
        const tableName = nameMatch[1]
        const count = tableRowCounts[tableName] ?? (tableMap[tableName] ? 1 : 0)
        return [{ columns: ['COUNT(*)'], values: [[count]] }]
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

// ── v3 guard (L34): r.length > 0 && r[0].values.length > 0 ───────────────────
// Mutation: r.length >= 0 (always true) OR removing r[0].values.length > 0 check

describe('migrateDb — uvResult empty (PRAGMA user_version returns no rows)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('defaults to user_version=0 and runs all migrations when uvResult is []', () => {
    const db = makeMockDb({
      userVersion: 0,
      hasConfigTable: false,
      uvResultOverride: [],
    })
    const result = migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    expect(result).toBe(CURRENT_SCHEMA_VERSION)
  })

  it('defaults to user_version=0 and runs all migrations when uvResult has no values', () => {
    const db = makeMockDb({
      userVersion: 0,
      hasConfigTable: false,
      uvResultOverride: [{ columns: ['user_version'], values: [] }],
    })
    const result = migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    expect(result).toBe(CURRENT_SCHEMA_VERSION)
  })
})

// ── colResult.length > 0 boundary in bootstrap path ──────────────────────────
// Kills ConditionalExpression mutation on line 364: colResult.length > 0

describe('migrateDb — bootstrap path: colResult empty (agents table missing)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('does NOT bootstrap when colResult is [] (agents table not found)', () => {
    // User_version=0 + config table present + agents PRAGMA returns []
    // agentCols will be empty Set → permission_mode absent → no bootstrap
    const db = makeMockDb({
      userVersion: 0,
      hasConfigTable: true,
      colMap: {}, // no agents table at all
    })
    const result = migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    // No bootstrap: all migrations run
    expect(result).toBe(CURRENT_SCHEMA_VERSION)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    const firstUV = calls.find((s: string) => /PRAGMA user_version\s*=/.test(s))
    expect(firstUV).toBe('PRAGMA user_version = 1')
    expect(firstUV).not.toBe('PRAGMA user_version = 23')
  })
})

// ── pending = migrations.filter(m => m.version > current): strict > ───────────
// Kills EqualityOperator: version > current vs version >= current

describe('migrateDb — strict > (not >=) in pending filter', () => {
  beforeEach(() => vi.clearAllMocks())

  it('does NOT re-run any migration when already exactly at that version', () => {
    // At each version N: migration N must NOT be in pending list
    for (const v of [1, 5, 10, 15, 20, 25, 28, 29]) {
      const db = makeMockDb({ userVersion: v })
      migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
      const calls = db.run.mock.calls.map((c: string[]) => c[0])
      expect(calls.some((s: string) => s === `SAVEPOINT m${v}`), `v${v} must not re-run at userVersion=${v}`).toBe(false)
    }
  })

  it('runs next migration (N+1) but not migration N when at version N', () => {
    // At version 9 (before v10 priority): v10 must run, v9 must not
    const db = makeMockDb({ userVersion: 9 })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.some((s: string) => s === 'SAVEPOINT m9')).toBe(false)
    expect(calls.some((s: string) => s === 'SAVEPOINT m10')).toBe(true)
  })

  it('returns CURRENT_SCHEMA_VERSION - N migrations when starting at version N', () => {
    for (const [start, expected] of [[27, 13], [28, 12], [24, 16]]) {
      const db = makeMockDb({ userVersion: start, colMap: { agents: ['id', 'name'], sessions: ['id', 'status'] } })
      const result = migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
      expect(result).toBe(expected)
    }
  })
})

// ── v1 block statement: runDropCommentaireColumnMigration is called ───────────
// Kills BlockStatement mutation on line 18: { runDropCommentaireColumnMigration(db) }

describe('migrateDb v1 — runDropCommentaireColumnMigration called', () => {
  beforeEach(() => vi.clearAllMocks())

  it('runs PRAGMA table_info(tasks) as part of v1 migration (drops commentaire column)', () => {
    // runDropCommentaireColumnMigration internally calls PRAGMA table_info(tasks)
    const db = makeMockDb({ userVersion: 0, hasConfigTable: false })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const execCalls = db.exec.mock.calls.map((c: string[]) => c[0])
    // v1 runs runDropCommentaireColumnMigration which queries table_info(tasks)
    expect(execCalls.some((s: string) => s.includes('table_info(tasks)'))).toBe(true)
  })

  it('v1 uses SAVEPOINT m1 / RELEASE SAVEPOINT m1', () => {
    const db = makeMockDb({ userVersion: 0, hasConfigTable: false })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.some((s: string) => s === 'SAVEPOINT m1')).toBe(true)
    expect(calls.some((s: string) => s === 'RELEASE SAVEPOINT m1')).toBe(true)
  })

  it('v1 SAVEPOINT precedes v1 RELEASE (order matters)', () => {
    const db = makeMockDb({ userVersion: 0, hasConfigTable: false })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    const spIdx = calls.findIndex((s: string) => s === 'SAVEPOINT m1')
    const relIdx = calls.findIndex((s: string) => s === 'RELEASE SAVEPOINT m1')
    expect(spIdx).toBeGreaterThanOrEqual(0)
    expect(relIdx).toBeGreaterThan(spIdx)
  })
})

// ── SAVEPOINT/RELEASE block statements (lines 92-95) ─────────────────────────
// Kills BlockStatement mutations: success path must always RELEASE, error path must always ROLLBACK+RELEASE

describe('migrateDb — SAVEPOINT/RELEASE block statement coverage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('success path: RELEASE SAVEPOINT always follows successful migration.up()', () => {
    // Run a single migration (v28 only) and verify RELEASE happens after up()
    const db = makeMockDb({ userVersion: 28 })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    const spIdx = calls.findIndex((s: string) => s === 'SAVEPOINT m29')
    const relIdx = calls.findIndex((s: string) => s === 'RELEASE SAVEPOINT m29')
    // Both must exist
    expect(spIdx).toBeGreaterThanOrEqual(0)
    expect(relIdx).toBeGreaterThan(spIdx)
    // ROLLBACK must NOT exist in success path
    expect(calls.some((s: string) => s === 'ROLLBACK TO SAVEPOINT m29')).toBe(false)
  })

  it('PRAGMA user_version = N is set between SAVEPOINT and RELEASE on success', () => {
    const db = makeMockDb({ userVersion: 28 })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    const spIdx = calls.findIndex((s: string) => s === 'SAVEPOINT m29')
    const uvIdx = calls.findIndex((s: string) => s === 'PRAGMA user_version = 29')
    const relIdx = calls.findIndex((s: string) => s === 'RELEASE SAVEPOINT m29')
    expect(spIdx).toBeGreaterThanOrEqual(0)
    expect(uvIdx).toBeGreaterThan(spIdx)
    expect(relIdx).toBeGreaterThan(uvIdx)
  })

  it('error path: ROLLBACK then RELEASE happen even after throw (v27 index creation fails)', () => {
    // v27 calls db.run directly with index creation — inject failure there
    const db = makeMockDb({ userVersion: 26, colMap: { agents: ['id', 'name'] } })
    db.run.mockImplementation((sql: string) => {
      const m = sql.match(/PRAGMA user_version\s*=\s*(\d+)/)
      if (m) return
      if (/^SAVEPOINT|^ROLLBACK|^RELEASE/.test(sql)) return
      // Fail on v27's first index creation
      if (sql.includes('idx_tasks_status')) throw new Error('v27 index failure')
    })
    expect(() => migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)).toThrow('v27 index failure')
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    // Rollback must happen
    expect(calls.some((s: string) => s === 'ROLLBACK TO SAVEPOINT m27')).toBe(true)
    // Release must happen after rollback (cleanup)
    const rbIdx = calls.findIndex((s: string) => s === 'ROLLBACK TO SAVEPOINT m27')
    const relIdx = calls.lastIndexOf('RELEASE SAVEPOINT m27')
    expect(relIdx).toBeGreaterThan(rbIdx)
  })

  it('error path: user_version NOT updated when migration throws', () => {
    const db = makeMockDb({ userVersion: 28 })
    db.run.mockImplementation((sql: string) => {
      const m = sql.match(/PRAGMA user_version\s*=\s*(\d+)/)
      if (m) return
      if (sql.includes('SAVEPOINT') || sql.includes('ROLLBACK') || sql.includes('RELEASE')) return
      throw new Error('fail')
    })
    try { migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb) } catch { /* expected */ }
    // user_version stays at 28 (the PRAGMA user_version = 29 was never written)
    expect(db._getVersion()).toBe(28)
    expect(db._getVersion()).not.toBe(29)
  })
})

// ── StringLiteral mutations: SQL and log strings not replaced with empty ──────
// Kills StringLiteral mutations: verifying exact strings are not empty

describe('migrateDb — critical SQL strings not mutated to empty', () => {
  beforeEach(() => vi.clearAllMocks())

  it('v3: INSERT INTO config uses exact key values (not empty strings)', () => {
    const db = makeMockDb({ userVersion: 2, tableMap: { config: false }, colMap: { agents: ['id', 'system_prompt', 'system_prompt_suffix', 'thinking_mode', 'allowed_tools'] } })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    const insertConfig = calls.find((s: string) => s.includes('INSERT INTO config'))
    expect(insertConfig).toBeDefined()
    // Neither key nor value can be empty strings
    expect(insertConfig).not.toBe('')
    expect(insertConfig).toContain("'claude_md_commit'")
    expect(insertConfig).toContain("'schema_version'")
    expect(insertConfig).toContain("'2'")
  })

  it('SAVEPOINT name includes migration version (not empty string)', () => {
    const db = makeMockDb({ userVersion: 27, colMap: { agents: ['id', 'name'] } })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    // All SAVEPOINTs must include a version number
    const savepointCalls = calls.filter((s: string) => s.startsWith('SAVEPOINT '))
    expect(savepointCalls.every((s: string) => /SAVEPOINT m\d+/.test(s))).toBe(true)
  })

  it("bootstrap: LEGACY_BOOTSTRAP_VERSION is 23 (not 0 or 1)", () => {
    const db = makeMockDb({
      userVersion: 0,
      hasConfigTable: true,
      colMap: {
        agents: ['id', 'name', 'permission_mode', 'max_sessions'],
        sessions: ['id', 'status', 'cost_usd'],
      },
    })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    // Bootstrap sets user_version = 23 specifically
    expect(calls.some((s: string) => s === 'PRAGMA user_version = 23')).toBe(true)
    expect(calls.some((s: string) => s === 'PRAGMA user_version = 0')).toBe(false)
    expect(calls.some((s: string) => s === 'PRAGMA user_version = 1')).toBe(false)
  })

  it('v26: exact DROP TABLE/INDEX strings (not empty)', () => {
    const db = makeMockDb({ userVersion: 25 })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    const dropIndex = calls.find((s: string) => s.includes('idx_locks_released_at'))
    const dropTable = calls.find((s: string) => s.includes('DROP TABLE IF EXISTS locks'))
    expect(dropIndex).toBe('DROP INDEX IF EXISTS idx_locks_released_at')
    expect(dropTable).toBe('DROP TABLE IF EXISTS locks')
  })
})

// ── ArithmeticOperator: return pending.length (not 0 or length-1) ─────────────
// Kills ArithmeticOperator mutations on return value

describe('migrateDb — ArithmeticOperator: return value is pending.length', () => {
  beforeEach(() => vi.clearAllMocks())

  it('return value matches exactly the number of SAVEPOINT calls made', () => {
    // At version 27: v28, v29, v30, v31, v32, v33, v34, v35, v36, v37, v38, v39, v40, v41 run → 14 SAVEPOINTs → return 13
    const db = makeMockDb({ userVersion: 27, colMap: { agents: ['id', 'name'], sessions: ['id', 'status'] } })
    const result = migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    const savepointCount = calls.filter((s: string) => /^SAVEPOINT m\d+$/.test(s)).length
    // Return value must equal the number of savepoints (one per migration)
    expect(result).toBe(savepointCount)
    expect(result).toBe(14)
    expect(result).not.toBe(0)
    expect(result).not.toBe(12)
    expect(result).not.toBe(15)
  })

  it('return value is 8 (not 7 or 9) when eight migrations run (v34, v35, v36, v37, v38, v39, v40, v41)', () => {
    const db = makeMockDb({ userVersion: 33 })
    const result = migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    expect(result).toBe(8)
    expect(result).not.toBe(7)
    expect(result).not.toBe(9)
  })

  it('return value decreases by 1 per additional starting version', () => {
    const total = CURRENT_SCHEMA_VERSION // 33

    const dbV0 = makeMockDb({ userVersion: 0 })
    expect(migrateDb(dbV0 as unknown as import('./migration-db-adapter').MigrationDb)).toBe(total)

    const dbV1 = makeMockDb({ userVersion: 1 })
    expect(migrateDb(dbV1 as unknown as import('./migration-db-adapter').MigrationDb)).toBe(total - 1)

    const dbV2 = makeMockDb({ userVersion: 2, colMap: { agents: ['id', 'system_prompt', 'system_prompt_suffix', 'thinking_mode', 'allowed_tools'] } })
    expect(migrateDb(dbV2 as unknown as import('./migration-db-adapter').MigrationDb)).toBe(total - 2)
  })
})
