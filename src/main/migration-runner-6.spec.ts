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
        sessions: ['id', 'status'],
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

  it('returns 1 when exactly one migration is pending (v31 only)', () => {
    const db = makeMockDb({
      userVersion: 30,
      colMap: { sessions: ['id', 'status'] },
    })
    const result = migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    expect(result).toBe(1)
  })

  it('returns 4 when four migrations are pending (v28, v29, v30, v31)', () => {
    const db = makeMockDb({ userVersion: 27, colMap: { agents: ['id', 'name'], sessions: ['id', 'status'] } })
    const result = migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    expect(result).toBe(4) // v28, v29, v30, v31
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

  it('returns 8 for genuine legacy bootstrap (v0 + config + permission_mode + max_sessions = runs v24..v31)', () => {
    const db = makeMockDb({
      userVersion: 0,
      hasConfigTable: true,
      colMap: {
        agent_groups: ['id', 'name', 'sort_order', 'created_at'],
        agents: ['id', 'name', 'scope', 'system_prompt', 'system_prompt_suffix',
          'thinking_mode', 'allowed_tools', 'auto_launch', 'permission_mode', 'max_sessions'],
        sessions: ['id', 'status'],
        tasks: ['id', 'title', 'status'],
        task_comments: ['id', 'task_id', 'content'],
        locks: ['id', 'file'],
        agent_logs: ['id', 'level', 'files'],
      },
      tableMap: { config: true },
    })
    const result = migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    expect(result).toBe(8) // v24, v25, v26, v27, v28, v29, v30, v31
    expect(result).not.toBe(7)
    expect(result).not.toBe(9)
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

describe('migrateDb v22 — FTS4 exact trigger SQL', () => {
  beforeEach(() => vi.clearAllMocks())

  it('INSERT trigger (tasks_fts_ai) uses new.id, new.titre, new.description', () => {
    const db = makeMockDb({ userVersion: 21 })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    const aiTrigger = calls.find((s: string) => s.includes('tasks_fts_ai'))
    expect(aiTrigger).toBeDefined()
    expect(aiTrigger).toContain('new.id')
    expect(aiTrigger).toContain('new.titre')
    expect(aiTrigger).toContain('new.description')
  })

  it('UPDATE trigger (tasks_fts_au) deletes old.id and inserts new.id', () => {
    const db = makeMockDb({ userVersion: 21 })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    const auTrigger = calls.find((s: string) => s.includes('tasks_fts_au'))
    expect(auTrigger).toBeDefined()
    expect(auTrigger).toContain('old.id')
    expect(auTrigger).toContain('new.id')
  })

  it('DELETE trigger (tasks_fts_ad) deletes old.id', () => {
    const db = makeMockDb({ userVersion: 21 })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    const adTrigger = calls.find((s: string) => s.includes('tasks_fts_ad'))
    expect(adTrigger).toBeDefined()
    expect(adTrigger).toContain('old.id')
    expect(adTrigger).toContain('DELETE FROM tasks_fts')
  })

  it('INSERT initial data uses titre, description columns (not title)', () => {
    const db = makeMockDb({ userVersion: 21 })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    const seedInsert = calls.find((s: string) => s.includes('INSERT INTO tasks_fts') && s.includes('SELECT'))
    expect(seedInsert).toBeDefined()
    expect(seedInsert).toContain('titre')
    expect(seedInsert).toContain('description')
  })

  it('virtual table DDL uses fts4(titre, description)', () => {
    const db = makeMockDb({ userVersion: 21 })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    const ftsCreate = calls.find((s: string) => s.includes('CREATE VIRTUAL TABLE'))
    expect(ftsCreate).toBeDefined()
    expect(ftsCreate).toContain('fts4(titre, description)')
  })
})

// ── v23 — exact REPLACE old string ───────────────────────────────────────────

describe('migrateDb v23 — exact REPLACE strings', () => {
  beforeEach(() => vi.clearAllMocks())

  it('replaces exact dbstart.js startup line (old string preserved)', () => {
    const db = makeMockDb({ userVersion: 22 })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    const updateCall = calls.find((s: string) => s.includes('system_prompt_suffix') && s.includes('REPLACE'))
    expect(updateCall).toBeDefined()
    expect(updateCall).toContain('On startup: node scripts/dbstart.js <agent-name>')
    expect(updateCall).toContain('LIKE')
  })
})

// ── v25 — task_links OR condition: dépend_de alone triggers recreation ────────

describe('migrateDb v25 — task_links OR condition', () => {
  beforeEach(() => vi.clearAllMocks())

  it('recreates task_links when schema contains only dépend_de (not bloque)', () => {
    const schemaWithDependeDe = `CREATE TABLE task_links (
      id INTEGER PRIMARY KEY,
      from_task INTEGER NOT NULL,
      to_task INTEGER NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('dépend_de','lié_à')),
      created_at DATETIME
    )`
    const db = makeMockDb({
      userVersion: 24,
      taskLinksSql: schemaWithDependeDe,
      tableMap: { perimetres: false },
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
    expect(calls.some((s: string) => s.includes('DROP TABLE task_links'))).toBe(true)
  })

  it('recreates task_links when schema contains only bloque (not dépend_de)', () => {
    const schemaWithBloque = `CREATE TABLE task_links (
      id INTEGER PRIMARY KEY,
      from_task INTEGER NOT NULL,
      to_task INTEGER NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('bloque','duplique')),
      created_at DATETIME
    )`
    const db = makeMockDb({
      userVersion: 24,
      taskLinksSql: schemaWithBloque,
      tableMap: { perimetres: false },
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

  it('task_links INSERT maps bloque → blocks', () => {
    const frenchSchema = `CREATE TABLE task_links (
      id INTEGER PRIMARY KEY,
      from_task INTEGER NOT NULL,
      to_task INTEGER NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('bloque','dépend_de','lié_à','duplique')),
      created_at DATETIME
    )`
    const db = makeMockDb({
      userVersion: 24,
      taskLinksSql: frenchSchema,
      tableMap: { perimetres: false },
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
    const insertSelect = calls.find((s: string) => s.includes('INSERT INTO task_links_new') && s.includes('SELECT'))
    expect(insertSelect).toBeDefined()
    expect(insertSelect).toContain("'blocks'")
    expect(insertSelect).toContain("'depends_on'")
    expect(insertSelect).toContain("'related_to'")
    expect(insertSelect).toContain("'duplicates'")
    expect(insertSelect).toContain("'bloque'")
    expect(insertSelect).toContain("'dépend_de'")
  })
})

// ── v25 — perimetres sub-column renames (dossier→folder, actif→active) ────────

describe('migrateDb v25 — perimetres column renames', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renames perimetres.dossier → folder', () => {
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
    expect(calls.some((s: string) => s.includes('RENAME COLUMN dossier TO folder'))).toBe(true)
  })

  it('renames perimetres.actif → active', () => {
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
    expect(calls.some((s: string) => s.includes('RENAME COLUMN actif TO active'))).toBe(true)
  })

  it('skips dossier rename when column is already folder', () => {
    const db = makeMockDb({
      userVersion: 24,
      tableMap: { perimetres: true, scopes: false },
      colMap: {
        perimetres: ['id', 'name', 'folder', 'actif'], // dossier already renamed
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
    expect(calls.every((s: string) => !s.includes('RENAME COLUMN dossier TO folder'))).toBe(true)
  })

  it('skips actif rename when column is already active', () => {
    const db = makeMockDb({
      userVersion: 24,
      tableMap: { perimetres: true, scopes: false },
      colMap: {
        perimetres: ['id', 'name', 'dossier', 'active'], // actif already renamed
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
    expect(calls.every((s: string) => !s.includes('RENAME COLUMN actif TO active'))).toBe(true)
  })
})

// ── v25 — FTS4 triggers rebuilt with 'title' (not 'titre') ───────────────────

describe('migrateDb v25 — FTS4 rebuild with English column names', () => {
  beforeEach(() => vi.clearAllMocks())

  function createEnglishDbV24() {
    return makeMockDb({
      userVersion: 24,
      tableMap: { perimetres: false, scopes: true },
      colMap: {
        scopes: ['id', 'name', 'folder', 'active'],
        agents: ['id', 'name', 'scope'],
        sessions: ['id', 'status'],
        tasks: ['id', 'title', 'status'],
        task_comments: ['id', 'content'],
        locks: ['id', 'file'],
        agent_logs: ['id', 'level', 'files'],
      },
    })
  }

  it('drops tasks_fts_ai, tasks_fts_au, tasks_fts_ad triggers', () => {
    const db = createEnglishDbV24()
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.some((s: string) => s === 'DROP TRIGGER IF EXISTS tasks_fts_ai')).toBe(true)
    expect(calls.some((s: string) => s === 'DROP TRIGGER IF EXISTS tasks_fts_au')).toBe(true)
    expect(calls.some((s: string) => s === 'DROP TRIGGER IF EXISTS tasks_fts_ad')).toBe(true)
  })

  it('new tasks_fts_ai trigger uses new.title (not new.titre)', () => {
    const db = createEnglishDbV24()
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    // Find the CREATE TRIGGER after the DROP TABLE IF EXISTS tasks_fts
    const triggers = calls.filter((s: string) => s.includes('CREATE TRIGGER') && s.includes('tasks_fts'))
    const aiTrigger = triggers.find((s: string) => s.includes('tasks_fts_ai'))
    expect(aiTrigger).toBeDefined()
    expect(aiTrigger).toContain('new.title')
    expect(aiTrigger).not.toContain('new.titre')
  })

  it('seed INSERT uses title column (not titre)', () => {
    const db = createEnglishDbV24()
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    // Find INSERT INTO tasks_fts with SELECT that uses title
    const seedCalls = calls.filter((s: string) =>
      s.includes('INSERT INTO tasks_fts') && s.includes('SELECT') && s.includes('title')
    )
    expect(seedCalls.length).toBeGreaterThan(0)
  })
})

// ── v25 — exact prompt patches applied ───────────────────────────────────────

describe('migrateDb v25 — exact agent_assigned_id prompt patch', () => {
  beforeEach(() => vi.clearAllMocks())

  function createEnglishDbV24() {
    return makeMockDb({
      userVersion: 24,
      tableMap: { perimetres: false, scopes: true },
      colMap: {
        scopes: ['id', 'name', 'folder', 'active'],
        agents: ['id', 'name', 'scope'],
        sessions: ['id', 'status'],
        tasks: ['id', 'title', 'status'],
        task_comments: ['id', 'content'],
        locks: ['id', 'file'],
        agent_logs: ['id', 'level', 'files'],
      },
    })
  }

  it('patches agent_assigne_id → agent_assigned_id in system_prompt_suffix', () => {
    const db = createEnglishDbV24()
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.some((s: string) =>
      s.includes('agent_assigne_id') && s.includes('agent_assigned_id') && s.includes('REPLACE')
    )).toBe(true)
  })

  it('patches agent_createur_id → agent_creator_id in system_prompt', () => {
    const db = createEnglishDbV24()
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.some((s: string) =>
      s.includes('agent_createur_id') && s.includes('agent_creator_id')
    )).toBe(true)
  })

  it('patches (fichier, agent_id, session_id) → (file, agent_id, session_id) in system_prompt', () => {
    const db = createEnglishDbV24()
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.some((s: string) =>
      s.includes('fichier, agent_id, session_id') && s.includes('file, agent_id, session_id')
    )).toBe(true)
  })
})

// ── v28 — worktree_enabled exact column definition ────────────────────────────

describe('migrateDb v28 — worktree_enabled exact column definition', () => {
  beforeEach(() => vi.clearAllMocks())

  it("adds worktree_enabled as INTEGER column", () => {
    const db = makeMockDb({
      userVersion: 27,
      colMap: { agents: ['id', 'name'] },
    })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    const col = calls.find((s: string) => s.includes('ADD COLUMN worktree_enabled'))
    expect(col).toBeDefined()
    expect(col).toContain('INTEGER')
    // Column name must be exact: worktree_enabled, not worktree_enable or worktree
    expect(col).toContain('worktree_enabled')
  })

  it("inserts worktree_default='1' using INSERT OR IGNORE", () => {
    const db = makeMockDb({
      userVersion: 27,
      colMap: { agents: ['id', 'name'] },
    })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    const configInsert = calls.find((s: string) => s.includes('worktree_default'))
    expect(configInsert).toBeDefined()
    expect(configInsert).toContain('INSERT OR IGNORE')
    expect(configInsert).toContain("'worktree_default'")
    expect(configInsert).toContain("'1'")
  })
})

// ── SAVEPOINT: error stops subsequent migrations ──────────────────────────────

describe('migrateDb — error stops all subsequent migrations', () => {
  beforeEach(() => vi.clearAllMocks())

  it('stops after v27 failure — v28 and v29 are not started', () => {
    const db = makeMockDb({ userVersion: 26, colMap: { agents: ['id', 'name'] } })
    db.run.mockImplementation((sql: string) => {
      const m = sql.match(/PRAGMA user_version\s*=\s*(\d+)/)
      if (m) return
      if (sql.includes('idx_tasks_status')) throw new Error('v27 failed')
    })
    expect(() => migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)).toThrow('v27 failed')
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.some((s: string) => s === 'SAVEPOINT m27')).toBe(true)
    expect(calls.some((s: string) => s === 'SAVEPOINT m28')).toBe(false)
    expect(calls.some((s: string) => s === 'SAVEPOINT m29')).toBe(false)
  })

  it('user_version not updated to 27 when v27 throws', () => {
    const db = makeMockDb({ userVersion: 26, colMap: { agents: ['id', 'name'] } })
    db.run.mockImplementation((sql: string) => {
      const m = sql.match(/PRAGMA user_version\s*=\s*(\d+)/)
      if (m) return
      if (sql.includes('idx_tasks_status')) throw new Error('fail')
    })
    try { migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb) } catch { /* expected */ }
    expect(db._getVersion()).toBe(26)
    expect(db._getVersion()).not.toBe(27)
  })
})

// ── v6 — task_agents DDL constraints ─────────────────────────────────────────

describe('migrateDb v6 — task_agents DDL details', () => {
  beforeEach(() => vi.clearAllMocks())

  it('includes ON DELETE CASCADE for task_id FK reference', () => {
    const db = makeMockDb({
      userVersion: 5,
      tableMap: { task_agents: false },
    })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    const ddl = calls.find((s: string) => s.includes('CREATE TABLE IF NOT EXISTS task_agents'))
    expect(ddl).toBeDefined()
    expect(ddl).toContain('ON DELETE CASCADE')
  })

  it('table name is task_agents (not task_agent)', () => {
    const db = makeMockDb({
      userVersion: 5,
      tableMap: { task_agents: false },
    })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    const ddl = calls.find((s: string) => s.includes('CREATE TABLE IF NOT EXISTS task_agents'))
    expect(ddl).toBeDefined()
    expect(ddl).not.toContain('CREATE TABLE IF NOT EXISTS task_agent ')
  })
})

// ── v5 — all 9 exact index names ─────────────────────────────────────────────

describe('migrateDb v5 — all 9 exact index names', () => {
  beforeEach(() => vi.clearAllMocks())

  const v4Db = () => makeMockDb({
    userVersion: 4,
    colMap: { agents: ['id', 'name', 'system_prompt', 'system_prompt_suffix', 'thinking_mode', 'allowed_tools'] },
  })

  it('creates all 9 indexes in v5', () => {
    const db = v4Db()
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    const expectedIndexes = [
      'idx_sessions_agent_id',
      'idx_sessions_started_at',
      'idx_agent_logs_agent_id',
      'idx_agent_logs_created_at',
      'idx_locks_released_at',
      'idx_tasks_updated_at',
      'idx_tasks_agent_assigne',
      'idx_sessions_agent_started',
      'idx_task_comments_task_id',
    ]
    for (const idx of expectedIndexes) {
      expect(calls.some((s: string) => s.includes(idx)), `Missing index: ${idx}`).toBe(true)
    }
  })

  it('v5 index CREATE statements all use IF NOT EXISTS', () => {
    const db = v4Db()
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    const v5Indexes = calls.filter((s: string) => s.includes('idx_') && s.includes('ON ') && s.includes('CREATE INDEX'))
    // All v5 CREATE INDEX statements should use IF NOT EXISTS
    const v5Only = v5Indexes.filter((s: string) =>
      ['idx_sessions_agent_id', 'idx_sessions_started_at', 'idx_agent_logs_agent_id',
       'idx_agent_logs_created_at', 'idx_locks_released_at', 'idx_tasks_updated_at',
       'idx_tasks_agent_assigne', 'idx_sessions_agent_started', 'idx_task_comments_task_id'
      ].some(name => s.includes(name))
    )
    expect(v5Only.every((s: string) => s.includes('IF NOT EXISTS'))).toBe(true)
  })

  it('idx_agent_logs_created_at uses DESC', () => {
    const db = v4Db()
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.some((s: string) => s.includes('idx_agent_logs_created_at') && s.includes('DESC'))).toBe(true)
  })

  it('idx_tasks_agent_assigne uses column agent_assigne_id', () => {
    const db = v4Db()
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.some((s: string) => s.includes('idx_tasks_agent_assigne') && s.includes('agent_assigne_id'))).toBe(true)
  })
})
