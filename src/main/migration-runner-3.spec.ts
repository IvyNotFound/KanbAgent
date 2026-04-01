import { describe, it, expect, vi, beforeEach } from 'vitest'
import { migrateDb } from './migration'

// ── Helpers (shared with migration-runner-2.spec.ts) ─────────────────────────

function makeMockDb({
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
  let currentVersion = userVersion

  const exec = vi.fn().mockImplementation((query: string) => {
    if (query.includes('PRAGMA user_version')) {
      return [{ columns: ['user_version'], values: [[currentVersion]] }]
    }
    if (query.includes("key = 'schema_version'")) {
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

// ── v20 — sessions columns guard ─────────────────────────────────────────────

describe('migrateDb v20 — sessions cost/duration/turns guard', () => {
  beforeEach(() => vi.clearAllMocks())

  it('adds cost_usd, duration_ms, num_turns when all missing', () => {
    const db = makeMockDb({
      userVersion: 19,
      colMap: { sessions: ['id', 'agent_id', 'status'] },
    })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.some((s: string) => s.includes('ADD COLUMN cost_usd'))).toBe(true)
    expect(calls.some((s: string) => s.includes('ADD COLUMN duration_ms'))).toBe(true)
    expect(calls.some((s: string) => s.includes('ADD COLUMN num_turns'))).toBe(true)
  })

  it('skips all three when columns already present', () => {
    const db = makeMockDb({
      userVersion: 19,
      colMap: { sessions: ['id', 'agent_id', 'status', 'cost_usd', 'duration_ms', 'num_turns'] },
    })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.every((s: string) => !s.includes('ADD COLUMN cost_usd'))).toBe(true)
    expect(calls.every((s: string) => !s.includes('ADD COLUMN duration_ms'))).toBe(true)
    expect(calls.every((s: string) => !s.includes('ADD COLUMN num_turns'))).toBe(true)
  })

  it('adds only missing columns (partial state)', () => {
    const db = makeMockDb({
      userVersion: 19,
      colMap: { sessions: ['id', 'cost_usd'] }, // duration_ms and num_turns missing
    })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.every((s: string) => !s.includes('ADD COLUMN cost_usd'))).toBe(true)
    expect(calls.some((s: string) => s.includes('ADD COLUMN duration_ms'))).toBe(true)
    expect(calls.some((s: string) => s.includes('ADD COLUMN num_turns'))).toBe(true)
  })

  it('skips when sessions table does not exist (PRAGMA returns empty)', () => {
    const db = makeMockDb({ userVersion: 19, colMap: {} })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.every((s: string) => !s.includes('ADD COLUMN cost_usd'))).toBe(true)
  })
})

// ── v21 — task_links indexes ──────────────────────────────────────────────────

describe('migrateDb v21 — task_links indexes', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates idx_task_links_from_task and idx_task_links_to_task', () => {
    const db = makeMockDb({ userVersion: 20 })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.some((s: string) => s.includes('idx_task_links_from_task') && s.includes('from_task'))).toBe(true)
    expect(calls.some((s: string) => s.includes('idx_task_links_to_task') && s.includes('to_task'))).toBe(true)
  })
})

// ── v22 — FTS4 virtual table + triggers ───────────────────────────────────────

describe('migrateDb v22 — FTS4 tasks_fts', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates tasks_fts USING fts4(titre, description)', () => {
    const db = makeMockDb({ userVersion: 21 })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.some((s: string) => s.includes('tasks_fts USING fts4'))).toBe(true)
    expect(calls.some((s: string) => s.includes('titre') && s.includes('tasks_fts'))).toBe(true)
  })

  it('creates all three triggers: tasks_fts_ai, tasks_fts_au, tasks_fts_ad', () => {
    const db = makeMockDb({ userVersion: 21 })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.some((s: string) => s.includes('tasks_fts_ai'))).toBe(true)
    expect(calls.some((s: string) => s.includes('tasks_fts_au'))).toBe(true)
    expect(calls.some((s: string) => s.includes('tasks_fts_ad'))).toBe(true)
  })

  it('inserts initial data from tasks into tasks_fts', () => {
    const db = makeMockDb({ userVersion: 21 })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.some((s: string) => s.includes('INSERT INTO tasks_fts') && s.includes('SELECT'))).toBe(true)
  })
})

// ── v23 — system_prompt_suffix REPLACE ───────────────────────────────────────

describe('migrateDb v23 — system_prompt_suffix REPLACE', () => {
  beforeEach(() => vi.clearAllMocks())

  it('runs UPDATE agents with REPLACE on system_prompt_suffix', () => {
    const db = makeMockDb({ userVersion: 22 })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.some((s: string) => s.includes('UPDATE agents') && s.includes('REPLACE') && s.includes('system_prompt_suffix'))).toBe(true)
  })

  it('targets agents WHERE system_prompt_suffix LIKE dbstart.js', () => {
    const db = makeMockDb({ userVersion: 22 })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    const updateCall = calls.find((s: string) => s.includes('system_prompt_suffix') && s.includes('LIKE'))
    expect(updateCall).toBeDefined()
    expect(updateCall).toContain('scripts/dbstart.js')
  })
})

// ── v25 — exact agent prompt patches ─────────────────────────────────────────

describe('migrateDb v25 — agent prompt patching', () => {
  beforeEach(() => vi.clearAllMocks())

  function createEnglishDbV24() {
    return makeMockDb({
      userVersion: 24,
      tableMap: { perimetres: false, scopes: true },
      colMap: {
        scopes: ['id', 'name', 'folder', 'active'],
        agents: ['id', 'name', 'scope'],
        sessions: ['id', 'status'],
        tasks: ['id', 'title', 'status', 'agent_creator_id', 'agent_assigned_id', 'agent_validator_id', 'scope'],
        task_comments: ['id', 'task_id', 'content'],
        locks: ['id', 'file'],
        agent_logs: ['id', 'level', 'files'],
      },
    })
  }

  it('runs UPDATE agents SET system_prompt_suffix REPLACE for contenu', () => {
    const db = createEnglishDbV24()
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.some((s: string) => s.includes('contenu') && s.includes('content') && s.includes('REPLACE'))).toBe(true)
  })

  it('runs UPDATE agents SET system_prompt REPLACE for fichier column', () => {
    const db = createEnglishDbV24()
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.some((s: string) => s.includes('system_prompt') && s.includes('fichier') && s.includes('file'))).toBe(true)
  })

  it('runs UPDATE for statut → status replacement in prompts', () => {
    const db = createEnglishDbV24()
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.some((s: string) => s.includes("'SET statut='''"))) .toBe(true)
  })

  it('runs UPDATE for titre → title replacement in system_prompt', () => {
    const db = createEnglishDbV24()
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.some((s: string) => s.includes("'- titre :'") || s.includes("'- titre:'"))).toBe(true)
  })

  it('drops old tasks_fts and rebuilds with title (not titre)', () => {
    const db = createEnglishDbV24()
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.some((s: string) => s === 'DROP TABLE IF EXISTS tasks_fts')).toBe(true)
    expect(calls.some((s: string) => s.includes('fts4(title, description)'))).toBe(true)
  })
})

// ── v26 — drop locks ──────────────────────────────────────────────────────────

describe('migrateDb v26 — drop locks table', () => {
  beforeEach(() => vi.clearAllMocks())

  it('drops idx_locks_released_at index', () => {
    const db = makeMockDb({ userVersion: 25 })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.some((s: string) => s === 'DROP INDEX IF EXISTS idx_locks_released_at')).toBe(true)
  })

  it('drops locks table', () => {
    const db = makeMockDb({ userVersion: 25 })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.some((s: string) => s === 'DROP TABLE IF EXISTS locks')).toBe(true)
  })

  it('updates user_version to 31 (v26–v31 apply from v25)', () => {
    const db = makeMockDb({ userVersion: 25 })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    expect(db._getVersion()).toBe(31)
  })
})

// ── Rollback on error — early migrations ─────────────────────────────────────

describe('migrateDb — SAVEPOINT rollback on early migrations', () => {
  beforeEach(() => vi.clearAllMocks())

  it('rolls back v3 and re-throws when CREATE TABLE config fails', () => {
    const db = makeMockDb({
      userVersion: 2,
      colMap: { agents: ['id', 'name', 'system_prompt', 'system_prompt_suffix', 'thinking_mode', 'allowed_tools'] },
    })
    const error = new Error('CREATE TABLE config failed')
    db.run.mockImplementation((sql: string) => {
      const m = sql.match(/PRAGMA user_version\s*=\s*(\d+)/)
      if (m) { db._getVersion; return }
      if (sql.includes('CREATE TABLE config')) throw error
    })
    expect(() => migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)).toThrow('CREATE TABLE config failed')
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.some((s: string) => s.includes('ROLLBACK TO SAVEPOINT m3'))).toBe(true)
    expect(calls.some((s: string) => s === 'RELEASE SAVEPOINT m3')).toBe(true)
  })

  it('rolls back v5 and re-throws when index creation fails', () => {
    const db = makeMockDb({ userVersion: 4 })
    const error = new Error('index creation failed')
    db.run.mockImplementation((sql: string) => {
      const m = sql.match(/PRAGMA user_version\s*=\s*(\d+)/)
      if (m) return
      if (sql.includes('idx_sessions_agent_id')) throw error
    })
    expect(() => migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)).toThrow('index creation failed')
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.some((s: string) => s.includes('ROLLBACK TO SAVEPOINT m5'))).toBe(true)
  })
})

// ── v27 — missing indexes ─────────────────────────────────────────────────────

describe('migrateDb v27 — missing indexes on critical columns', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates idx_tasks_status ON tasks(status)', () => {
    const db = makeMockDb({ userVersion: 26 })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.some((s: string) => s.includes('idx_tasks_status') && s.includes('tasks(status)'))).toBe(true)
  })

  it('creates idx_sessions_status ON sessions(status)', () => {
    const db = makeMockDb({ userVersion: 26 })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.some((s: string) => s.includes('idx_sessions_status') && s.includes('sessions(status)'))).toBe(true)
  })

  it('creates idx_sessions_agent_status composite ON sessions(agent_id, status, started_at DESC)', () => {
    const db = makeMockDb({ userVersion: 26 })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.some((s: string) => s.includes('idx_sessions_agent_status') && s.includes('agent_id, status, started_at DESC'))).toBe(true)
  })

  it('creates idx_task_comments_agent_id ON task_comments(agent_id)', () => {
    const db = makeMockDb({ userVersion: 26 })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.some((s: string) => s.includes('idx_task_comments_agent_id') && s.includes('task_comments(agent_id)'))).toBe(true)
  })

  it('updates user_version to 31 (v27–v31 apply from v26)', () => {
    const db = makeMockDb({ userVersion: 26 })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    expect(db._getVersion()).toBe(31)
  })

  it('uses CREATE INDEX IF NOT EXISTS for all indexes', () => {
    const db = makeMockDb({ userVersion: 26 })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    const v27Indexes = calls.filter((s: string) =>
      s.includes('idx_tasks_status') || s.includes('idx_sessions_status') ||
      s.includes('idx_sessions_agent_status') || s.includes('idx_task_comments_agent_id')
    )
    expect(v27Indexes.every((s: string) => s.includes('IF NOT EXISTS'))).toBe(true)
  })
})

// ── v28 — agents.worktree_enabled + config worktree_default (T1142) ─────────

describe('migrateDb v28 — agents.worktree_enabled + worktree_default config', () => {
  beforeEach(() => vi.clearAllMocks())

  it('adds worktree_enabled column when missing', () => {
    const db = makeMockDb({
      userVersion: 27,
      colMap: { agents: ['id', 'name', 'type', 'scope'] },
    })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.some((s: string) => s.includes('ADD COLUMN worktree_enabled'))).toBe(true)
  })

  it('skips column when worktree_enabled already exists', () => {
    const db = makeMockDb({
      userVersion: 27,
      colMap: { agents: ['id', 'name', 'worktree_enabled'] },
    })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.every((s: string) => !s.includes('ADD COLUMN worktree_enabled'))).toBe(true)
  })

  it('inserts worktree_default config key', () => {
    const db = makeMockDb({
      userVersion: 27,
      colMap: { agents: ['id', 'name'] },
    })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.some((s: string) => s.includes('worktree_default') && s.includes("'1'"))).toBe(true)
  })

  it('updates user_version to 31 (v28–v31 apply from v27)', () => {
    const db = makeMockDb({
      userVersion: 27,
      colMap: { agents: ['id', 'name'] },
    })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    expect(db._getVersion()).toBe(31)
  })
})

// ── v29 — fix tasks.session_id FK (sessions_backup_i18n → sessions) ──────────

describe('migrateDb v29 — fix tasks.session_id FK reference', () => {
  beforeEach(() => vi.clearAllMocks())

  it('is a no-op when tasks table has no sessions_backup_i18n ref (idempotent)', () => {
    const db = makeMockDb({ userVersion: 28 })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.every((s: string) => !s.includes('sessions_backup_i18n'))).toBe(true)
  })

  it('updates user_version to 31 (v29–v31 apply from v28)', () => {
    const db = makeMockDb({ userVersion: 28 })
    migrateDb(db as unknown as import('./migration-db-adapter').MigrationDb)
    expect(db._getVersion()).toBe(31)
  })
})
