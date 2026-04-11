import { describe, it, expect, vi, beforeEach } from 'vitest'
import { migrateDb, CURRENT_SCHEMA_VERSION } from './migration'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeMockDb({
  userVersion = 0,
  hasConfigTable = false,
  configValues = [['23']] as unknown[][],
  colMap = {} as Record<string, string[]>,
  tableMap = {} as Record<string, boolean>,
  taskLinksSql = '',
}: {
  userVersion?: number
  hasConfigTable?: boolean
  configValues?: unknown[][]
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
      if (!hasConfigTable) return []
      return configValues.length > 0
        ? [{ columns: ['value'], values: configValues }]
        : []
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

// ── Bootstrap path: rawCurrent === 0 is strict equality ──────────────────────

describe('migrateDb — bootstrap only triggers when user_version === 0', () => {
  beforeEach(() => vi.clearAllMocks())

  it('does NOT bootstrap when user_version=1 even if config table exists', () => {
    const db = makeMockDb({ userVersion: 1, hasConfigTable: true })
    const result = migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    // Should run v2..v29 = 28 migrations, not bootstrap
    expect(result).toBe(CURRENT_SCHEMA_VERSION - 1)
    // The bootstrap PRAGMA user_version = 23 is set BEFORE the migrations loop.
    // Without bootstrap: first PRAGMA should be user_version = 2 (from migration v2).
    // The very first user_version PRAGMA written should NOT be 23.
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    const firstUVCall = calls.find((s: string) => /PRAGMA user_version\s*=/.test(s))
    expect(firstUVCall).toBeDefined()
    // First write should be 'PRAGMA user_version = 2', not 'PRAGMA user_version = 23'
    expect(firstUVCall).not.toBe('PRAGMA user_version = 23')
    expect(firstUVCall).toBe('PRAGMA user_version = 2')
  })

  it('does NOT bootstrap when user_version=2 even if config table exists', () => {
    const db = makeMockDb({
      userVersion: 2,
      hasConfigTable: true,
      colMap: { agents: ['id', 'name', 'system_prompt', 'system_prompt_suffix', 'thinking_mode', 'allowed_tools'] },
    })
    const result = migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    // v3..v29 = 27 migrations
    expect(result).toBe(CURRENT_SCHEMA_VERSION - 2)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    // With bootstrap: first PRAGMA user_version = 23 would be set before migrations.
    // Without bootstrap: first should be 'PRAGMA user_version = 3'
    const firstUVCall = calls.find((s: string) => /PRAGMA user_version\s*=/.test(s))
    expect(firstUVCall).toBe('PRAGMA user_version = 3')
  })

  it('first PRAGMA user_version write is 23 (bootstrap cursor) for genuine legacy DB (v0 + config + permission_mode + max_sessions)', () => {
    const db = makeMockDb({
      userVersion: 0,
      hasConfigTable: true,
      colMap: {
        agent_groups: ['id', 'name', 'sort_order', 'created_at'],
        agents: ['id', 'name', 'scope', 'system_prompt', 'system_prompt_suffix',
          'thinking_mode', 'allowed_tools', 'auto_launch', 'permission_mode', 'max_sessions'],
        sessions: ['id', 'status', 'cost_usd', 'duration_ms', 'num_turns'],
        tasks: ['id', 'title', 'status'],
        task_comments: ['id', 'task_id', 'content'],
        locks: ['id', 'file'],
        agent_logs: ['id', 'level', 'files'],
      },
      tableMap: { config: true },
    })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    // The bootstrap sets user_version = 23 BEFORE the migration loop
    const firstUVCall = calls.find((s: string) => /PRAGMA user_version\s*=/.test(s))
    expect(firstUVCall).toBe('PRAGMA user_version = 23')
  })

  it('first PRAGMA user_version write is 1 (no bootstrap) for external DB (v0 + config, no permission_mode)', () => {
    const db = makeMockDb({
      userVersion: 0,
      hasConfigTable: true,
      colMap: {
        agents: ['id', 'name', 'scope'],
      },
      tableMap: { config: true },
    })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    // External DB — no bootstrap: first PRAGMA user_version = 1
    const firstUVCall = calls.find((s: string) => /PRAGMA user_version\s*=/.test(s))
    expect(firstUVCall).toBe('PRAGMA user_version = 1')
    expect(firstUVCall).not.toBe('PRAGMA user_version = 23')
  })

  it('for fresh DB (v0, no config), first PRAGMA user_version is 1 (not 23)', () => {
    const db = makeMockDb({ userVersion: 0, hasConfigTable: false })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    const firstUVCall = calls.find((s: string) => /PRAGMA user_version\s*=/.test(s))
    // Fresh DB — first migration is v1, so first PRAGMA user_version = 1
    expect(firstUVCall).toBe('PRAGMA user_version = 1')
    expect(firstUVCall).not.toBe('PRAGMA user_version = 23')
  })
})

// ── Bootstrap: config query returns empty values array (not empty result) ─────

describe('migrateDb — bootstrap config empty values edge case', () => {
  beforeEach(() => vi.clearAllMocks())

  it('does NOT bootstrap when config query returns empty values array', () => {
    // hasConfigTable=true but configValues=[] → no rows returned
    const db = makeMockDb({ userVersion: 0, hasConfigTable: true, configValues: [] })
    const result = migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    // No bootstrap: all 29 migrations applied
    expect(result).toBe(CURRENT_SCHEMA_VERSION)
    // First PRAGMA user_version write should be 1 (first migration), not 23 (bootstrap)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    const firstUVCall = calls.find((s: string) => /PRAGMA user_version\s*=/.test(s))
    expect(firstUVCall).toBe('PRAGMA user_version = 1')
    expect(firstUVCall).not.toBe('PRAGMA user_version = 23')
  })
})

// ── Return value: exact pending count ─────────────────────────────────────────

describe('migrateDb — exact return value', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 5 when five migrations are pending (v33, v34, v35, v36, v37)', () => {
    const db = makeMockDb({
      userVersion: 32,
      colMap: { sessions: ['id', 'status', 'cost_usd', 'duration_ms', 'num_turns', 'cli_type'], agents: ['id', 'name'] },
    })
    const result = migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    expect(result).toBe(5)
  })

  it('returns 10 when ten migrations are pending (v28–v37)', () => {
    const db = makeMockDb({ userVersion: 27, colMap: { agents: ['id', 'name'], sessions: ['id', 'status'] } })
    const result = migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    expect(result).toBe(10) // v28, v29, v30, v31, v32, v33, v34, v35, v36, v37
  })

  it('returns 0 exactly (not falsy) when already at CURRENT_SCHEMA_VERSION', () => {
    const db = makeMockDb({ userVersion: CURRENT_SCHEMA_VERSION })
    const result = migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    expect(result).toBe(0)
    expect(result).not.toBe(-1)
    expect(result).not.toBe(1)
  })

  it('returns exactly CURRENT_SCHEMA_VERSION for a fresh DB (not 0, not CURRENT-1)', () => {
    const db = makeMockDb({ userVersion: 0, hasConfigTable: false })
    const result = migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    expect(result).toBe(CURRENT_SCHEMA_VERSION)
    expect(result).not.toBe(0)
    expect(result).not.toBe(CURRENT_SCHEMA_VERSION - 1)
  })

  it('returns 14 for genuine legacy bootstrap (v0 + config + permission_mode + max_sessions = runs v24..v37)', () => {
    const db = makeMockDb({
      userVersion: 0,
      hasConfigTable: true,
      colMap: {
        agent_groups: ['id', 'name', 'sort_order', 'created_at'],
        agents: ['id', 'name', 'scope', 'system_prompt', 'system_prompt_suffix',
          'thinking_mode', 'allowed_tools', 'auto_launch', 'permission_mode', 'max_sessions'],
        sessions: ['id', 'status', 'cost_usd', 'duration_ms', 'num_turns'],
        tasks: ['id', 'title', 'status'],
        task_comments: ['id', 'task_id', 'content'],
        locks: ['id', 'file'],
        agent_logs: ['id', 'level', 'files'],
      },
      tableMap: { config: true },
    })
    const result = migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    expect(result).toBe(14) // v24, v25, v26, v27, v28, v29, v30, v31, v32, v33, v34, v35, v36, v37
    expect(result).not.toBe(13)
    expect(result).not.toBe(15)
  })

  it('returns CURRENT_SCHEMA_VERSION for external DB (v0 + config, no permission_mode/max_sessions)', () => {
    const db = makeMockDb({
      userVersion: 0,
      hasConfigTable: true,
      colMap: {
        agents: ['id', 'name', 'scope'],
      },
      tableMap: { config: true },
    })
    const result = migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    expect(result).toBe(CURRENT_SCHEMA_VERSION) // all migrations run
    expect(result).not.toBe(6)
  })
})

// ── version > current — boundary check ───────────────────────────────────────

describe('migrateDb — migration.version > current (strict greater than)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('does NOT re-run migration at exactly current version (strict >, not >=)', () => {
    // At version 5 exactly: v5 should NOT run again
    const db = makeMockDb({ userVersion: 5 })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    // v5 sets up indexes; none of those should appear (v5 already done)
    expect(calls.some((s: string) => s === 'SAVEPOINT m5')).toBe(false)
  })

  it('runs migration at version current+1 (version 6 when at 5)', () => {
    const db = makeMockDb({ userVersion: 5, tableMap: { task_agents: false } })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.some((s: string) => s === 'SAVEPOINT m6')).toBe(true)
  })
})

// ── v2 — column index [1] is name (not [0]) ───────────────────────────────────

describe('migrateDb v2 — PRAGMA table_info column index', () => {
  beforeEach(() => vi.clearAllMocks())

  it('reads column name from index [1] — skips ADD COLUMN when name matches at index 1', () => {
    // The mock returns [cid, name, ...] — name is at index 1
    const db = makeMockDb({
      userVersion: 1,
      colMap: { agents: ['id', 'name', 'system_prompt', 'system_prompt_suffix', 'thinking_mode', 'allowed_tools'] },
    })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    // system_prompt already present — no ALTER TABLE for it
    expect(calls.every((s: string) => !s.includes('ADD COLUMN system_prompt '))).toBe(true)
    expect(calls.every((s: string) => !s.includes('ADD COLUMN system_prompt_suffix'))).toBe(true)
    expect(calls.every((s: string) => !s.includes('ADD COLUMN thinking_mode'))).toBe(true)
    expect(calls.every((s: string) => !s.includes('ADD COLUMN allowed_tools'))).toBe(true)
  })

  it('adds all four columns when agents table is empty of those columns', () => {
    const db = makeMockDb({ userVersion: 1, colMap: { agents: ['id', 'name'] } })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.some((s: string) => s.includes('ADD COLUMN system_prompt '))).toBe(true)
    expect(calls.some((s: string) => s.includes('ADD COLUMN system_prompt_suffix'))).toBe(true)
    expect(calls.some((s: string) => s.includes('ADD COLUMN thinking_mode'))).toBe(true)
    expect(calls.some((s: string) => s.includes('ADD COLUMN allowed_tools'))).toBe(true)
  })
})

// ── v3 — INSERT exact schema_version value '2' ───────────────────────────────

describe('migrateDb v3 — INSERT config exact values', () => {
  beforeEach(() => vi.clearAllMocks())

  it("inserts schema_version with value '2' (not '1' or '3')", () => {
    const db = makeMockDb({
      userVersion: 2,
      tableMap: { config: false },
      colMap: { agents: ['id', 'name', 'system_prompt', 'system_prompt_suffix', 'thinking_mode', 'allowed_tools'] },
    })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    const insertCall = calls.find((s: string) => s.includes('INSERT INTO config'))
    expect(insertCall).toBeDefined()
    expect(insertCall).toContain("'schema_version'")
    expect(insertCall).toContain("'2'")
    expect(insertCall).not.toContain("'1'")
    expect(insertCall).not.toContain("'3'")
  })

  it("inserts claude_md_commit with empty string value ''", () => {
    const db = makeMockDb({
      userVersion: 2,
      tableMap: { config: false },
      colMap: { agents: ['id', 'name', 'system_prompt', 'system_prompt_suffix', 'thinking_mode', 'allowed_tools'] },
    })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    const insertCall = calls.find((s: string) => s.includes('INSERT INTO config'))
    expect(insertCall).toBeDefined()
    expect(insertCall).toContain("'claude_md_commit'")
    expect(insertCall).toContain("''") // empty string value
  })
})

// ── v4 — INSERT exact perimetre names ────────────────────────────────────────

describe('migrateDb v4 — perimetres INSERT exact strings', () => {
  beforeEach(() => vi.clearAllMocks())

  it("inserts 'renderer/' as dossier for front-vuejs", () => {
    const db = makeMockDb({
      userVersion: 3,
      tableMap: { config: true, perimetres: false },
      colMap: { agents: ['id', 'name', 'system_prompt', 'system_prompt_suffix', 'thinking_mode', 'allowed_tools'] },
    })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    const insertCall = calls.find((s: string) => s.includes('INSERT INTO perimetres'))
    expect(insertCall).toBeDefined()
    expect(insertCall).toContain('renderer/')
    expect(insertCall).toContain('main/')
  })

  it("inserts 'Vue 3 + TypeScript + Tailwind CSS' techno for front-vuejs", () => {
    const db = makeMockDb({
      userVersion: 3,
      tableMap: { config: true, perimetres: false },
      colMap: { agents: ['id', 'name', 'system_prompt', 'system_prompt_suffix', 'thinking_mode', 'allowed_tools'] },
    })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    const insertCall = calls.find((s: string) => s.includes('INSERT INTO perimetres'))
    expect(insertCall).toContain('Vue 3')
    expect(insertCall).toContain('Electron')
  })
})

// ── v22 — FTS4 exact column names in triggers ─────────────────────────────────
