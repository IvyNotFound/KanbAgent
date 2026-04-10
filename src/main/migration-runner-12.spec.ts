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
