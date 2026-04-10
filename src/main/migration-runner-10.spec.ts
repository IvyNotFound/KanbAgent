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

describe('migrateDb — bootstrap rawCurrent === 0 is strict equality', () => {
  beforeEach(() => vi.clearAllMocks())

  it('does NOT bootstrap (cursor stays at rawCurrent) when rawCurrent is 1', () => {
    const db = makeMockDb({ userVersion: 1, hasConfigTable: true })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    // Bootstrap sets PRAGMA user_version = 23; if not bootstrapped, first PRAGMA = 2
    const firstUVCall = calls.find((s: string) => /PRAGMA user_version\s*=/.test(s))
    expect(firstUVCall).not.toBe('PRAGMA user_version = 23')
    expect(firstUVCall).toBe('PRAGMA user_version = 2')
  })

  it('does NOT bootstrap when rawCurrent is 22 (one before bootstrap threshold)', () => {
    const db = makeMockDb({ userVersion: 22, hasConfigTable: true })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    // v23 should run, first user_version write should be 23 from migration v23 itself, not bootstrap
    const firstUVCall = calls.find((s: string) => /PRAGMA user_version\s*=/.test(s))
    // No bootstrap: first PRAGMA is from migration v23 (PRAGMA user_version = 23)
    // but this looks the same — what matters is NO 'PRAGMA user_version = 23' before SAVEPOINT m23
    const savepoint23 = calls.findIndex((s: string) => s === 'SAVEPOINT m23')
    const bootstrapUV = calls.findIndex((s: string) => s === 'PRAGMA user_version = 23')
    // If bootstrap ran, PRAGMA user_version=23 would appear before SAVEPOINT m23 (or no SAVEPOINT m23 at all)
    // Without bootstrap: SAVEPOINT m23 comes BEFORE 'PRAGMA user_version = 23'
    expect(savepoint23).toBeGreaterThan(-1)
    expect(bootstrapUV).toBeGreaterThan(savepoint23) // bootstrap did NOT set it before the migration ran
  })

  it('bootstraps when rawCurrent is exactly 0 and config+permission_mode+max_sessions+cost_usd present', () => {
    const db = makeMockDb({
      userVersion: 0,
      hasConfigTable: true,
      colMap: {
        agents: ['id', 'name', 'scope', 'permission_mode', 'max_sessions'],
        sessions: ['id', 'status', 'cost_usd'],
      },
    })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    const firstUVCall = calls.find((s: string) => /PRAGMA user_version\s*=/.test(s))
    expect(firstUVCall).toBe('PRAGMA user_version = 23')
  })
})

// ── Bootstrap guard: permission_mode AND max_sessions both required ────────────
// Kill: mutations that short-circuit the AND condition

describe('migrateDb — bootstrap requires BOTH permission_mode AND max_sessions', () => {
  beforeEach(() => vi.clearAllMocks())

  it('does NOT bootstrap when permission_mode present but max_sessions absent', () => {
    const db = makeMockDb({
      userVersion: 0,
      hasConfigTable: true,
      colMap: {
        agents: ['id', 'name', 'scope', 'permission_mode'],  // no max_sessions
      },
    })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    const firstUVCall = calls.find((s: string) => /PRAGMA user_version\s*=/.test(s))
    // No bootstrap → first user_version written is 1 (first migration)
    expect(firstUVCall).toBe('PRAGMA user_version = 1')
    expect(firstUVCall).not.toBe('PRAGMA user_version = 23')
  })

  it('does NOT bootstrap when max_sessions present but permission_mode absent', () => {
    const db = makeMockDb({
      userVersion: 0,
      hasConfigTable: true,
      colMap: {
        agents: ['id', 'name', 'scope', 'max_sessions'],  // no permission_mode
      },
    })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    const firstUVCall = calls.find((s: string) => /PRAGMA user_version\s*=/.test(s))
    expect(firstUVCall).toBe('PRAGMA user_version = 1')
    expect(firstUVCall).not.toBe('PRAGMA user_version = 23')
  })

  it('bootstraps when permission_mode, max_sessions AND sessions.cost_usd are all present', () => {
    const db = makeMockDb({
      userVersion: 0,
      hasConfigTable: true,
      colMap: {
        agents: ['id', 'name', 'scope', 'permission_mode', 'max_sessions'],
        sessions: ['id', 'status', 'cost_usd'],
      },
    })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    const firstUVCall = calls.find((s: string) => /PRAGMA user_version\s*=/.test(s))
    expect(firstUVCall).toBe('PRAGMA user_version = 23')
  })

  it('all 31 migrations run when neither permission_mode nor max_sessions present', () => {
    const db = makeMockDb({
      userVersion: 0,
      hasConfigTable: true,
      colMap: { agents: ['id', 'name'] },
    })
    const result = migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    expect(result).toBe(35)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.some((s: string) => s === 'ADD COLUMN permission_mode' || s.includes('ADD COLUMN permission_mode'))).toBe(true)
  })

  it('does NOT bootstrap when permission_mode+max_sessions present but sessions.cost_usd absent — v20 runs and adds cost_usd', () => {
    // Simulates an old DB that had the old schema system (has permission_mode/max_sessions)
    // but was created before v20 — sessions table lacks cost_usd/duration_ms/num_turns.
    const db = makeMockDb({
      userVersion: 0,
      hasConfigTable: true,
      colMap: {
        agents: ['id', 'name', 'scope', 'permission_mode', 'max_sessions'],
        sessions: ['id', 'status'],  // cost_usd absent — v20 not yet applied
      },
    })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    // Bootstrap must NOT have fired — no 'PRAGMA user_version = 23' before SAVEPOINT m1
    const firstUVCall = calls.find((s: string) => /PRAGMA user_version\s*=/.test(s))
    expect(firstUVCall).toBe('PRAGMA user_version = 1')
    expect(firstUVCall).not.toBe('PRAGMA user_version = 23')
    // v20 must have run — it adds cost_usd (among others)
    expect(calls.some((s: string) => s.includes('ADD COLUMN cost_usd'))).toBe(true)
  })
})

// ── Bootstrap colResult guard: configResult.length > 0 && configResult[0].values.length > 0 ──
// Kill: removing one of the conjunction terms

describe('migrateDb — bootstrap configResult guard (both length > 0 required)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('does NOT bootstrap when config query returns empty array (configResult.length === 0)', () => {
    // hasConfigTable=false → exec returns [] for schema_version query
    const db = makeMockDb({
      userVersion: 0,
      hasConfigTable: false,
      colMap: { agents: ['id', 'name', 'scope', 'permission_mode', 'max_sessions'] },
    })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    const firstUVCall = calls.find((s: string) => /PRAGMA user_version\s*=/.test(s))
    // No config table → no bootstrap → all migrations run → first is PRAGMA user_version = 1
    expect(firstUVCall).toBe('PRAGMA user_version = 1')
    expect(firstUVCall).not.toBe('PRAGMA user_version = 23')
  })

  it('does NOT bootstrap when config query returns result with empty values array', () => {
    // configResult.length=1 but configResult[0].values=[] → bootstrap guard should fail
    const db = makeMockDb({ userVersion: 0, hasConfigTable: false })
    const originalExec = db.exec
    db.exec = vi.fn().mockImplementation((query: string) => {
      if (query.includes("key = 'schema_version'")) {
        return [{ columns: ['value'], values: [] }] // length=1 but values.length=0
      }
      return originalExec(query)
    })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    const firstUVCall = calls.find((s: string) => /PRAGMA user_version\s*=/.test(s))
    // values.length=0 → no bootstrap
    expect(firstUVCall).toBe('PRAGMA user_version = 1')
    expect(firstUVCall).not.toBe('PRAGMA user_version = 23')
  })
})

// ── v2/v17/v18/v19 — colResult.length === 0 guard ────────────────────────────
// Kill: `colResult.length !== 0` or `colResult.length >= 0` mutations

describe('migrateDb — colResult.length === 0 early-return guard', () => {
  beforeEach(() => vi.clearAllMocks())

  it('v2: skips all ALTER TABLE when agents PRAGMA returns empty (length === 0)', () => {
    const db = makeMockDb({ userVersion: 1, colMap: {} }) // no agents entry
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.every((s: string) => !s.includes('ALTER TABLE agents ADD COLUMN'))).toBe(true)
  })

  it('v2: runs ALTER TABLE when agents PRAGMA returns rows (length > 0)', () => {
    const db = makeMockDb({ userVersion: 1, colMap: { agents: ['id', 'name'] } }) // no extra cols
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.some((s: string) => s.includes('ALTER TABLE agents ADD COLUMN system_prompt '))).toBe(true)
  })

  it('v17: skips ADD COLUMN auto_launch when agents PRAGMA is empty (length === 0)', () => {
    const db = makeMockDb({ userVersion: 16, colMap: {} })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.every((s: string) => !s.includes('ADD COLUMN auto_launch'))).toBe(true)
  })

  it('v17: runs ADD COLUMN auto_launch when agents PRAGMA has rows (length > 0)', () => {
    const db = makeMockDb({ userVersion: 16, colMap: { agents: ['id', 'name'] } })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.some((s: string) => s.includes('ADD COLUMN auto_launch'))).toBe(true)
  })

  it('v18: skips ADD COLUMN permission_mode when agents PRAGMA is empty (length === 0)', () => {
    const db = makeMockDb({ userVersion: 17, colMap: {} })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.every((s: string) => !s.includes('ADD COLUMN permission_mode'))).toBe(true)
  })

  it('v18: runs ADD COLUMN permission_mode when agents PRAGMA has rows (length > 0)', () => {
    const db = makeMockDb({ userVersion: 17, colMap: { agents: ['id', 'name', 'auto_launch'] } })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.some((s: string) => s.includes('ADD COLUMN permission_mode'))).toBe(true)
  })

  it('v19: skips ADD COLUMN max_sessions when agents PRAGMA is empty (length === 0)', () => {
    const db = makeMockDb({ userVersion: 18, colMap: {} })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.every((s: string) => !s.includes('ADD COLUMN max_sessions'))).toBe(true)
  })

  it('v19: runs ADD COLUMN max_sessions when agents PRAGMA has rows (length > 0)', () => {
    const db = makeMockDb({ userVersion: 18, colMap: { agents: ['id', 'name', 'permission_mode'] } })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.some((s: string) => s.includes('ADD COLUMN max_sessions'))).toBe(true)
  })

  it('v20: skips sessions cost/duration/turns when sessions PRAGMA is empty (length === 0)', () => {
    const db = makeMockDb({ userVersion: 19, colMap: {} })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.every((s: string) => !s.includes('ADD COLUMN cost_usd'))).toBe(true)
    expect(calls.every((s: string) => !s.includes('ADD COLUMN duration_ms'))).toBe(true)
  })

  it('v20: runs cost/duration/turns adds when sessions PRAGMA has rows (length > 0)', () => {
    const db = makeMockDb({ userVersion: 19, colMap: { sessions: ['id', 'agent_id'] } })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.some((s: string) => s.includes('ADD COLUMN cost_usd'))).toBe(true)
  })
})

// ── v25 tlSchema boundary: tlSchema.length > 0 && tlSchema[0].values.length > 0 ──
// Kill: removing tlSchema[0].values.length > 0 check

describe('migrateDb v25 — task_links tlSchema guard (both checks required)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('skips task_links recreation when tlSchema has empty array (no task_links table)', () => {
    // taskLinksSql='' → exec returns [] for task_links sql query
    const db = makeMockDb({
      userVersion: 24,
      taskLinksSql: '',
      colMap: {
        agents: ['id', 'name', 'scope'],
        sessions: ['id', 'status'],
        tasks: ['id', 'title', 'status'],
        task_comments: ['id', 'content'],
        locks: ['id', 'file'],
        agent_logs: ['id', 'level', 'files'],
      },
    })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.every((s: string) => !s.includes('task_links_new'))).toBe(true)
    expect(calls.every((s: string) => !s.includes('DROP TABLE task_links'))).toBe(true)
  })

  it('skips task_links recreation when tlSchema returns result with empty values', () => {
    const db = makeMockDb({ userVersion: 24, colMap: { agents: ['id', 'name', 'scope'], sessions: ['id', 'status'], tasks: ['id', 'title'], task_comments: ['id', 'content'], locks: ['id', 'file'], agent_logs: ['id', 'level', 'files'] } })
    const originalExec = db.exec
    db.exec = vi.fn().mockImplementation((query: string) => {
      if (query.includes("name='task_links'") && query.includes('sql')) {
        return [{ columns: ['sql'], values: [] }] // r.length=1 but values.length=0
      }
      return originalExec(query)
    })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    // values.length=0 → skip recreation
    expect(calls.every((s: string) => !s.includes('task_links_new'))).toBe(true)
  })

  it('recreates task_links when tlSchema has content with French constraints', () => {
    const frenchSchema = `CREATE TABLE task_links (type TEXT NOT NULL CHECK(type IN ('bloque','dépend_de')))`
    const db = makeMockDb({
      userVersion: 24,
      taskLinksSql: frenchSchema,
      colMap: {
        agents: ['id', 'name', 'scope'],
        sessions: ['id', 'status'],
        tasks: ['id', 'title', 'status'],
        task_comments: ['id', 'content'],
        locks: ['id', 'file'],
        agent_logs: ['id', 'level', 'files'],
      },
    })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.some((s: string) => s.includes('task_links_new'))).toBe(true)
  })
})

// ── T1340 unique blocks ────────────────────────────────────────────────────────

// ── uvResult.length > 0 boundary: empty PRAGMA user_version response ──────────
// Kills EqualityOperator / ConditionalExpression mutations on line 344
