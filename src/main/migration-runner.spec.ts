import { describe, it, expect, vi, beforeEach } from 'vitest'
import { migrateDb, CURRENT_SCHEMA_VERSION } from './migration'

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a minimal mock DB that reports a given user_version and optionally
 * exposes a config table (for the legacy bootstrap path).
 *
 * exec() handles:
 *  - PRAGMA user_version
 *  - SELECT from config (schema_version)
 *  - PRAGMA table_info(<table>) — returns columns list provided in colMap
 *  - SELECT COUNT(*) from sqlite_master — hasTable() in v25 / v3 / v4 / v6
 *  - SELECT from sqlite_master (sql) — v25 task_links schema check
 */
function createMockDb({
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
  // user_version can be updated via db.run("PRAGMA user_version = N")
  let currentVersion = userVersion

  const exec = vi.fn().mockImplementation((query: string) => {
    if (query.includes('PRAGMA user_version')) {
      return [{ columns: ['user_version'], values: [[currentVersion]] }]
    }
    if (query.includes("key = 'schema_version'")) {
      if (hasConfigTable) return [{ columns: ['value'], values: [['23']] }]
      return []
    }
    // PRAGMA table_info(<table>)
    const tiMatch = query.match(/PRAGMA table_info\((\w+)\)/)
    if (tiMatch) {
      const tableName = tiMatch[1]
      const cols = colMap[tableName]
      if (!cols || cols.length === 0) return []
      const values = cols.map((name, idx) => [idx, name, 'TEXT', 0, null, 0])
      return [{ columns: ['cid', 'name', 'type', 'notnull', 'dflt_value', 'pk'], values }]
    }
    // SELECT COUNT(*) FROM sqlite_master — hasTable() in v25
    if (query.includes('COUNT(*)') && query.includes('sqlite_master')) {
      const nameMatch = query.match(/name='(\w+)'/)
      if (nameMatch) {
        const tableName = nameMatch[1]
        const exists = tableMap[tableName] ?? false
        return [{ columns: ['COUNT(*)'], values: [[exists ? 1 : 0]] }]
      }
    }
    // SELECT name/sql FROM sqlite_master — v3/v4/v6 guard + v25 task_links sql
    if (query.includes('sqlite_master') && query.includes("type='table'")) {
      // v25 task_links schema check (SELECT sql ...)
      if (query.includes("name='task_links'") && query.includes('sql')) {
        if (taskLinksSql) return [{ columns: ['sql'], values: [[taskLinksSql]] }]
        return []
      }
      // v3/v4/v6 table-existence guard (SELECT name ...)
      const nameMatch = query.match(/name='(\w+)'/)
      if (nameMatch) {
        const tableName = nameMatch[1]
        const exists = tableMap[tableName] ?? false
        if (exists) return [{ columns: ['name'], values: [[tableName]] }]
        return []
      }
    }
    return []
  })

  const run = vi.fn().mockImplementation((sql: string) => {
    // Track user_version updates so subsequent PRAGMA user_version reads are correct
    const uvMatch = sql.match(/PRAGMA user_version\s*=\s*(\d+)/)
    if (uvMatch) currentVersion = Number(uvMatch[1])
  })

  return { exec, run, _getVersion: () => currentVersion }
}

// ── CURRENT_SCHEMA_VERSION ────────────────────────────────────────────────────

describe('CURRENT_SCHEMA_VERSION', () => {
  it('equals the last migration version (41)', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(41)
  })
})

// ── migrateDb — fresh DB (user_version=0, no config table) ───────────────────

describe('migrateDb — fresh DB', () => {
  beforeEach(() => vi.clearAllMocks())

  it('applies all migrations and returns CURRENT_SCHEMA_VERSION', () => {
    const db = createMockDb({ userVersion: 0, hasConfigTable: false })
    const result = migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    expect(result).toBe(CURRENT_SCHEMA_VERSION)
  })

  it('sets user_version to CURRENT_SCHEMA_VERSION after full migration', () => {
    const db = createMockDb({ userVersion: 0, hasConfigTable: false })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    expect(db._getVersion()).toBe(CURRENT_SCHEMA_VERSION)
  })

  it('wraps each migration in SAVEPOINT / RELEASE', () => {
    const db = createMockDb({ userVersion: 0, hasConfigTable: false })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    for (let v = 1; v <= CURRENT_SCHEMA_VERSION; v++) {
      expect(calls.some((s: string) => s.includes(`SAVEPOINT m${v}`))).toBe(true)
      expect(calls.some((s: string) => s.includes(`RELEASE SAVEPOINT m${v}`))).toBe(true)
    }
  })
})

// ── migrateDb — legacy bootstrap (user_version=0 + config table) ─────────────

describe('migrateDb — legacy bootstrap', () => {
  beforeEach(() => vi.clearAllMocks())

  function createLegacyDb() {
    // Genuine legacy KanbAgent DB: user_version=0, config table present, and
    // agents already has permission_mode+max_sessions (added by old migration
    // system before the numbered schema). agent_groups without parent_id (v24
    // must run), no French cols (v25 idempotent).
    return createMockDb({
      userVersion: 0,
      hasConfigTable: true,
      colMap: {
        agent_groups: ['id', 'name', 'sort_order', 'created_at'],
        agents: ['id', 'name', 'scope', 'system_prompt', 'system_prompt_suffix',
          'thinking_mode', 'allowed_tools', 'auto_launch', 'permission_mode', 'max_sessions'],
        sessions: ['id', 'status', 'cost_usd', 'duration_ms', 'num_turns'],
        tasks: ['id', 'title', 'status'],
        task_comments: ['id', 'task_id', 'agent_id', 'content'],
        locks: ['id', 'file'],
        agent_logs: ['id', 'level', 'files'],
      },
      tableMap: { config: true },
    })
  }

  it('sets cursor to 23 (bootstrap) and returns 16 migrations (v24–v39)', () => {
    const db = createLegacyDb()
    const result = migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    expect(result).toBe(17)
  })

  it('emits PRAGMA user_version = 23 (bootstrap cursor)', () => {
    const db = createLegacyDb()
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.some((s: string) => s === 'PRAGMA user_version = 23')).toBe(true)
  })

  it('does NOT run migrations v1-v23', () => {
    const db = createLegacyDb()
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    // Use exact match (not includes) to avoid "SAVEPOINT m2" matching "SAVEPOINT m24"
    for (let v = 1; v <= 23; v++) {
      expect(calls.some((s: string) => s === `SAVEPOINT m${v}`)).toBe(false)
    }
  })

  it('runs v24 (ADD COLUMN parent_id) when column is absent', () => {
    const db = createLegacyDb()
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.some((s: string) => s.includes('ADD COLUMN parent_id'))).toBe(true)
  })
})

// ── migrateDb — external DB (config table but missing v18/v19 columns) ────────

describe('migrateDb — external DB (config table, no permission_mode/max_sessions)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('runs all migrations (no bootstrap skip) when permission_mode is absent', () => {
    const db = createMockDb({
      userVersion: 0,
      hasConfigTable: true,
      colMap: {
        agents: ['id', 'name', 'scope'],
      },
      tableMap: { config: true },
    })
    const result = migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    expect(result).toBe(CURRENT_SCHEMA_VERSION)
  })

  it('adds permission_mode column when missing on external DB', () => {
    const db = createMockDb({
      userVersion: 0,
      hasConfigTable: true,
      colMap: {
        agents: ['id', 'name', 'scope'],
      },
      tableMap: { config: true },
    })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.some((s: string) => s.includes('ADD COLUMN permission_mode'))).toBe(true)
  })

  it('adds max_sessions column when missing on external DB', () => {
    const db = createMockDb({
      userVersion: 0,
      hasConfigTable: true,
      colMap: {
        agents: ['id', 'name', 'scope'],
      },
      tableMap: { config: true },
    })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.some((s: string) => s.includes('ADD COLUMN max_sessions'))).toBe(true)
  })

  it('first PRAGMA user_version write is 1 (not 23 bootstrap) when columns absent', () => {
    const db = createMockDb({
      userVersion: 0,
      hasConfigTable: true,
      colMap: {
        agents: ['id', 'name', 'scope'],
      },
      tableMap: { config: true },
    })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    // No bootstrap: first user_version write is from v1 running, not the bootstrap cursor
    const firstUVCall = calls.find((s: string) => /PRAGMA user_version\s*=/.test(s))
    expect(firstUVCall).toBe('PRAGMA user_version = 1')
    expect(firstUVCall).not.toBe('PRAGMA user_version = 23')
  })
})

// ── migrateDb — idempotence ───────────────────────────────────────────────────

describe('migrateDb — idempotence', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 0 when user_version already equals CURRENT_SCHEMA_VERSION', () => {
    const db = createMockDb({ userVersion: CURRENT_SCHEMA_VERSION })
    const result = migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    expect(result).toBe(0)
  })

  it('makes no db.run calls when already up-to-date', () => {
    const db = createMockDb({ userVersion: CURRENT_SCHEMA_VERSION })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    expect(db.run).not.toHaveBeenCalled()
  })

  it('second call returns 0 after first call migrated a fresh DB', () => {
    const db = createMockDb({ userVersion: 0, hasConfigTable: false })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    // Now DB is at CURRENT_SCHEMA_VERSION — second call should do nothing
    const result2 = migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    expect(result2).toBe(0)
  })
})

// ── migrateDb — SAVEPOINT rollback on error ───────────────────────────────────

describe('migrateDb — SAVEPOINT rollback on error', () => {
  beforeEach(() => vi.clearAllMocks())

  it('rolls back and re-throws when a migration up() throws', () => {
    // Start at v25 so only v26 runs
    const db = createMockDb({ userVersion: 25 })
    const error = new Error('DROP TABLE failed')
    db.run.mockImplementation((sql: string) => {
      const uvMatch = sql.match(/PRAGMA user_version\s*=\s*(\d+)/)
      if (uvMatch) return
      if (sql.includes('DROP INDEX IF EXISTS idx_locks_released_at')) throw error
    })

    expect(() => migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)).toThrow('DROP TABLE failed')

    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.some((s: string) => s.includes('SAVEPOINT m26'))).toBe(true)
    expect(calls.some((s: string) => s.includes('ROLLBACK TO SAVEPOINT m26'))).toBe(true)
    expect(calls.some((s: string) => s.includes('RELEASE SAVEPOINT m26'))).toBe(true)
  })

  it('does not update user_version when migration throws', () => {
    const db = createMockDb({ userVersion: 25 })
    db.run.mockImplementation((sql: string) => {
      if (sql.includes('DROP INDEX IF EXISTS idx_locks_released_at')) throw new Error('fail')
    })
    try { migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb) } catch { /* expected */ }
    // user_version should stay at 25
    expect(db._getVersion()).toBe(25)
  })
})

// ── migrateDb v2 guard — column already present ───────────────────────────────

describe('migrateDb v2 — agents column guard', () => {
  beforeEach(() => vi.clearAllMocks())

  it('skips ALTER TABLE when system_prompt already exists', () => {
    const db = createMockDb({
      userVersion: 1,
      colMap: {
        agents: ['id', 'name', 'system_prompt', 'system_prompt_suffix', 'thinking_mode', 'allowed_tools'],
      },
    })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.every((s: string) => !s.includes('ALTER TABLE agents ADD COLUMN system_prompt '))).toBe(true)
  })

  it('runs ALTER TABLE for missing columns only', () => {
    // Only system_prompt missing, others present
    const db = createMockDb({
      userVersion: 1,
      colMap: {
        agents: ['id', 'name', 'system_prompt_suffix', 'thinking_mode', 'allowed_tools'],
      },
    })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.some((s: string) => s.includes('ADD COLUMN system_prompt '))).toBe(true)
    expect(calls.every((s: string) => !s.includes('ADD COLUMN system_prompt_suffix'))).toBe(true)
    expect(calls.every((s: string) => !s.includes('ADD COLUMN thinking_mode'))).toBe(true)
    expect(calls.every((s: string) => !s.includes('ADD COLUMN allowed_tools'))).toBe(true)
  })

  it('skips all ALTER TABLE calls when agents table does not exist (PRAGMA returns empty)', () => {
    const db = createMockDb({ userVersion: 1, colMap: {} })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.every((s: string) => !s.includes('ALTER TABLE agents'))).toBe(true)
  })
})

// ── migrateDb v3 guard — config table already present ────────────────────────

describe('migrateDb v3 — config table guard', () => {
  beforeEach(() => vi.clearAllMocks())

  it('skips CREATE TABLE config when config table already exists', () => {
    const db = createMockDb({
      userVersion: 2,
      tableMap: { config: true },
      colMap: {
        agents: ['id', 'name', 'system_prompt', 'system_prompt_suffix', 'thinking_mode', 'allowed_tools'],
      },
    })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.every((s: string) => !s.includes('CREATE TABLE config'))).toBe(true)
  })

  it('runs CREATE TABLE config when table is absent', () => {
    const db = createMockDb({
      userVersion: 2,
      tableMap: { config: false },
      colMap: {
        agents: ['id', 'name', 'system_prompt', 'system_prompt_suffix', 'thinking_mode', 'allowed_tools'],
      },
    })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.some((s: string) => s.includes('CREATE TABLE config'))).toBe(true)
  })
})

// v25, v25 French rename, v25 task_links → see migration-runner-4.spec.ts
