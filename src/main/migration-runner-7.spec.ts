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
