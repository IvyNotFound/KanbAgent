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
