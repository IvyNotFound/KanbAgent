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

describe('migrateDb v3 guard — r.length > 0 and r[0].values.length > 0 are both required', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates config table when sqlite_master returns empty array (r.length === 0)', () => {
    // tableMap config: false → exec returns [] for sqlite_master
    const db = makeMockDb({
      userVersion: 2,
      tableMap: { config: false },
      colMap: { agents: ['id', 'name', 'system_prompt', 'system_prompt_suffix', 'thinking_mode', 'allowed_tools'] },
    })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.some((s: string) => s.includes('CREATE TABLE config'))).toBe(true)
  })

  it('does NOT create config table when sqlite_master returns a row with the table name (r.length > 0, values.length > 0)', () => {
    // tableMap config: true → exec returns [{ columns, values: [['config']] }]
    const db = makeMockDb({
      userVersion: 2,
      tableMap: { config: true },
      colMap: { agents: ['id', 'name', 'system_prompt', 'system_prompt_suffix', 'thinking_mode', 'allowed_tools'] },
    })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.every((s: string) => !s.includes('CREATE TABLE config'))).toBe(true)
  })

  it('creates config table when sqlite_master name query returns empty values array (r.length > 0 but values empty)', () => {
    // Simulate: sqlite_master returns result with empty values → guard should NOT skip creation
    const db = makeMockDb({ userVersion: 2, tableMap: { config: false }, colMap: { agents: ['id', 'name'] } })
    // Override exec to return a result with empty values for the config table query
    const originalExec = db.exec
    db.exec = vi.fn().mockImplementation((query: string) => {
      if (query.includes("type='table'") && query.includes("name='config'") && !query.includes('sql') && !query.includes('COUNT(*)')) {
        return [{ columns: ['name'], values: [] }] // r.length=1 but values.length=0
      }
      return originalExec(query)
    })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    // values.length === 0 → guard treats as absent → creates table
    expect(calls.some((s: string) => s.includes('CREATE TABLE config'))).toBe(true)
  })
})

// ── v4 guard (L46): r.length > 0 && r[0].values.length > 0 ───────────────────

describe('migrateDb v4 guard — r.length > 0 and r[0].values.length > 0 are both required', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates perimetres table when sqlite_master returns empty (r.length === 0)', () => {
    const db = makeMockDb({
      userVersion: 3,
      tableMap: { config: true, perimetres: false },
      colMap: { agents: ['id', 'name', 'system_prompt', 'system_prompt_suffix', 'thinking_mode', 'allowed_tools'] },
    })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.some((s: string) => s.includes('CREATE TABLE perimetres'))).toBe(true)
  })

  it('does NOT create perimetres table when sqlite_master returns a row (r.length > 0, values.length > 0)', () => {
    const db = makeMockDb({
      userVersion: 3,
      tableMap: { config: true, perimetres: true },
      colMap: { agents: ['id', 'name', 'system_prompt', 'system_prompt_suffix', 'thinking_mode', 'allowed_tools'] },
    })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.every((s: string) => !s.includes('CREATE TABLE perimetres'))).toBe(true)
  })

  it('creates perimetres table when sqlite_master returns result with empty values array', () => {
    const db = makeMockDb({ userVersion: 3, tableMap: { config: true, perimetres: false }, colMap: { agents: ['id', 'name'] } })
    const originalExec = db.exec
    db.exec = vi.fn().mockImplementation((query: string) => {
      if (query.includes("type='table'") && query.includes("name='perimetres'") && !query.includes('sql') && !query.includes('COUNT(*)')) {
        return [{ columns: ['name'], values: [] }] // r.length=1 but values.length=0 → treat as absent
      }
      return originalExec(query)
    })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.some((s: string) => s.includes('CREATE TABLE perimetres'))).toBe(true)
  })
})

// ── v6 guard (L78): r.length > 0 && r[0].values.length > 0 ───────────────────

describe('migrateDb v6 guard — r.length > 0 and r[0].values.length > 0 are both required', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates task_agents table when sqlite_master returns empty (r.length === 0)', () => {
    const db = makeMockDb({ userVersion: 5, tableMap: { task_agents: false } })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.some((s: string) => s.includes('CREATE TABLE IF NOT EXISTS task_agents'))).toBe(true)
  })

  it('does NOT create task_agents table when sqlite_master returns row (r.length > 0, values.length > 0)', () => {
    const db = makeMockDb({ userVersion: 5, tableMap: { task_agents: true } })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.every((s: string) => !s.includes('CREATE TABLE IF NOT EXISTS task_agents'))).toBe(true)
  })

  it('creates task_agents table when sqlite_master returns result with empty values array', () => {
    const db = makeMockDb({ userVersion: 5, tableMap: { task_agents: false } })
    const originalExec = db.exec
    db.exec = vi.fn().mockImplementation((query: string) => {
      if (query.includes("type='table'") && query.includes("name='task_agents'") && !query.includes('sql') && !query.includes('COUNT(*)')) {
        return [{ columns: ['name'], values: [] }] // r.length=1 but values.length=0
      }
      return originalExec(query)
    })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.some((s: string) => s.includes('CREATE TABLE IF NOT EXISTS task_agents'))).toBe(true)
  })
})

// ── v25 hasCol boundary — r.length === 0 ─────────────────────────────────────
// Kill: `r.length >= 0` mutation (always true) — test that empty PRAGMA = no rename

describe('migrateDb v25 — hasCol() returns false when PRAGMA returns empty (r.length === 0)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('skips agents.perimetre rename when PRAGMA table_info(agents) returns empty', () => {
    // colMap has no agents entry → PRAGMA returns []
    const db = makeMockDb({
      userVersion: 24,
      colMap: {},  // PRAGMA returns [] for any table
    })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.every((s: string) => !s.includes('RENAME COLUMN perimetre TO scope'))).toBe(true)
  })

  it('skips sessions.statut rename when PRAGMA table_info(sessions) returns empty', () => {
    const db = makeMockDb({ userVersion: 24, colMap: {} })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.every((s: string) => !s.includes('RENAME COLUMN statut TO status'))).toBe(true)
  })

  it('skips all task column renames when PRAGMA table_info(tasks) returns empty', () => {
    const db = makeMockDb({ userVersion: 24, colMap: {} })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.every((s: string) => !s.includes('RENAME COLUMN titre TO title'))).toBe(true)
    expect(calls.every((s: string) => !s.includes('RENAME COLUMN agent_createur_id'))).toBe(true)
    expect(calls.every((s: string) => !s.includes('RENAME COLUMN agent_assigne_id TO agent_assigned_id'))).toBe(true)
  })

  it('runs agents.perimetre rename when PRAGMA returns agents with perimetre col (r.length > 0)', () => {
    const db = makeMockDb({
      userVersion: 24,
      colMap: {
        agents: ['id', 'name', 'perimetre'],
        sessions: ['id', 'status'],
        tasks: ['id', 'title', 'status'],
        task_comments: ['id', 'content'],
        locks: ['id', 'file'],
        agent_logs: ['id', 'level', 'files'],
      },
    })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.some((s: string) => s.includes('RENAME COLUMN perimetre TO scope') && s.includes('agents'))).toBe(true)
  })

  it('skips agents.perimetre rename when agents table has no perimetre col (hasCol returns false)', () => {
    const db = makeMockDb({
      userVersion: 24,
      colMap: {
        agents: ['id', 'name', 'scope'],  // already renamed
        sessions: ['id', 'status'],
        tasks: ['id', 'title', 'status'],
        task_comments: ['id', 'content'],
        locks: ['id', 'file'],
        agent_logs: ['id', 'level', 'files'],
      },
    })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.every((s: string) => !s.includes('RENAME COLUMN perimetre TO scope'))).toBe(true)
  })
})

// ── v25 hasCol — row[1] === col boundary ──────────────────────────────────────
// Kill: `row[1] !== col` mutation — column must match at index 1 specifically

describe('migrateDb v25 — hasCol() uses row[1] (column name at index 1)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('detects column at index 1 and runs rename', () => {
    // PRAGMA returns rows where name is at index 1: [cid, name, type, ...]
    const db = makeMockDb({
      userVersion: 24,
      colMap: {
        tasks: ['id', 'titre', 'statut', 'agent_createur_id', 'agent_assigne_id', 'agent_valideur_id', 'perimetre'],
        agents: ['id', 'name', 'scope'],
        sessions: ['id', 'status'],
        task_comments: ['id', 'content'],
        locks: ['id', 'file'],
        agent_logs: ['id', 'level', 'files'],
      },
    })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.some((s: string) => s.includes('RENAME COLUMN titre TO title'))).toBe(true)
    expect(calls.some((s: string) => s.includes('RENAME COLUMN agent_assigne_id TO agent_assigned_id'))).toBe(true)
    expect(calls.some((s: string) => s.includes('RENAME COLUMN agent_valideur_id TO agent_validator_id'))).toBe(true)
  })

  it('does NOT rename when French column is absent from PRAGMA result', () => {
    // tasks already have English column names at row[1]
    const db = makeMockDb({
      userVersion: 24,
      colMap: {
        tasks: ['id', 'title', 'status', 'agent_creator_id', 'agent_assigned_id', 'agent_validator_id', 'scope'],
        agents: ['id', 'name', 'scope'],
        sessions: ['id', 'status'],
        task_comments: ['id', 'content'],
        locks: ['id', 'file'],
        agent_logs: ['id', 'level', 'files'],
      },
    })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.every((s: string) => !s.includes('RENAME COLUMN titre'))).toBe(true)
    expect(calls.every((s: string) => !s.includes('RENAME COLUMN statut'))).toBe(true)
  })
})

// ── v25 hasTable boundary — COUNT(*) > 0 ──────────────────────────────────────
// Kill: `COUNT(*) >= 0` mutation (always true) or `COUNT(*) > 1` mutation

describe('migrateDb v25 — hasTable() uses COUNT(*) > 0', () => {
  beforeEach(() => vi.clearAllMocks())

  it('processes perimetres block when COUNT(*)=1 (table exists)', () => {
    const db = makeMockDb({
      userVersion: 24,
      tableMap: { perimetres: true, scopes: false },
      colMap: {
        perimetres: ['id', 'name', 'dossier', 'actif'],
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
    expect(calls.some((s: string) => s.includes('ALTER TABLE perimetres RENAME TO scopes'))).toBe(true)
  })

  it('skips perimetres block when COUNT(*)=0 (table does not exist)', () => {
    const db = makeMockDb({
      userVersion: 24,
      tableMap: { perimetres: false, scopes: false },
      tableRowCounts: { perimetres: 0, scopes: 0 },
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
    expect(calls.every((s: string) => !s.includes('ALTER TABLE perimetres RENAME TO scopes'))).toBe(true)
    expect(calls.every((s: string) => !s.includes('RENAME COLUMN dossier TO folder'))).toBe(true)
  })

  it('skips perimetres rename to scopes when COUNT(*scopes)=1 (scopes table already exists)', () => {
    const db = makeMockDb({
      userVersion: 24,
      tableMap: { perimetres: true, scopes: true },
      tableRowCounts: { perimetres: 1, scopes: 1 },
      colMap: {
        perimetres: ['id', 'name', 'folder', 'active'],
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
    // scopes already exists → should NOT rename perimetres to scopes
    expect(calls.every((s: string) => !s.includes('ALTER TABLE perimetres RENAME TO scopes'))).toBe(true)
  })
})

// ── Bootstrap guard: rawCurrent === 0 (strict equality) ──────────────────────
// Kill: `rawCurrent === 1` or `rawCurrent >= 0` mutations

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

  it('bootstraps when rawCurrent is exactly 0 and config+permission_mode+max_sessions present', () => {
    const db = makeMockDb({
      userVersion: 0,
      hasConfigTable: true,
      colMap: {
        agents: ['id', 'name', 'scope', 'permission_mode', 'max_sessions'],
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

  it('bootstraps when BOTH permission_mode AND max_sessions are present', () => {
    const db = makeMockDb({
      userVersion: 0,
      hasConfigTable: true,
      colMap: {
        agents: ['id', 'name', 'scope', 'permission_mode', 'max_sessions'],
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
    expect(result).toBe(31)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.some((s: string) => s === 'ADD COLUMN permission_mode' || s.includes('ADD COLUMN permission_mode'))).toBe(true)
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
    for (const [start, expected] of [[27, 4], [28, 3], [24, 7]]) {
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
    // At version 27: v28, v29, v30, v31 run → 4 SAVEPOINTs → return 4
    const db = makeMockDb({ userVersion: 27, colMap: { agents: ['id', 'name'], sessions: ['id', 'status'] } })
    const result = migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    const savepointCount = calls.filter((s: string) => /^SAVEPOINT m\d+$/.test(s)).length
    // Return value must equal the number of savepoints (one per migration)
    expect(result).toBe(savepointCount)
    expect(result).toBe(4)
    expect(result).not.toBe(0)
    expect(result).not.toBe(3)
    expect(result).not.toBe(5)
  })

  it('return value is 1 (not 0 or 2) when exactly one migration runs (v31 only)', () => {
    const db = makeMockDb({ userVersion: 30, colMap: { sessions: ['id', 'status'] } })
    const result = migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    expect(result).toBe(1)
    expect(result).not.toBe(0)
    expect(result).not.toBe(2)
  })

  it('return value decreases by 1 per additional starting version', () => {
    const total = CURRENT_SCHEMA_VERSION // 31

    const dbV0 = makeMockDb({ userVersion: 0 })
    expect(migrateDb(dbV0 as unknown as import('./migration-db-adapter').MigrationDb)).toBe(total)

    const dbV1 = makeMockDb({ userVersion: 1 })
    expect(migrateDb(dbV1 as unknown as import('./migration-db-adapter').MigrationDb)).toBe(total - 1)

    const dbV2 = makeMockDb({ userVersion: 2, colMap: { agents: ['id', 'system_prompt', 'system_prompt_suffix', 'thinking_mode', 'allowed_tools'] } })
    expect(migrateDb(dbV2 as unknown as import('./migration-db-adapter').MigrationDb)).toBe(total - 2)
  })
})
