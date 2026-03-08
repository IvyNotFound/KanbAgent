import { describe, it, expect, vi, beforeEach } from 'vitest'
import { migrateDb } from './migration'

// ── Helpers (duplicate-free, minimal) ─────────────────────────────────────────

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

// ── v3 — exact SQL strings ────────────────────────────────────────────────────

describe('migrateDb v3 — exact SQL strings', () => {
  beforeEach(() => vi.clearAllMocks())

  it('inserts exact config keys (claude_md_commit, schema_version)', () => {
    const db = makeMockDb({ userVersion: 2, tableMap: { config: false }, colMap: { agents: ['id', 'name', 'system_prompt', 'system_prompt_suffix', 'thinking_mode', 'allowed_tools'] } })
    migrateDb(db as unknown as import('sql.js').Database)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.some((s: string) => s.includes("'claude_md_commit'") && s.includes("'schema_version'"))).toBe(true)
  })

  it('creates config table with key, value, updated_at columns', () => {
    const db = makeMockDb({ userVersion: 2, tableMap: { config: false }, colMap: { agents: ['id', 'name', 'system_prompt', 'system_prompt_suffix', 'thinking_mode', 'allowed_tools'] } })
    migrateDb(db as unknown as import('sql.js').Database)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    const createConfig = calls.find((s: string) => s.includes('CREATE TABLE config'))
    expect(createConfig).toBeDefined()
    expect(createConfig).toContain('key')
    expect(createConfig).toContain('value')
    expect(createConfig).toContain('updated_at')
  })
})

// ── v4 — perimetres table guard ───────────────────────────────────────────────

describe('migrateDb v4 — perimetres table guard', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates perimetres table when absent', () => {
    const db = makeMockDb({
      userVersion: 3,
      tableMap: { config: true, perimetres: false },
      colMap: { agents: ['id', 'name', 'system_prompt', 'system_prompt_suffix', 'thinking_mode', 'allowed_tools'] },
    })
    migrateDb(db as unknown as import('sql.js').Database)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.some((s: string) => s.includes('CREATE TABLE perimetres'))).toBe(true)
  })

  it('inserts front-vuejs, back-electron, global into perimetres', () => {
    const db = makeMockDb({
      userVersion: 3,
      tableMap: { config: true, perimetres: false },
      colMap: { agents: ['id', 'name', 'system_prompt', 'system_prompt_suffix', 'thinking_mode', 'allowed_tools'] },
    })
    migrateDb(db as unknown as import('sql.js').Database)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    const insertCall = calls.find((s: string) => s.includes('INSERT INTO perimetres'))
    expect(insertCall).toBeDefined()
    expect(insertCall).toContain('front-vuejs')
    expect(insertCall).toContain('back-electron')
    expect(insertCall).toContain('global')
  })

  it('skips perimetres creation when table already exists', () => {
    const db = makeMockDb({
      userVersion: 3,
      tableMap: { config: true, perimetres: true },
      colMap: { agents: ['id', 'name', 'system_prompt', 'system_prompt_suffix', 'thinking_mode', 'allowed_tools'] },
    })
    migrateDb(db as unknown as import('sql.js').Database)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.every((s: string) => !s.includes('CREATE TABLE perimetres'))).toBe(true)
  })
})

// ── v5 — exact index names ────────────────────────────────────────────────────

describe('migrateDb v5 — exact index names', () => {
  beforeEach(() => vi.clearAllMocks())

  function createV4Db() {
    return makeMockDb({
      userVersion: 4,
      colMap: { agents: ['id', 'name', 'system_prompt', 'system_prompt_suffix', 'thinking_mode', 'allowed_tools'] },
    })
  }

  it('creates idx_sessions_agent_id', () => {
    const db = createV4Db()
    migrateDb(db as unknown as import('sql.js').Database)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.some((s: string) => s.includes('idx_sessions_agent_id'))).toBe(true)
  })

  it('creates idx_sessions_started_at DESC', () => {
    const db = createV4Db()
    migrateDb(db as unknown as import('sql.js').Database)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.some((s: string) => s.includes('idx_sessions_started_at') && s.includes('DESC'))).toBe(true)
  })

  it('creates idx_agent_logs_agent_id', () => {
    const db = createV4Db()
    migrateDb(db as unknown as import('sql.js').Database)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.some((s: string) => s.includes('idx_agent_logs_agent_id'))).toBe(true)
  })

  it('creates idx_task_comments_task_id', () => {
    const db = createV4Db()
    migrateDb(db as unknown as import('sql.js').Database)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.some((s: string) => s.includes('idx_task_comments_task_id'))).toBe(true)
  })

  it('creates idx_tasks_updated_at DESC', () => {
    const db = createV4Db()
    migrateDb(db as unknown as import('sql.js').Database)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.some((s: string) => s.includes('idx_tasks_updated_at') && s.includes('DESC'))).toBe(true)
  })

  it('creates idx_sessions_agent_started composite index', () => {
    const db = createV4Db()
    migrateDb(db as unknown as import('sql.js').Database)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.some((s: string) => s.includes('idx_sessions_agent_started') && s.includes('agent_id, started_at DESC'))).toBe(true)
  })
})

// ── v6 — task_agents table guard ─────────────────────────────────────────────

describe('migrateDb v6 — task_agents table guard', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates task_agents table when absent', () => {
    const db = makeMockDb({
      userVersion: 5,
      tableMap: { task_agents: false },
      colMap: { agents: ['id', 'name', 'system_prompt', 'system_prompt_suffix', 'thinking_mode', 'allowed_tools'] },
    })
    migrateDb(db as unknown as import('sql.js').Database)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.some((s: string) => s.includes('task_agents'))).toBe(true)
  })

  it('skips task_agents creation when table already exists', () => {
    const db = makeMockDb({
      userVersion: 5,
      tableMap: { task_agents: true },
      colMap: { agents: ['id', 'name', 'system_prompt', 'system_prompt_suffix', 'thinking_mode', 'allowed_tools'] },
    })
    migrateDb(db as unknown as import('sql.js').Database)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    // Only SAVEPOINT/RELEASE/PRAGMA calls should exist — no CREATE TABLE task_agents
    expect(calls.every((s: string) => !s.includes('CREATE TABLE') || !s.includes('task_agents'))).toBe(true)
  })

  it('creates idx_task_agents_task_id and idx_task_agents_agent_id indexes', () => {
    const db = makeMockDb({
      userVersion: 5,
      tableMap: { task_agents: false },
      colMap: { agents: ['id', 'name', 'system_prompt', 'system_prompt_suffix', 'thinking_mode', 'allowed_tools'] },
    })
    migrateDb(db as unknown as import('sql.js').Database)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.some((s: string) => s.includes('idx_task_agents_task_id'))).toBe(true)
    expect(calls.some((s: string) => s.includes('idx_task_agents_agent_id'))).toBe(true)
  })

  it('includes UNIQUE(task_id, agent_id) constraint in task_agents DDL', () => {
    const db = makeMockDb({
      userVersion: 5,
      tableMap: { task_agents: false },
      colMap: { agents: ['id', 'name', 'system_prompt', 'system_prompt_suffix', 'thinking_mode', 'allowed_tools'] },
    })
    migrateDb(db as unknown as import('sql.js').Database)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    const ddl = calls.find((s: string) => s.includes('CREATE TABLE IF NOT EXISTS task_agents'))
    expect(ddl).toBeDefined()
    expect(ddl).toContain('UNIQUE')
    expect(ddl).toContain("'primary'")
    expect(ddl).toContain("'support'")
    expect(ddl).toContain("'reviewer'")
  })
})

// ── v17-v19 — agents column guards ───────────────────────────────────────────

describe('migrateDb v17 — auto_launch column guard', () => {
  beforeEach(() => vi.clearAllMocks())

  it('adds auto_launch when column is absent', () => {
    const db = makeMockDb({
      userVersion: 16,
      colMap: { agents: ['id', 'name', 'system_prompt', 'system_prompt_suffix', 'thinking_mode', 'allowed_tools'] },
    })
    migrateDb(db as unknown as import('sql.js').Database)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.some((s: string) => s.includes('ADD COLUMN auto_launch'))).toBe(true)
  })

  it('skips auto_launch when column already present', () => {
    const db = makeMockDb({
      userVersion: 16,
      colMap: { agents: ['id', 'name', 'auto_launch', 'system_prompt', 'system_prompt_suffix', 'thinking_mode', 'allowed_tools'] },
    })
    migrateDb(db as unknown as import('sql.js').Database)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.every((s: string) => !s.includes('ADD COLUMN auto_launch'))).toBe(true)
  })

  it('adds auto_launch with NOT NULL DEFAULT 1', () => {
    const db = makeMockDb({
      userVersion: 16,
      colMap: { agents: ['id', 'name'] },
    })
    migrateDb(db as unknown as import('sql.js').Database)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    const col = calls.find((s: string) => s.includes('ADD COLUMN auto_launch'))
    expect(col).toBeDefined()
    expect(col).toContain('NOT NULL DEFAULT 1')
  })

  it('skips when agents table does not exist (PRAGMA returns empty)', () => {
    const db = makeMockDb({ userVersion: 16, colMap: {} })
    migrateDb(db as unknown as import('sql.js').Database)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.every((s: string) => !s.includes('ADD COLUMN auto_launch'))).toBe(true)
  })
})

describe('migrateDb v18 — permission_mode column guard', () => {
  beforeEach(() => vi.clearAllMocks())

  it('adds permission_mode when column is absent', () => {
    const db = makeMockDb({
      userVersion: 17,
      colMap: { agents: ['id', 'name', 'auto_launch'] },
    })
    migrateDb(db as unknown as import('sql.js').Database)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.some((s: string) => s.includes('ADD COLUMN permission_mode'))).toBe(true)
  })

  it('skips permission_mode when already present', () => {
    const db = makeMockDb({
      userVersion: 17,
      colMap: { agents: ['id', 'name', 'auto_launch', 'permission_mode'] },
    })
    migrateDb(db as unknown as import('sql.js').Database)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.every((s: string) => !s.includes('ADD COLUMN permission_mode'))).toBe(true)
  })

  it("adds permission_mode CHECK ('default', 'auto') with DEFAULT 'default'", () => {
    const db = makeMockDb({
      userVersion: 17,
      colMap: { agents: ['id', 'name'] },
    })
    migrateDb(db as unknown as import('sql.js').Database)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    const col = calls.find((s: string) => s.includes('ADD COLUMN permission_mode'))
    expect(col).toBeDefined()
    expect(col).toContain("'default'")
    expect(col).toContain("'auto'")
  })
})

describe('migrateDb v19 — max_sessions column guard', () => {
  beforeEach(() => vi.clearAllMocks())

  it('adds max_sessions when column is absent', () => {
    const db = makeMockDb({
      userVersion: 18,
      colMap: { agents: ['id', 'name', 'auto_launch', 'permission_mode'] },
    })
    migrateDb(db as unknown as import('sql.js').Database)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.some((s: string) => s.includes('ADD COLUMN max_sessions'))).toBe(true)
  })

  it('skips max_sessions when already present', () => {
    const db = makeMockDb({
      userVersion: 18,
      colMap: { agents: ['id', 'name', 'auto_launch', 'permission_mode', 'max_sessions'] },
    })
    migrateDb(db as unknown as import('sql.js').Database)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    expect(calls.every((s: string) => !s.includes('ADD COLUMN max_sessions'))).toBe(true)
  })

  it('adds max_sessions with NOT NULL DEFAULT 3', () => {
    const db = makeMockDb({
      userVersion: 18,
      colMap: { agents: ['id', 'name'] },
    })
    migrateDb(db as unknown as import('sql.js').Database)
    const calls = db.run.mock.calls.map((c: string[]) => c[0])
    const col = calls.find((s: string) => s.includes('ADD COLUMN max_sessions'))
    expect(col).toBeDefined()
    expect(col).toContain('NOT NULL DEFAULT 3')
  })
})

