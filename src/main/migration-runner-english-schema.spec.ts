import { describe, it, expect, vi, beforeEach } from 'vitest'
import { migrateDb, CURRENT_SCHEMA_VERSION } from './migration'
import type { MigrationDb } from './migration-db-adapter'

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a mock DB that handles PRAGMA table_info, sqlite_master queries,
 * and SELECT COUNT(*) queries referencing specific columns.
 *
 * The `tableSchemas` map returns SQL strings for "SELECT sql FROM sqlite_master"
 * queries, enabling schema-aware idempotency checks.
 */
function createMockDb({
  userVersion = 0,
  hasConfigTable = false,
  colMap = {} as Record<string, string[]>,
  tableMap = {} as Record<string, boolean>,
  tableSchemas = {} as Record<string, string>,
}: {
  userVersion?: number
  hasConfigTable?: boolean
  colMap?: Record<string, string[]>
  tableMap?: Record<string, boolean>
  tableSchemas?: Record<string, string>
} = {}) {
  let currentVersion = userVersion

  const exec = vi.fn().mockImplementation((query: string) => {
    if (query.includes('PRAGMA user_version')) {
      return [{ columns: ['user_version'], values: [[currentVersion]] }]
    }
    if (query.includes("key = 'schema_version'")) {
      if (hasConfigTable) return [{ columns: ['value'], values: [['23']] }]
      return []
    }
    // PRAGMA table_info(<table>) — also handles backup table names
    const tiMatch = query.match(/PRAGMA table_info\((\w+)\)/)
    if (tiMatch) {
      const tableName = tiMatch[1]
      const cols = colMap[tableName]
      if (!cols || cols.length === 0) return []
      const values = cols.map((name, idx) => [idx, name, 'TEXT', 0, null, 0])
      return [{ columns: ['cid', 'name', 'type', 'notnull', 'dflt_value', 'pk'], values }]
    }
    // SELECT COUNT(*) FROM sqlite_master — hasTable() in v5/v25
    if (query.includes('COUNT(*)') && query.includes('sqlite_master')) {
      const nameMatch = query.match(/name='(\w+)'/)
      if (nameMatch) {
        const exists = tableMap[nameMatch[1]] ?? false
        return [{ columns: ['COUNT(*)'], values: [[exists ? 1 : 0]] }]
      }
    }
    // SELECT sql FROM sqlite_master — schema introspection (v10/v11/v16/v25/v29/v35)
    if (query.includes('sqlite_master') && query.includes('SELECT sql')) {
      const nameMatch = query.match(/name='(\w+)'/)
      if (nameMatch && tableSchemas[nameMatch[1]]) {
        return [{ columns: ['sql'], values: [[tableSchemas[nameMatch[1]]]] }]
      }
      return []
    }
    // SELECT name FROM sqlite_master — table existence guard (v3/v4/v6/v15)
    if (query.includes('sqlite_master') && query.includes("type='table'")) {
      const nameMatch = query.match(/name='(\w+)'/)
      if (nameMatch) {
        const exists = tableMap[nameMatch[1]] ?? false
        if (exists) return [{ columns: ['name'], values: [[nameMatch[1]]] }]
        return []
      }
    }
    return []
  })

  const run = vi.fn().mockImplementation((sql: string) => {
    const uvMatch = sql.match(/PRAGMA user_version\s*=\s*(\d+)/)
    if (uvMatch) currentVersion = Number(uvMatch[1])
  })

  return { exec, run, _getVersion: () => currentVersion, getRowsModified: vi.fn().mockReturnValue(0) }
}

// ── English-schema DB (user_version=0, no config) ───────────────────────────

describe('migrateDb — fresh English-schema DB (user_version=0)', () => {
  beforeEach(() => vi.clearAllMocks())

  function createEnglishDb() {
    return createMockDb({
      userVersion: 0,
      hasConfigTable: false,
      colMap: {
        agents: ['id', 'name', 'type', 'scope', 'system_prompt', 'system_prompt_suffix',
          'thinking_mode', 'allowed_tools', 'auto_launch', 'permission_mode',
          'max_sessions', 'worktree_enabled', 'preferred_model', 'preferred_cli', 'created_at'],
        sessions: ['id', 'agent_id', 'started_at', 'ended_at', 'updated_at', 'status',
          'summary', 'claude_conv_id', 'tokens_in', 'tokens_out', 'tokens_cache_read',
          'tokens_cache_write', 'cost_usd', 'duration_ms', 'num_turns', 'cli_type'],
        tasks: ['id', 'title', 'description', 'status', 'agent_creator_id',
          'agent_assigned_id', 'agent_validator_id', 'parent_task_id', 'session_id',
          'scope', 'effort', 'priority', 'created_at', 'updated_at', 'started_at',
          'completed_at', 'validated_at'],
        task_comments: ['id', 'task_id', 'agent_id', 'content', 'created_at'],
        task_agents: ['id', 'task_id', 'agent_id', 'role', 'assigned_at'],
        agent_groups: ['id', 'name', 'sort_order', 'parent_id', 'created_at'],
        agent_group_members: ['id', 'group_id', 'agent_id', 'sort_order'],
        agent_logs: ['id', 'session_id', 'agent_id', 'level', 'action', 'detail', 'files', 'created_at'],
        scopes: ['id', 'name', 'folder', 'techno', 'description', 'active', 'created_at'],
        task_links: ['id', 'from_task', 'to_task', 'type', 'created_at'],
      },
      tableMap: {
        agents: true, sessions: true, tasks: true, task_comments: true,
        task_agents: true, agent_groups: true, agent_group_members: true,
        agent_logs: true, config: true, scopes: true, task_links: true,
        tasks_fts: true,
        // No locks table, no perimetres table
      },
      tableSchemas: {
        tasks: "CREATE TABLE tasks (id INTEGER PRIMARY KEY, title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'todo' CHECK(status IN ('todo','in_progress','done','archived')), agent_assigned_id INTEGER NOT NULL)",
        sessions: "CREATE TABLE sessions (id INTEGER PRIMARY KEY, status TEXT NOT NULL DEFAULT 'started' CHECK(status IN ('started','completed','blocked')))",
        agents: "CREATE TABLE agents (id INTEGER PRIMARY KEY, thinking_mode TEXT CHECK(thinking_mode IN ('auto', 'disabled')))",
      },
    })
  }

  it('applies all migrations without error and reaches CURRENT_SCHEMA_VERSION', () => {
    const db = createEnglishDb()
    const result = migrateDb(db as unknown as MigrationDb)
    expect(result).toBe(CURRENT_SCHEMA_VERSION)
    expect(db._getVersion()).toBe(CURRENT_SCHEMA_VERSION)
  })

  it('does NOT create perimetres table (v4) when scopes already exists', () => {
    const db = createEnglishDb()
    migrateDb(db as unknown as MigrationDb)
    const calls = db.run.mock.calls.map((c: unknown[]) => c[0] as string)
    expect(calls.every(s => !s.includes('CREATE TABLE perimetres'))).toBe(true)
  })

  it('does NOT create index on locks table (v5) when locks does not exist', () => {
    const db = createEnglishDb()
    migrateDb(db as unknown as MigrationDb)
    const calls = db.run.mock.calls.map((c: unknown[]) => c[0] as string)
    // Use CREATE INDEX to exclude v26 DROP INDEX IF EXISTS
    expect(calls.every(s => !(s.includes('CREATE INDEX') && s.includes('idx_locks_released_at')))).toBe(true)
  })

  it('does NOT create index on French agent_assigne_id column (v5)', () => {
    const db = createEnglishDb()
    migrateDb(db as unknown as MigrationDb)
    const calls = db.run.mock.calls.map((c: unknown[]) => c[0] as string)
    // v5 should not create index using French column name agent_assigne_id
    // (v35 may create the same index name but with English column agent_assigned_id — that's OK)
    expect(calls.every(s => !s.includes('ON tasks(agent_assigne_id)'))).toBe(true)
  })

  it('uses title (not titre) for FTS creation (v22)', () => {
    const db = createEnglishDb()
    migrateDb(db as unknown as MigrationDb)
    const calls = db.run.mock.calls.map((c: unknown[]) => c[0] as string)
    // FTS column should be 'title' not 'titre'
    const ftsCreate = calls.find(s => s.includes('CREATE VIRTUAL TABLE') && s.includes('tasks_fts'))
    expect(ftsCreate).toBeDefined()
    expect(ftsCreate).toContain('title')
    expect(ftsCreate).not.toContain('titre')
  })

  it('does NOT query statut column on tasks (v10/v12 skip on English schema)', () => {
    const db = createEnglishDb()
    migrateDb(db as unknown as MigrationDb)
    const execCalls = db.exec.mock.calls.map((c: unknown[]) => c[0] as string)
    // No query should reference 'statut' column in tasks data (schema introspection is fine)
    const statutDataQueries = execCalls.filter(s =>
      s.includes('FROM tasks WHERE statut') || s.includes('FROM sessions WHERE statut')
    )
    expect(statutDataQueries).toHaveLength(0)
  })
})

// ── French-schema DB (user_version=0, no config) ────────────────────────────

describe('migrateDb — fresh French-schema DB (user_version=0)', () => {
  beforeEach(() => vi.clearAllMocks())

  function createFrenchDb() {
    return createMockDb({
      userVersion: 0,
      hasConfigTable: false,
      colMap: {
        agents: ['id', 'name', 'type', 'perimetre', 'system_prompt', 'system_prompt_suffix',
          'thinking_mode', 'allowed_tools', 'created_at'],
        sessions: ['id', 'agent_id', 'started_at', 'ended_at', 'updated_at', 'statut',
          'summary'],
        tasks: ['id', 'titre', 'description', 'statut', 'agent_createur_id',
          'agent_assigne_id', 'agent_valideur_id', 'parent_task_id', 'session_id',
          'perimetre', 'effort', 'created_at', 'updated_at'],
        task_comments: ['id', 'task_id', 'agent_id', 'contenu', 'created_at'],
        agent_logs: ['id', 'session_id', 'agent_id', 'niveau', 'action', 'detail', 'fichiers', 'created_at'],
        locks: ['id', 'fichier', 'agent_id', 'session_id', 'created_at', 'released_at'],
        task_links: ['id', 'from_task', 'to_task', 'type', 'created_at'],
      },
      tableMap: {
        agents: true, sessions: true, tasks: true, task_comments: true,
        agent_logs: true, locks: true, task_links: true,
        // No scopes, no task_agents, no agent_groups, no config
      },
      tableSchemas: {
        tasks: "CREATE TABLE tasks (id INTEGER PRIMARY KEY, titre TEXT NOT NULL, statut TEXT NOT NULL DEFAULT 'a_faire' CHECK(statut IN ('a_faire','en_cours','terminé','archivé')))",
        sessions: "CREATE TABLE sessions (id INTEGER PRIMARY KEY, statut TEXT NOT NULL DEFAULT 'en_cours' CHECK(statut IN ('en_cours','terminé','bloqué')))",
        agents: "CREATE TABLE agents (id INTEGER PRIMARY KEY, thinking_mode TEXT CHECK(thinking_mode IN ('auto', 'disabled', 'budget_tokens')))",
      },
    })
  }

  it('applies all migrations without error and reaches CURRENT_SCHEMA_VERSION', () => {
    const db = createFrenchDb()
    const result = migrateDb(db as unknown as MigrationDb)
    expect(result).toBe(CURRENT_SCHEMA_VERSION)
    expect(db._getVersion()).toBe(CURRENT_SCHEMA_VERSION)
  })

  it('creates perimetres table (v4) when neither perimetres nor scopes exist', () => {
    const db = createFrenchDb()
    migrateDb(db as unknown as MigrationDb)
    const calls = db.run.mock.calls.map((c: unknown[]) => c[0] as string)
    expect(calls.some(s => s.includes('CREATE TABLE perimetres'))).toBe(true)
  })

  it('creates index on locks table (v5) when locks exists', () => {
    const db = createFrenchDb()
    migrateDb(db as unknown as MigrationDb)
    const calls = db.run.mock.calls.map((c: unknown[]) => c[0] as string)
    expect(calls.some(s => s.includes('idx_locks_released_at'))).toBe(true)
  })

  it('creates index on agent_assigne_id (v5) when French column exists', () => {
    const db = createFrenchDb()
    migrateDb(db as unknown as MigrationDb)
    const calls = db.run.mock.calls.map((c: unknown[]) => c[0] as string)
    expect(calls.some(s => s.includes('idx_tasks_agent_assigne'))).toBe(true)
  })

  it('uses titre for FTS creation (v22) on French schema', () => {
    const db = createFrenchDb()
    migrateDb(db as unknown as MigrationDb)
    const calls = db.run.mock.calls.map((c: unknown[]) => c[0] as string)
    const ftsCreate = calls.find(s => s.includes('CREATE VIRTUAL TABLE') && s.includes('tasks_fts'))
    expect(ftsCreate).toBeDefined()
    expect(ftsCreate).toContain('titre')
  })
})
