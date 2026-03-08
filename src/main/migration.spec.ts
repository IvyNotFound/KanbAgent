import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runTaskStatusMigration, runAddPriorityMigration, runTaskStatutI18nMigration, runAddConvIdToSessionsMigration, runAddTokensToSessionsMigration, runRemoveThinkingModeBudgetTokensMigration, runDropCommentaireColumnMigration, runSessionStatutI18nMigration, runMakeAgentAssigneNotNullMigration, runMakeCommentAgentNotNullMigration, runAddAgentGroupsMigration, runAddParentIdToAgentGroupsMigration, migrateDb, CURRENT_SCHEMA_VERSION } from './migration'

// Mock Database for sql.js
interface MockDatabase {
  exec: ReturnType<typeof vi.fn>
  run: ReturnType<typeof vi.fn>
  getRowsModified: ReturnType<typeof vi.fn>
}

function createMockDb(execResults: Array<{ columns: string[]; values: unknown[][] }> = []): MockDatabase {
  return {
    exec: vi.fn().mockImplementation((query: string) => {
      // db.exec() in sql.js always returns an array of QueryExecResult:
      //   - rows found    → [{ columns: [...], values: [[row1], [row2], ...] }]
      //   - no rows found → [] (empty array, not an array with an empty-values object)
      if (query.includes("COUNT(*) as count FROM tasks WHERE statut = 'terminé'")) {
        const r = execResults[0]
        return r ? [r] : [{ columns: ['count'], values: [[0]] }]
      }
      if (query.includes("COUNT(*) as count FROM tasks WHERE statut = 'validé'")) {
        const r = execResults[1]
        return r ? [r] : [{ columns: ['count'], values: [[0]] }]
      }
      if (query.includes("sqlite_master") && !query.includes('COUNT(*)')) {
        // For sqlite_master: return [] when no table found (values is empty array)
        // return [result] only when values has at least one row
        const r = execResults[2]
        if (r && r.values.length > 0) return [r]
        return []
      }
      return []
    }),
    run: vi.fn(),
    getRowsModified: vi.fn().mockReturnValue(0)
  }
}

// ── runTaskStatusMigration ──────────────────────────────────────────────────────

describe('runTaskStatusMigration', () => {
  let mockDb: MockDatabase

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return 0 when no tasks to migrate', () => {
    mockDb = createMockDb([
      { columns: ['count'], values: [[0]] }, // terminé
      { columns: ['count'], values: [[0]] }, // validé
      { columns: ['name'], values: [] } // no agent_logs table
    ])

    const result = runTaskStatusMigration(mockDb as unknown as import('sql.js').Database)

    expect(result).toBe(0)
    expect(mockDb.run).not.toHaveBeenCalled()
  })

  it('should migrate terminé → archivé', () => {
    mockDb = createMockDb([
      { columns: ['count'], values: [[5]] }, // 5 tâches terminé
      { columns: ['count'], values: [[0]] }, // 0 tâches validé
      { columns: ['name'], values: [] } // no agent_logs table
    ])
    mockDb.getRowsModified.mockReturnValue(5)

    const result = runTaskStatusMigration(mockDb as unknown as import('sql.js').Database)

    expect(result).toBe(5)
    expect(mockDb.run).toHaveBeenCalledWith(
      "UPDATE tasks SET statut = 'archivé', updated_at = CURRENT_TIMESTAMP WHERE statut = 'terminé'"
    )
  })

  it('should migrate validé → archivé (legacy projects)', () => {
    mockDb = createMockDb([
      { columns: ['count'], values: [[0]] }, // 0 tâches terminé
      { columns: ['count'], values: [[3]] }, // 3 tâches validé
      { columns: ['name'], values: [] } // no agent_logs table
    ])
    mockDb.getRowsModified.mockReturnValue(3)

    const result = runTaskStatusMigration(mockDb as unknown as import('sql.js').Database)

    expect(result).toBe(3)
    expect(mockDb.run).toHaveBeenCalledWith(
      "UPDATE tasks SET statut = 'archivé', updated_at = CURRENT_TIMESTAMP WHERE statut = 'validé'"
    )
  })

  it('should migrate both terminé and validated tasks', () => {
    mockDb = createMockDb([
      { columns: ['count'], values: [[2]] }, // 2 tâches terminé
      { columns: ['count'], values: [[3]] }, // 3 tâches validé
      { columns: ['name'], values: [] } // no agent_logs table
    ])
    // First call returns 2, second call returns 3
    mockDb.getRowsModified
      .mockReturnValueOnce(2)
      .mockReturnValueOnce(3)

    const result = runTaskStatusMigration(mockDb as unknown as import('sql.js').Database)

    expect(result).toBe(5)
    expect(mockDb.run).toHaveBeenCalledTimes(2)
  })

  it('should not INSERT into agent_logs even if table exists (session_id NOT NULL)', () => {
    // agent_logs has NOT NULL constraints on session_id and agent_id —
    // no valid context exists during migration, so no INSERT should happen.
    mockDb = createMockDb([
      { columns: ['count'], values: [[1]] }, // 1 tâche terminé
      { columns: ['count'], values: [[0]] }, // 0 tâches validé
    ])
    mockDb.getRowsModified.mockReturnValue(1)

    const result = runTaskStatusMigration(mockDb as unknown as import('sql.js').Database)

    expect(result).toBe(1)
    // Only the UPDATE should be called, never INSERT INTO agent_logs
    expect(mockDb.run).toHaveBeenCalledTimes(1)
    expect(mockDb.run).not.toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO agent_logs'),
      expect.anything()
    )
  })

  it('should only call UPDATE, no INSERT regardless of agent_logs presence', () => {
    mockDb = createMockDb([
      { columns: ['count'], values: [[1]] },
      { columns: ['count'], values: [[0]] },
    ])
    mockDb.getRowsModified.mockReturnValue(1)

    const result = runTaskStatusMigration(mockDb as unknown as import('sql.js').Database)

    expect(result).toBe(1)
    expect(mockDb.run).toHaveBeenCalledTimes(1)
  })

  it('should recreate tasks table when old CHECK constraint missing archivé', () => {
    // Old schema: CHECK constraint without 'archivé' (matches ipc.ts old schema)
    const oldSchema = `CREATE TABLE tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      titre TEXT NOT NULL,
      description TEXT,
      statut TEXT NOT NULL DEFAULT 'a_faire'
        CHECK(statut IN ('a_faire','en_cours','terminé','validé')),
      agent_createur_id INTEGER REFERENCES agents(id),
      agent_assigne_id INTEGER REFERENCES agents(id),
      agent_valideur_id INTEGER REFERENCES agents(id),
      parent_task_id INTEGER REFERENCES tasks(id),
      session_id INTEGER REFERENCES sessions(id),
      perimetre TEXT,
      effort INTEGER CHECK(effort IN (1,2,3)),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      started_at DATETIME,
      completed_at DATETIME,
      validated_at DATETIME
    )`

    mockDb = createMockDb([
      { columns: ['count'], values: [[2]] }, // 2 tâches terminé
      { columns: ['count'], values: [[0]] }, // 0 tâches validé
      { columns: ['sql'], values: [[oldSchema]] } // old schema without 'archivé'
    ])
    mockDb.getRowsModified.mockReturnValue(2)

    const result = runTaskStatusMigration(mockDb as unknown as import('sql.js').Database)

    // Should recreate table first (ALTER TABLE, CREATE TABLE, INSERT, DROP)
    // Then do the UPDATE (1 call for table recreation + 1 for UPDATE)
    expect(mockDb.run).toHaveBeenCalled()
    expect(result).toBe(2)
  })

  it('should not recreate table when archivé already in CHECK constraint (French)', () => {
    // New schema: CHECK constraint includes 'archivé' (matches current ipc.ts schema)
    const newSchema = `CREATE TABLE tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      titre TEXT NOT NULL,
      description TEXT,
      statut TEXT NOT NULL DEFAULT 'a_faire'
        CHECK(statut IN ('a_faire','en_cours','terminé','validé','archivé')),
      agent_createur_id INTEGER REFERENCES agents(id),
      agent_assigne_id INTEGER REFERENCES agents(id),
      agent_valideur_id INTEGER REFERENCES agents(id),
      parent_task_id INTEGER REFERENCES tasks(id),
      session_id INTEGER REFERENCES sessions(id),
      perimetre TEXT,
      effort INTEGER CHECK(effort IN (1,2,3)),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      started_at DATETIME,
      completed_at DATETIME,
      validated_at DATETIME
    )`

    mockDb = createMockDb([
      { columns: ['count'], values: [[1]] }, // 1 tâche terminé
      { columns: ['count'], values: [[0]] }, // 0 tâches validé
      { columns: ['sql'], values: [[newSchema]] } // new schema with 'archivé'
    ])
    mockDb.getRowsModified.mockReturnValue(1)

    const result = runTaskStatusMigration(mockDb as unknown as import('sql.js').Database)

    // Should NOT recreate table, just do the UPDATE
    expect(result).toBe(1)
    // Should have called UPDATE, not ALTER TABLE
    expect(mockDb.run).toHaveBeenCalledWith(
      "UPDATE tasks SET statut = 'archivé', updated_at = CURRENT_TIMESTAMP WHERE statut = 'terminé'"
    )
  })

  it('should not recreate table when archived (English) already in CHECK constraint', () => {
    // Modern English schema — isArchiveAllowedInCheck must accept 'archived'
    const englishSchema = `CREATE TABLE tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      titre TEXT NOT NULL,
      description TEXT,
      statut TEXT NOT NULL DEFAULT 'todo'
        CHECK(statut IN ('todo','in_progress','done','archived')),
      priority TEXT NOT NULL DEFAULT 'normal'
        CHECK(priority IN ('low','normal','high','critical')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`

    mockDb = createMockDb([
      { columns: ['count'], values: [[0]] }, // no terminé (already English)
      { columns: ['count'], values: [[0]] }, // no validé
      { columns: ['sql'], values: [[englishSchema]] }
    ])

    const result = runTaskStatusMigration(mockDb as unknown as import('sql.js').Database)

    // No table recreation, no UPDATE — everything already migrated
    expect(result).toBe(0)
    expect(mockDb.run).not.toHaveBeenCalled()
  })
})

// ── runAddPriorityMigration ─────────────────────────────────────────────────────

describe('runAddPriorityMigration', () => {
  let mockDb: MockDatabase

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should add priority column when missing', () => {
    mockDb = {
      exec: vi.fn().mockReturnValue([{
        columns: ['cid', 'name', 'type', 'notnull', 'dflt_value', 'pk'],
        values: [
          [0, 'id', 'INTEGER', 1, null, 1],
          [1, 'titre', 'TEXT', 1, null, 0],
          [2, 'statut', 'TEXT', 1, "'todo'", 0],
        ]
      }]),
      run: vi.fn(),
      getRowsModified: vi.fn().mockReturnValue(0)
    }

    const result = runAddPriorityMigration(mockDb as unknown as import('sql.js').Database)

    expect(result).toBe(true)
    expect(mockDb.run).toHaveBeenCalledWith(
      expect.stringContaining("ALTER TABLE tasks ADD COLUMN priority")
    )
    expect(mockDb.run).toHaveBeenCalledWith(
      expect.stringContaining("DEFAULT 'normal'")
    )
  })

  it('should not add priority column when it already exists', () => {
    mockDb = {
      exec: vi.fn().mockReturnValue([{
        columns: ['cid', 'name', 'type', 'notnull', 'dflt_value', 'pk'],
        values: [
          [0, 'id', 'INTEGER', 1, null, 1],
          [1, 'titre', 'TEXT', 1, null, 0],
          [2, 'statut', 'TEXT', 1, "'todo'", 0],
          [3, 'priority', 'TEXT', 1, "'normal'", 0],
        ]
      }]),
      run: vi.fn(),
      getRowsModified: vi.fn().mockReturnValue(0)
    }

    const result = runAddPriorityMigration(mockDb as unknown as import('sql.js').Database)

    expect(result).toBe(false)
    expect(mockDb.run).not.toHaveBeenCalled()
  })

  it('should return false when tasks table does not exist', () => {
    mockDb = {
      exec: vi.fn().mockReturnValue([]),
      run: vi.fn(),
      getRowsModified: vi.fn().mockReturnValue(0)
    }

    const result = runAddPriorityMigration(mockDb as unknown as import('sql.js').Database)

    expect(result).toBe(false)
    expect(mockDb.run).not.toHaveBeenCalled()
  })
})

// ── runAddConvIdToSessionsMigration ────────────────────────────────────────────

describe('runAddConvIdToSessionsMigration', () => {
  let mockDb: MockDatabase

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should add claude_conv_id column when it is absent', () => {
    // PRAGMA table_info(sessions) returns columns without 'claude_conv_id'
    mockDb = {
      exec: vi.fn().mockReturnValue([{
        columns: ['cid', 'name', 'type', 'notnull', 'dflt_value', 'pk'],
        values: [
          [0, 'id',         'INTEGER',  1, null,    1],
          [1, 'agent_id',   'INTEGER',  1, null,    0],
          [2, 'started_at', 'DATETIME', 0, null,    0],
          [3, 'ended_at',   'DATETIME', 0, null,    0],
          [4, 'statut',     'TEXT',     1, "'en_cours'", 0],
          [5, 'summary',    'TEXT',     0, null,    0],
        ]
      }]),
      run: vi.fn(),
      getRowsModified: vi.fn().mockReturnValue(0)
    }

    const result = runAddConvIdToSessionsMigration(mockDb as unknown as import('sql.js').Database)

    expect(result).toBe(true)
    expect(mockDb.run).toHaveBeenCalledWith(
      'ALTER TABLE sessions ADD COLUMN claude_conv_id TEXT'
    )
  })

  it('should not add column when claude_conv_id already exists (idempotent)', () => {
    // PRAGMA table_info(sessions) already includes 'claude_conv_id'
    mockDb = {
      exec: vi.fn().mockReturnValue([{
        columns: ['cid', 'name', 'type', 'notnull', 'dflt_value', 'pk'],
        values: [
          [0, 'id',             'INTEGER',  1, null, 1],
          [1, 'agent_id',       'INTEGER',  1, null, 0],
          [2, 'statut',         'TEXT',     1, null, 0],
          [3, 'summary',        'TEXT',     0, null, 0],
          [4, 'claude_conv_id', 'TEXT',     0, null, 0],
        ]
      }]),
      run: vi.fn(),
      getRowsModified: vi.fn().mockReturnValue(0)
    }

    const result = runAddConvIdToSessionsMigration(mockDb as unknown as import('sql.js').Database)

    expect(result).toBe(false)
    expect(mockDb.run).not.toHaveBeenCalled()
  })

  it('should return false without crashing when sessions table does not exist', () => {
    // PRAGMA table_info(sessions) returns empty array (table absent)
    mockDb = {
      exec: vi.fn().mockReturnValue([]),
      run: vi.fn(),
      getRowsModified: vi.fn().mockReturnValue(0)
    }

    const result = runAddConvIdToSessionsMigration(mockDb as unknown as import('sql.js').Database)

    expect(result).toBe(false)
    expect(mockDb.run).not.toHaveBeenCalled()
  })
})

// ── runTaskStatutI18nMigration ──────────────────────────────────────────────────

describe('runTaskStatutI18nMigration', () => {
  let mockDb: MockDatabase

  function createI18nMockDb(opts: {
    schema?: string
    frenchCount?: number
    oldColNames?: string[]
  }): MockDatabase {
    const { schema = '', frenchCount = 0, oldColNames = ['id', 'titre', 'description', 'statut', 'perimetre', 'effort', 'created_at', 'updated_at'] } = opts

    const pragmaValues = oldColNames.map((name, idx) => [idx, name, 'TEXT', 0, null, 0])

    return {
      exec: vi.fn().mockImplementation((query: string) => {
        if (query.includes('sqlite_master') && !query.includes('COUNT(*)')) {
          if (schema) return [{ columns: ['sql'], values: [[schema]] }]
          return []
        }
        if (query.includes('COUNT(*)') && query.includes("IN ('a_faire'")) {
          return [{ columns: ['count'], values: [[frenchCount]] }]
        }
        if (query.includes('PRAGMA table_info')) {
          return [{ columns: ['cid','name','type','notnull','dflt_value','pk'], values: pragmaValues }]
        }
        return []
      }),
      run: vi.fn(),
      getRowsModified: vi.fn().mockReturnValue(0)
    }
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return 0 when schema is already English and no French values', () => {
    const englishSchema = `CREATE TABLE tasks (statut TEXT DEFAULT 'todo' CHECK(statut IN ('todo','in_progress','done','archived')))`
    mockDb = createI18nMockDb({ schema: englishSchema, frenchCount: 0 })

    const result = runTaskStatutI18nMigration(mockDb as unknown as import('sql.js').Database)

    expect(result).toBe(0)
    expect(mockDb.run).not.toHaveBeenCalled()
  })

  it('should return 0 when tasks table does not exist', () => {
    mockDb = createI18nMockDb({ schema: '', frenchCount: 0 })

    const result = runTaskStatutI18nMigration(mockDb as unknown as import('sql.js').Database)

    expect(result).toBe(0)
    expect(mockDb.run).not.toHaveBeenCalled()
  })

  it('should recreate table and return frenchCount when French values exist', () => {
    const frenchSchema = `CREATE TABLE tasks (statut TEXT DEFAULT 'a_faire' CHECK(statut IN ('a_faire','en_cours','terminé','archivé')))`
    mockDb = createI18nMockDb({ schema: frenchSchema, frenchCount: 7 })

    const result = runTaskStatutI18nMigration(mockDb as unknown as import('sql.js').Database)

    expect(result).toBe(7)
    // Should call ALTER TABLE RENAME TO ...
    expect(mockDb.run).toHaveBeenCalledWith(
      expect.stringContaining('ALTER TABLE tasks RENAME TO tasks_backup_i18n')
    )
    // Should create new table with English CHECK
    expect(mockDb.run).toHaveBeenCalledWith(
      expect.stringContaining("'todo','in_progress','done','archived'")
    )
    // Should create priority column in new table
    expect(mockDb.run).toHaveBeenCalledWith(
      expect.stringContaining("'low','normal','high','critical'")
    )
    // Should INSERT SELECT with CASE expression
    expect(mockDb.run).toHaveBeenCalledWith(
      expect.stringContaining('CASE COALESCE(statut')
    )
    // Should DROP backup table
    expect(mockDb.run).toHaveBeenCalledWith(
      expect.stringContaining('DROP TABLE tasks_backup_i18n')
    )
  })

  it('should recreate table with English schema even when no French data but schema is French', () => {
    const frenchSchema = `CREATE TABLE tasks (statut TEXT DEFAULT 'a_faire' CHECK(statut IN ('a_faire','en_cours','terminé','archivé')))`
    // No French data (frenchCount=0) but schema is not English (no 'todo')
    mockDb = createI18nMockDb({ schema: frenchSchema, frenchCount: 0 })

    const result = runTaskStatutI18nMigration(mockDb as unknown as import('sql.js').Database)

    // Should still recreate the table (schema upgrade needed)
    expect(result).toBe(0)
    expect(mockDb.run).toHaveBeenCalledWith(
      expect.stringContaining('ALTER TABLE tasks RENAME TO tasks_backup_i18n')
    )
  })

  it('should include terminé → done in CASE mapping', () => {
    const frenchSchema = `CREATE TABLE tasks (statut TEXT DEFAULT 'a_faire' CHECK(statut IN ('a_faire','en_cours','terminé','archivé')))`
    mockDb = createI18nMockDb({ schema: frenchSchema, frenchCount: 3 })

    runTaskStatutI18nMigration(mockDb as unknown as import('sql.js').Database)

    const insertCall = (mockDb.run as ReturnType<typeof vi.fn>).mock.calls.find(
      (call: unknown[]) => typeof call[0] === 'string' && call[0].includes('INSERT INTO tasks')
    )
    expect(insertCall).toBeDefined()
    const insertSql = insertCall![0] as string
    expect(insertSql).toContain("WHEN 'terminé'  THEN 'done'")
    expect(insertSql).toContain("WHEN 'archivé'  THEN 'archived'")
    expect(insertSql).toContain("WHEN 'validé'   THEN 'archived'")
  })

  it('should use existing priority values when column already present', () => {
    const frenchSchema = `CREATE TABLE tasks (statut TEXT DEFAULT 'a_faire' CHECK(statut IN ('a_faire','en_cours','terminé','archivé')))`
    const colNames = ['id', 'titre', 'statut', 'priority', 'created_at', 'updated_at']
    mockDb = createI18nMockDb({ schema: frenchSchema, frenchCount: 2, oldColNames: colNames })

    runTaskStatutI18nMigration(mockDb as unknown as import('sql.js').Database)

    const insertCall = (mockDb.run as ReturnType<typeof vi.fn>).mock.calls.find(
      (call: unknown[]) => typeof call[0] === 'string' && call[0].includes('INSERT INTO tasks')
    )
    expect(insertCall).toBeDefined()
    const insertSql = insertCall![0] as string
    // priority should be copied from old table (not defaulted)
    expect(insertSql).toContain('priority,')
    // The SELECT clause should use 'priority' as a column reference, not the default literal "'normal'"
    // Extract only the column list between SELECT and FROM to avoid false positives
    const betweenSelectAndFrom = insertSql.split('SELECT ')[1]?.split(' FROM ')[0] ?? ''
    expect(betweenSelectAndFrom).toMatch(/\bpriority\b/) // priority = column ref, not literal
    expect(betweenSelectAndFrom).not.toContain("'normal'") // not using the default literal value
  })
})

// ── runRemoveThinkingModeBudgetTokensMigration ──────────────────────────────────

describe('runRemoveThinkingModeBudgetTokensMigration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function createAgentsMockDb(schema: string, colNames: string[] = ['id', 'name', 'type', 'perimetre', 'system_prompt', 'system_prompt_suffix', 'thinking_mode', 'allowed_tools', 'created_at']) {
    const pragmaValues = colNames.map((name, idx) => [idx, name, 'TEXT', 0, null, 0])
    return {
      exec: vi.fn().mockImplementation((query: string) => {
        if (query.includes('sqlite_master')) {
          if (schema) return [{ columns: ['sql'], values: [[schema]] }]
          return []
        }
        if (query.includes('PRAGMA table_info')) {
          return [{ columns: ['cid', 'name', 'type', 'notnull', 'dflt_value', 'pk'], values: pragmaValues }]
        }
        return []
      }),
      run: vi.fn(),
      getRowsModified: vi.fn().mockReturnValue(0),
    }
  }

  it('should return false when agents table does not exist', () => {
    const mockDb = {
      exec: vi.fn().mockReturnValue([]),
      run: vi.fn(),
      getRowsModified: vi.fn().mockReturnValue(0),
    }

    const result = runRemoveThinkingModeBudgetTokensMigration(mockDb as unknown as import('sql.js').Database)

    expect(result).toBe(false)
    expect(mockDb.run).not.toHaveBeenCalled()
  })

  it('should return false when budget_tokens is NOT in the schema (already migrated)', () => {
    const modernSchema = `CREATE TABLE agents (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, type TEXT NOT NULL, thinking_mode TEXT CHECK(thinking_mode IN ('auto', 'disabled')))`
    const mockDb = createAgentsMockDb(modernSchema)

    const result = runRemoveThinkingModeBudgetTokensMigration(mockDb as unknown as import('sql.js').Database)

    expect(result).toBe(false)
    expect(mockDb.run).not.toHaveBeenCalled()
  })

  it('should return true and recreate table when budget_tokens IS in the schema', () => {
    const oldSchema = `CREATE TABLE agents (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, type TEXT NOT NULL, thinking_mode TEXT CHECK(thinking_mode IN ('auto', 'disabled', 'budget_tokens')))`
    const mockDb = createAgentsMockDb(oldSchema)

    const result = runRemoveThinkingModeBudgetTokensMigration(mockDb as unknown as import('sql.js').Database)

    expect(result).toBe(true)
    // Should rename old table
    expect(mockDb.run).toHaveBeenCalledWith(
      expect.stringContaining('ALTER TABLE agents RENAME TO agents_backup_thinking')
    )
    // Should create new table with updated CHECK constraint
    expect(mockDb.run).toHaveBeenCalledWith(
      expect.stringContaining("CHECK(thinking_mode IN ('auto', 'disabled'))")
    )
    // New schema must NOT contain budget_tokens
    const createCall = (mockDb.run as ReturnType<typeof vi.fn>).mock.calls.find(
      (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('CREATE TABLE agents')
    )
    expect(createCall).toBeDefined()
    expect(createCall![0] as string).not.toContain('budget_tokens')
    // Should drop backup table
    expect(mockDb.run).toHaveBeenCalledWith(
      expect.stringContaining('DROP TABLE agents_backup_thinking')
    )
  })

  it('should convert budget_tokens values to NULL in the INSERT SELECT', () => {
    const oldSchema = `CREATE TABLE agents (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, type TEXT NOT NULL, thinking_mode TEXT CHECK(thinking_mode IN ('auto', 'disabled', 'budget_tokens')))`
    const mockDb = createAgentsMockDb(oldSchema)

    runRemoveThinkingModeBudgetTokensMigration(mockDb as unknown as import('sql.js').Database)

    const insertCall = (mockDb.run as ReturnType<typeof vi.fn>).mock.calls.find(
      (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('INSERT INTO agents')
    )
    expect(insertCall).toBeDefined()
    const insertSql = insertCall![0] as string
    expect(insertSql).toContain("WHEN 'budget_tokens' THEN NULL")
  })

  it('should be idempotent: running twice returns false on second call', () => {
    // First call: schema has budget_tokens → returns true, recreates table
    // Second call mock: schema is already clean → returns false
    const oldSchema = `CREATE TABLE agents (thinking_mode TEXT CHECK(thinking_mode IN ('auto', 'disabled', 'budget_tokens')))`
    const newSchema = `CREATE TABLE agents (thinking_mode TEXT CHECK(thinking_mode IN ('auto', 'disabled')))`

    let callCount = 0
    const mockDb = {
      exec: vi.fn().mockImplementation((query: string) => {
        if (query.includes('sqlite_master')) {
          callCount++
          const schema = callCount === 1 ? oldSchema : newSchema
          return [{ columns: ['sql'], values: [[schema]] }]
        }
        if (query.includes('PRAGMA table_info')) {
          return [{ columns: ['cid', 'name', 'type', 'notnull', 'dflt_value', 'pk'], values: [[0, 'thinking_mode', 'TEXT', 0, null, 0]] }]
        }
        return []
      }),
      run: vi.fn(),
      getRowsModified: vi.fn().mockReturnValue(0),
    }

    const first = runRemoveThinkingModeBudgetTokensMigration(mockDb as unknown as import('sql.js').Database)
    expect(first).toBe(true)

    const second = runRemoveThinkingModeBudgetTokensMigration(mockDb as unknown as import('sql.js').Database)
    expect(second).toBe(false)
  })

  it('should use SAVEPOINT for atomicity', () => {
    const oldSchema = `CREATE TABLE agents (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, type TEXT NOT NULL, thinking_mode TEXT CHECK(thinking_mode IN ('auto', 'disabled', 'budget_tokens')))`
    const mockDb = createAgentsMockDb(oldSchema)

    runRemoveThinkingModeBudgetTokensMigration(mockDb as unknown as import('sql.js').Database)

    const calls = (mockDb.run as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string)
    expect(calls.some(s => s.includes('SAVEPOINT remove_budget_tokens'))).toBe(true)
    expect(calls.some(s => s.includes('RELEASE SAVEPOINT remove_budget_tokens'))).toBe(true)
    // ROLLBACK should NOT have been called on success
    expect(calls.some(s => s.includes('ROLLBACK TO SAVEPOINT'))).toBe(false)
  })
})

// ── runDropCommentaireColumnMigration ────────────────────────────────────────────

describe('runDropCommentaireColumnMigration', () => {
  function createCommentaireMockDb(columns: string[]): MockDatabase {
    // Build PRAGMA table_info rows: [cid, name, type, notnull, dflt_value, pk]
    const pragmaValues = columns.map((name, i) => [i, name, 'TEXT', 0, null, i === 0 ? 1 : 0])
    return {
      exec: vi.fn().mockImplementation((query: string) => {
        if (query.includes('PRAGMA table_info(tasks)')) {
          if (pragmaValues.length === 0) return []
          return [{ columns: ['cid', 'name', 'type', 'notnull', 'dflt_value', 'pk'], values: pragmaValues }]
        }
        return []
      }),
      run: vi.fn(),
      getRowsModified: vi.fn().mockReturnValue(3),
    }
  }

  it('should return 0 and do nothing when commentaire column is absent', () => {
    const mockDb = createCommentaireMockDb(['id', 'titre', 'description', 'statut'])

    const result = runDropCommentaireColumnMigration(mockDb as unknown as import('sql.js').Database)

    expect(result).toBe(0)
    expect(mockDb.run).not.toHaveBeenCalled()
  })

  it('should migrate rows and drop column when commentaire column exists', () => {
    const mockDb = createCommentaireMockDb(['id', 'titre', 'commentaire', 'statut'])

    const result = runDropCommentaireColumnMigration(mockDb as unknown as import('sql.js').Database)

    // Returns number of rows migrated (mocked to 3)
    expect(result).toBe(3)
    // Should have run INSERT INTO task_comments
    const runCalls = (mockDb.run as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string)
    expect(runCalls.some(s => s.includes('INSERT INTO task_comments'))).toBe(true)
    expect(runCalls.some(s => s.includes('task_id') && s.includes('commentaire'))).toBe(true)
    // Should have dropped the column
    expect(runCalls.some(s => s.includes('ALTER TABLE tasks DROP COLUMN commentaire'))).toBe(true)
  })

  it('should be idempotent: returns 0 when column is already absent', () => {
    const mockDb = createCommentaireMockDb(['id', 'titre', 'statut']) // no commentaire

    const first = runDropCommentaireColumnMigration(mockDb as unknown as import('sql.js').Database)
    expect(first).toBe(0)
    expect(mockDb.run).not.toHaveBeenCalled()

    const second = runDropCommentaireColumnMigration(mockDb as unknown as import('sql.js').Database)
    expect(second).toBe(0)
    expect(mockDb.run).not.toHaveBeenCalled()
  })

  it('should filter only non-null and non-empty commentaire values via WHERE clause', () => {
    const mockDb = createCommentaireMockDb(['id', 'titre', 'commentaire', 'statut'])

    runDropCommentaireColumnMigration(mockDb as unknown as import('sql.js').Database)

    const runCalls = (mockDb.run as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string)
    const insertCall = runCalls.find(s => s.includes('INSERT INTO task_comments'))
    expect(insertCall).toBeDefined()
    expect(insertCall).toContain('commentaire IS NOT NULL')
    expect(insertCall).toContain("TRIM(commentaire) != ''")
  })
})

// ── runAddTokensToSessionsMigration ──────────────────────────────────────────

describe('runAddTokensToSessionsMigration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function createSessionsMockDb(existingColumns: string[]): MockDatabase {
    const pragmaValues = existingColumns.map((name, idx) => [idx, name, 'TEXT', 0, null, 0])
    return {
      exec: vi.fn().mockImplementation((query: string) => {
        if (query.includes('PRAGMA table_info(sessions)')) {
          if (pragmaValues.length === 0) return []
          return [{ columns: ['cid', 'name', 'type', 'notnull', 'dflt_value', 'pk'], values: pragmaValues }]
        }
        return []
      }),
      run: vi.fn(),
      getRowsModified: vi.fn().mockReturnValue(0),
    }
  }

  it('should add all 4 token columns when none exist', () => {
    const mockDb = createSessionsMockDb(['id', 'agent_id', 'started_at', 'statut', 'summary', 'claude_conv_id'])

    const result = runAddTokensToSessionsMigration(mockDb as unknown as import('sql.js').Database)

    expect(result).toBe(4)
    // 4 ALTER TABLE + SAVEPOINT + RELEASE = 6 calls
    expect(mockDb.run).toHaveBeenCalledTimes(6)
    const calls = (mockDb.run as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string)
    expect(calls.some(s => s.includes('tokens_in'))).toBe(true)
    expect(calls.some(s => s.includes('tokens_out'))).toBe(true)
    expect(calls.some(s => s.includes('tokens_cache_read'))).toBe(true)
    expect(calls.some(s => s.includes('tokens_cache_write'))).toBe(true)
  })

  it('should return 0 and do nothing when all columns already exist', () => {
    const mockDb = createSessionsMockDb(['id', 'agent_id', 'statut', 'tokens_in', 'tokens_out', 'tokens_cache_read', 'tokens_cache_write'])

    const result = runAddTokensToSessionsMigration(mockDb as unknown as import('sql.js').Database)

    expect(result).toBe(0)
    expect(mockDb.run).not.toHaveBeenCalled()
  })

  it('should only add missing columns (partial migration)', () => {
    const mockDb = createSessionsMockDb(['id', 'agent_id', 'statut', 'tokens_in', 'tokens_out'])

    const result = runAddTokensToSessionsMigration(mockDb as unknown as import('sql.js').Database)

    expect(result).toBe(2)
    // 2 ALTER TABLE + SAVEPOINT + RELEASE = 4 calls
    expect(mockDb.run).toHaveBeenCalledTimes(4)
    const calls = (mockDb.run as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string)
    expect(calls.some(s => s.includes('tokens_cache_read'))).toBe(true)
    expect(calls.some(s => s.includes('tokens_cache_write'))).toBe(true)
    expect(calls.some(s => s.includes('tokens_in'))).toBe(false)
    expect(calls.some(s => s.includes('tokens_out'))).toBe(false)
  })

  it('should return 0 when sessions table does not exist', () => {
    const mockDb: MockDatabase = {
      exec: vi.fn().mockReturnValue([]),
      run: vi.fn(),
      getRowsModified: vi.fn().mockReturnValue(0),
    }

    const result = runAddTokensToSessionsMigration(mockDb as unknown as import('sql.js').Database)

    expect(result).toBe(0)
    expect(mockDb.run).not.toHaveBeenCalled()
  })

  it('should use DEFAULT 0 for all columns', () => {
    const mockDb = createSessionsMockDb(['id', 'agent_id', 'statut'])

    runAddTokensToSessionsMigration(mockDb as unknown as import('sql.js').Database)

    const calls = (mockDb.run as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string)
    // Filter out SAVEPOINT/RELEASE calls to check only ALTER TABLE statements
    const alterCalls = calls.filter(c => c.includes('ALTER TABLE'))
    for (const call of alterCalls) {
      expect(call).toContain('DEFAULT 0')
    }
  })
})

// ── runSessionStatutI18nMigration ──────────────────────────────────────────────

describe('runSessionStatutI18nMigration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function createSessionI18nMockDb(opts: {
    schema?: string
    frenchCount?: number
    existingCols?: string[]
  }): MockDatabase {
    const {
      schema = '',
      frenchCount = 0,
      existingCols = ['id', 'agent_id', 'started_at', 'ended_at', 'updated_at', 'statut', 'summary', 'claude_conv_id', 'tokens_in', 'tokens_out', 'tokens_cache_read', 'tokens_cache_write']
    } = opts

    const pragmaValues = existingCols.map((name, idx) => [idx, name, 'TEXT', 0, null, 0])

    return {
      exec: vi.fn().mockImplementation((query: string) => {
        if (query.includes('sqlite_master') && query.includes('sessions')) {
          if (schema) return [{ columns: ['sql'], values: [[schema]] }]
          return []
        }
        if (query.includes('COUNT(*)') && query.includes("IN ('en_cours'")) {
          return [{ columns: ['count'], values: [[frenchCount]] }]
        }
        if (query.includes('PRAGMA table_info(sessions)')) {
          return [{ columns: ['cid', 'name', 'type', 'notnull', 'dflt_value', 'pk'], values: pragmaValues }]
        }
        return []
      }),
      run: vi.fn(),
      getRowsModified: vi.fn().mockReturnValue(0)
    }
  }

  it('should return 0 when schema is already English and no French values remain (idempotent)', () => {
    const englishSchema = `CREATE TABLE sessions (statut TEXT DEFAULT 'started' CHECK(statut IN ('started','completed','blocked')))`
    const mockDb = createSessionI18nMockDb({ schema: englishSchema, frenchCount: 0 })

    const result = runSessionStatutI18nMigration(mockDb as unknown as import('sql.js').Database)

    expect(result).toBe(0)
    expect(mockDb.run).not.toHaveBeenCalled()
  })

  it('should return 0 when sessions table does not exist', () => {
    const mockDb = createSessionI18nMockDb({ schema: '', frenchCount: 0 })

    const result = runSessionStatutI18nMigration(mockDb as unknown as import('sql.js').Database)

    expect(result).toBe(0)
    expect(mockDb.run).not.toHaveBeenCalled()
  })

  it('should recreate table with English CHECK and convert data when schema is French', () => {
    const frenchSchema = `CREATE TABLE sessions (statut TEXT DEFAULT 'en_cours' CHECK(statut IN ('en_cours','terminé','bloqué')))`
    const mockDb = createSessionI18nMockDb({ schema: frenchSchema, frenchCount: 5 })

    const result = runSessionStatutI18nMigration(mockDb as unknown as import('sql.js').Database)

    expect(result).toBe(5)
    const calls = (mockDb.run as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string)
    // Should use SAVEPOINT
    expect(calls.some(s => s.includes('SAVEPOINT session_i18n'))).toBe(true)
    expect(calls.some(s => s.includes('RELEASE SAVEPOINT session_i18n'))).toBe(true)
    // Should rename old table
    expect(calls.some(s => s.includes('ALTER TABLE sessions RENAME TO sessions_backup_i18n'))).toBe(true)
    // Should create new table with English CHECK
    expect(calls.some(s => s.includes("'started','completed','blocked'"))).toBe(true)
    // Should INSERT SELECT with CASE expression
    expect(calls.some(s => s.includes("WHEN 'en_cours' THEN 'started'"))).toBe(true)
    expect(calls.some(s => s.includes("WHEN 'terminé'  THEN 'completed'"))).toBe(true)
    expect(calls.some(s => s.includes("WHEN 'bloqué'   THEN 'blocked'"))).toBe(true)
    // Should drop backup table
    expect(calls.some(s => s.includes('DROP TABLE sessions_backup_i18n'))).toBe(true)
  })

  it('should UPDATE in-place when schema is already English but French data remains', () => {
    const englishSchema = `CREATE TABLE sessions (statut TEXT DEFAULT 'started' CHECK(statut IN ('started','completed','blocked')))`
    const mockDb = createSessionI18nMockDb({ schema: englishSchema, frenchCount: 3 })
    mockDb.getRowsModified.mockReturnValue(3)

    const result = runSessionStatutI18nMigration(mockDb as unknown as import('sql.js').Database)

    expect(result).toBe(3)
    const calls = (mockDb.run as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string)
    // Should NOT recreate table (no SAVEPOINT, no ALTER TABLE RENAME)
    expect(calls.some(s => s.includes('SAVEPOINT'))).toBe(false)
    expect(calls.some(s => s.includes('ALTER TABLE'))).toBe(false)
    // Should do UPDATE ... SET statut = CASE
    expect(calls.some(s => s.includes('UPDATE sessions SET statut = CASE'))).toBe(true)
    expect(calls.some(s => s.includes("WHEN 'en_cours' THEN 'started'"))).toBe(true)
  })

  it('should use SAVEPOINT for atomicity and ROLLBACK on error', () => {
    const frenchSchema = `CREATE TABLE sessions (statut TEXT DEFAULT 'en_cours' CHECK(statut IN ('en_cours','terminé','bloqué')))`
    const mockDb = createSessionI18nMockDb({ schema: frenchSchema, frenchCount: 2 })
    // Make the ALTER TABLE RENAME fail to test rollback
    mockDb.run.mockImplementation((sql: string) => {
      if (sql.includes('ALTER TABLE sessions RENAME TO')) {
        throw new Error('simulated failure')
      }
    })

    expect(() => {
      runSessionStatutI18nMigration(mockDb as unknown as import('sql.js').Database)
    }).toThrow('simulated failure')

    const calls = (mockDb.run as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string)
    expect(calls.some(s => s.includes('SAVEPOINT session_i18n'))).toBe(true)
    expect(calls.some(s => s.includes('ROLLBACK TO SAVEPOINT session_i18n'))).toBe(true)
    expect(calls.some(s => s.includes('RELEASE SAVEPOINT session_i18n'))).toBe(true)
  })
})

// ── runMakeAgentAssigneNotNullMigration ──────────────────────────────────────

describe('runMakeAgentAssigneNotNullMigration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const allCols = ['id', 'titre', 'description', 'statut', 'agent_createur_id', 'agent_assigne_id', 'agent_valideur_id', 'parent_task_id', 'session_id', 'perimetre', 'effort', 'priority', 'created_at', 'updated_at', 'started_at', 'completed_at', 'validated_at']

  function createNotNullMockDb(opts: {
    notnull?: number // 0 = nullable, 1 = already NOT NULL
    hasReviewAgent?: boolean
    hasAnyAgent?: boolean
  }): MockDatabase {
    const { notnull = 0, hasReviewAgent = true, hasAnyAgent = true } = opts
    const pragmaValues = allCols.map((name, idx) => [
      idx, name, name === 'agent_assigne_id' ? 'INTEGER' : 'TEXT',
      name === 'agent_assigne_id' ? notnull : 0, null, name === 'id' ? 1 : 0
    ])

    return {
      exec: vi.fn().mockImplementation((query: string) => {
        if (query.includes('PRAGMA table_info(tasks)')) {
          return [{ columns: ['cid', 'name', 'type', 'notnull', 'dflt_value', 'pk'], values: pragmaValues }]
        }
        if (query.includes("agents WHERE name = 'review'")) {
          if (hasReviewAgent) return [{ columns: ['id'], values: [[4]] }]
          return []
        }
        if (query.includes('SELECT id FROM agents ORDER BY id LIMIT 1')) {
          if (hasAnyAgent) return [{ columns: ['id'], values: [[1]] }]
          return []
        }
        return []
      }),
      run: vi.fn(),
      getRowsModified: vi.fn().mockReturnValue(0)
    }
  }

  it('should return false when agent_assigne_id is already NOT NULL (idempotent)', () => {
    const mockDb = createNotNullMockDb({ notnull: 1 })

    const result = runMakeAgentAssigneNotNullMigration(mockDb as unknown as import('sql.js').Database)

    expect(result).toBe(false)
    expect(mockDb.run).not.toHaveBeenCalled()
  })

  it('should return false when tasks table does not exist', () => {
    const mockDb: MockDatabase = {
      exec: vi.fn().mockReturnValue([]),
      run: vi.fn(),
      getRowsModified: vi.fn().mockReturnValue(0)
    }

    const result = runMakeAgentAssigneNotNullMigration(mockDb as unknown as import('sql.js').Database)

    expect(result).toBe(false)
    expect(mockDb.run).not.toHaveBeenCalled()
  })

  it('should return false when no agents exist (cannot apply constraint)', () => {
    const mockDb = createNotNullMockDb({ hasReviewAgent: false, hasAnyAgent: false })

    const result = runMakeAgentAssigneNotNullMigration(mockDb as unknown as import('sql.js').Database)

    expect(result).toBe(false)
  })

  it('should assign orphan tasks by perimetre then fallback, and recreate table', () => {
    const mockDb = createNotNullMockDb({ notnull: 0 })

    const result = runMakeAgentAssigneNotNullMigration(mockDb as unknown as import('sql.js').Database)

    expect(result).toBe(true)
    const calls = (mockDb.run as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string)

    // Should update orphans by perimetre match
    expect(calls.some(s => s.includes('UPDATE tasks SET agent_assigne_id') && s.includes('perimetre'))).toBe(true)
    // Should update remaining orphans with fallback agent
    expect(calls.some(s => s.includes('UPDATE tasks SET agent_assigne_id = ?'))).toBe(true)
    // Should use SAVEPOINT
    expect(calls.some(s => s.includes('SAVEPOINT make_assigne_notnull'))).toBe(true)
    // Should rename old table
    expect(calls.some(s => s.includes('ALTER TABLE tasks RENAME TO tasks_backup_notnull'))).toBe(true)
    // Should also update orphan agent_createur_id
    expect(calls.some(s => s.includes('UPDATE tasks SET agent_createur_id') && s.includes('perimetre'))).toBe(true)
    expect(calls.some(s => s.includes('UPDATE tasks SET agent_createur_id = ?'))).toBe(true)
    // Should create new table with NOT NULL on both agent columns
    expect(calls.some(s => s.includes('agent_assigne_id  INTEGER NOT NULL'))).toBe(true)
    expect(calls.some(s => s.includes('agent_createur_id INTEGER NOT NULL'))).toBe(true)
    // Should INSERT SELECT from backup
    expect(calls.some(s => s.includes('INSERT INTO tasks') && s.includes('FROM tasks_backup_notnull'))).toBe(true)
    // Should drop backup table
    expect(calls.some(s => s.includes('DROP TABLE tasks_backup_notnull'))).toBe(true)
    // Should release savepoint
    expect(calls.some(s => s.includes('RELEASE SAVEPOINT make_assigne_notnull'))).toBe(true)
  })

  it('should use first agent as fallback when review agent does not exist', () => {
    const mockDb = createNotNullMockDb({ hasReviewAgent: false, hasAnyAgent: true })

    const result = runMakeAgentAssigneNotNullMigration(mockDb as unknown as import('sql.js').Database)

    expect(result).toBe(true)
    // Fallback UPDATE should use agent id 1 (first agent)
    const updateCalls = (mockDb.run as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('UPDATE tasks SET agent_assigne_id = ?')
    )
    expect(updateCalls.length).toBe(1)
    expect(updateCalls[0][1]).toEqual([1]) // fallback agent id
  })

  it('should rollback on error during table recreation', () => {
    const mockDb = createNotNullMockDb({ notnull: 0 })
    mockDb.run.mockImplementation((sql: string) => {
      if (sql.includes('ALTER TABLE tasks RENAME TO')) {
        throw new Error('simulated failure')
      }
    })

    expect(() => {
      runMakeAgentAssigneNotNullMigration(mockDb as unknown as import('sql.js').Database)
    }).toThrow('simulated failure')

    const calls = (mockDb.run as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string)
    expect(calls.some(s => s.includes('ROLLBACK TO SAVEPOINT make_assigne_notnull'))).toBe(true)
    expect(calls.some(s => s.includes('RELEASE SAVEPOINT make_assigne_notnull'))).toBe(true)
  })
})

// ── runMakeCommentAgentNotNullMigration ──────────────────────────────────────

describe('runMakeCommentAgentNotNullMigration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const commentCols = ['id', 'task_id', 'agent_id', 'contenu', 'created_at']

  function createCommentNotNullMockDb(opts: {
    notnull?: number
    hasReviewAgent?: boolean
    hasAnyAgent?: boolean
  }): MockDatabase {
    const { notnull = 0, hasReviewAgent = true, hasAnyAgent = true } = opts
    const pragmaValues = commentCols.map((name, idx) => [
      idx, name, name === 'agent_id' ? 'INTEGER' : 'TEXT',
      name === 'agent_id' ? notnull : (name === 'task_id' || name === 'contenu' ? 1 : 0),
      null, name === 'id' ? 1 : 0
    ])

    return {
      exec: vi.fn().mockImplementation((query: string) => {
        if (query.includes('PRAGMA table_info(task_comments)')) {
          return [{ columns: ['cid', 'name', 'type', 'notnull', 'dflt_value', 'pk'], values: pragmaValues }]
        }
        if (query.includes("agents WHERE name = 'review'")) {
          if (hasReviewAgent) return [{ columns: ['id'], values: [[4]] }]
          return []
        }
        if (query.includes('SELECT id FROM agents ORDER BY id LIMIT 1')) {
          if (hasAnyAgent) return [{ columns: ['id'], values: [[1]] }]
          return []
        }
        return []
      }),
      run: vi.fn(),
      getRowsModified: vi.fn().mockReturnValue(0)
    }
  }

  it('should return false when agent_id is already NOT NULL (idempotent)', () => {
    const mockDb = createCommentNotNullMockDb({ notnull: 1 })

    const result = runMakeCommentAgentNotNullMigration(mockDb as unknown as import('sql.js').Database)

    expect(result).toBe(false)
    expect(mockDb.run).not.toHaveBeenCalled()
  })

  it('should return false when task_comments table does not exist', () => {
    const mockDb: MockDatabase = {
      exec: vi.fn().mockReturnValue([]),
      run: vi.fn(),
      getRowsModified: vi.fn().mockReturnValue(0)
    }

    const result = runMakeCommentAgentNotNullMigration(mockDb as unknown as import('sql.js').Database)

    expect(result).toBe(false)
    expect(mockDb.run).not.toHaveBeenCalled()
  })

  it('should return false when no agents exist', () => {
    const mockDb = createCommentNotNullMockDb({ hasReviewAgent: false, hasAnyAgent: false })

    const result = runMakeCommentAgentNotNullMigration(mockDb as unknown as import('sql.js').Database)

    expect(result).toBe(false)
  })

  it('should assign orphan comments and recreate table with NOT NULL', () => {
    const mockDb = createCommentNotNullMockDb({ notnull: 0 })

    const result = runMakeCommentAgentNotNullMigration(mockDb as unknown as import('sql.js').Database)

    expect(result).toBe(true)
    const calls = (mockDb.run as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string)

    // Should update orphan comments with fallback agent
    expect(calls.some(s => s.includes('UPDATE task_comments SET agent_id = ?'))).toBe(true)
    // Should use SAVEPOINT
    expect(calls.some(s => s.includes('SAVEPOINT make_comment_agent_notnull'))).toBe(true)
    // Should rename old table
    expect(calls.some(s => s.includes('ALTER TABLE task_comments RENAME TO task_comments_backup_notnull'))).toBe(true)
    // Should create new table with NOT NULL on agent_id
    expect(calls.some(s => s.includes('agent_id   INTEGER NOT NULL'))).toBe(true)
    // Should INSERT SELECT from backup
    expect(calls.some(s => s.includes('INSERT INTO task_comments') && s.includes('FROM task_comments_backup_notnull'))).toBe(true)
    // Should drop backup
    expect(calls.some(s => s.includes('DROP TABLE task_comments_backup_notnull'))).toBe(true)
    // Should release savepoint
    expect(calls.some(s => s.includes('RELEASE SAVEPOINT make_comment_agent_notnull'))).toBe(true)
  })

  it('should rollback on error during table recreation', () => {
    const mockDb = createCommentNotNullMockDb({ notnull: 0 })
    mockDb.run.mockImplementation((sql: string) => {
      if (sql.includes('ALTER TABLE task_comments RENAME TO')) {
        throw new Error('simulated failure')
      }
    })

    expect(() => {
      runMakeCommentAgentNotNullMigration(mockDb as unknown as import('sql.js').Database)
    }).toThrow('simulated failure')

    const calls = (mockDb.run as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string)
    expect(calls.some(s => s.includes('ROLLBACK TO SAVEPOINT make_comment_agent_notnull'))).toBe(true)
    expect(calls.some(s => s.includes('RELEASE SAVEPOINT make_comment_agent_notnull'))).toBe(true)
  })
})

// ── runAddAgentGroupsMigration ─────────────────────────────────────────────────

interface AgentGroupsMockDb {
  exec: ReturnType<typeof vi.fn>
  run: ReturnType<typeof vi.fn>
}

function createAgentGroupsMockDb(agentGroupsExists: boolean): AgentGroupsMockDb {
  return {
    exec: vi.fn().mockImplementation((query: string) => {
      if (query.includes("name='agent_groups'")) {
        return agentGroupsExists
          ? [{ columns: ['name'], values: [['agent_groups']] }]
          : []
      }
      return []
    }),
    run: vi.fn(),
  }
}

describe('runAddAgentGroupsMigration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns false when agent_groups already exists (idempotent)', () => {
    const mockDb = createAgentGroupsMockDb(true)
    const result = runAddAgentGroupsMigration(mockDb as unknown as import('sql.js').Database)
    expect(result).toBe(false)
    expect(mockDb.run).not.toHaveBeenCalled()
  })

  it('returns true when agent_groups does not exist (creates tables)', () => {
    const mockDb = createAgentGroupsMockDb(false)
    const result = runAddAgentGroupsMigration(mockDb as unknown as import('sql.js').Database)
    expect(result).toBe(true)
  })

  it('creates agent_groups table with correct schema', () => {
    const mockDb = createAgentGroupsMockDb(false)
    runAddAgentGroupsMigration(mockDb as unknown as import('sql.js').Database)

    const calls = (mockDb.run as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string)
    const createAgentGroups = calls.find(s => s.includes('CREATE TABLE agent_groups'))
    expect(createAgentGroups).toBeDefined()
    expect(createAgentGroups).toContain('id')
    expect(createAgentGroups).toContain('name')
    expect(createAgentGroups).toContain('sort_order')
    expect(createAgentGroups).toContain('created_at')
  })

  it('creates agent_group_members table with correct schema', () => {
    const mockDb = createAgentGroupsMockDb(false)
    runAddAgentGroupsMigration(mockDb as unknown as import('sql.js').Database)

    const calls = (mockDb.run as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string)
    const createMembers = calls.find(s => s.includes('CREATE TABLE agent_group_members'))
    expect(createMembers).toBeDefined()
    expect(createMembers).toContain('agent_id')
    expect(createMembers).toContain('group_id')
    expect(createMembers).toContain('sort_order')
    expect(createMembers).toContain('UNIQUE(agent_id)')
  })

  it('creates index on agent_group_members(group_id)', () => {
    const mockDb = createAgentGroupsMockDb(false)
    runAddAgentGroupsMigration(mockDb as unknown as import('sql.js').Database)

    const calls = (mockDb.run as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string)
    expect(calls.some(s => s.includes('idx_agm_group') && s.includes('agent_group_members(group_id)'))).toBe(true)
  })

  it('uses SAVEPOINT add_agent_groups for atomicity', () => {
    const mockDb = createAgentGroupsMockDb(false)
    runAddAgentGroupsMigration(mockDb as unknown as import('sql.js').Database)

    const calls = (mockDb.run as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string)
    expect(calls.some(s => s.includes('SAVEPOINT add_agent_groups'))).toBe(true)
    expect(calls.some(s => s.includes('RELEASE SAVEPOINT add_agent_groups'))).toBe(true)
  })

  it('rolls back and rethrows on error', () => {
    const mockDb = createAgentGroupsMockDb(false)
    mockDb.run.mockImplementation((sql: string) => {
      if (sql.includes('CREATE TABLE agent_groups')) {
        throw new Error('disk I/O error')
      }
    })

    expect(() => {
      runAddAgentGroupsMigration(mockDb as unknown as import('sql.js').Database)
    }).toThrow('disk I/O error')

    const calls = (mockDb.run as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string)
    expect(calls.some(s => s.includes('ROLLBACK TO SAVEPOINT add_agent_groups'))).toBe(true)
    expect(calls.some(s => s.includes('RELEASE SAVEPOINT add_agent_groups'))).toBe(true)
  })
})

// ── runAddParentIdToAgentGroupsMigration ───────────────────────────────────────

function createParentIdMockDb(existingCols: string[]): { exec: ReturnType<typeof vi.fn>; run: ReturnType<typeof vi.fn> } {
  const pragmaValues = existingCols.map((name, idx) => [idx, name, 'TEXT', 0, null, 0])
  return {
    exec: vi.fn().mockImplementation((query: string) => {
      if (query.includes('PRAGMA table_info(agent_groups)')) {
        if (existingCols.length === 0) return []
        return [{ columns: ['cid', 'name', 'type', 'notnull', 'dflt_value', 'pk'], values: pragmaValues }]
      }
      return []
    }),
    run: vi.fn(),
  }
}

describe('runAddParentIdToAgentGroupsMigration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns false when agent_groups table does not exist', () => {
    const mockDb = createParentIdMockDb([])
    const result = runAddParentIdToAgentGroupsMigration(mockDb as unknown as import('sql.js').Database)
    expect(result).toBe(false)
    expect(mockDb.run).not.toHaveBeenCalled()
  })

  it('returns false when parent_id column already exists (idempotent)', () => {
    const mockDb = createParentIdMockDb(['id', 'name', 'sort_order', 'created_at', 'parent_id'])
    const result = runAddParentIdToAgentGroupsMigration(mockDb as unknown as import('sql.js').Database)
    expect(result).toBe(false)
    expect(mockDb.run).not.toHaveBeenCalled()
  })

  it('returns true and runs ALTER TABLE when parent_id is missing', () => {
    const mockDb = createParentIdMockDb(['id', 'name', 'sort_order', 'created_at'])
    const result = runAddParentIdToAgentGroupsMigration(mockDb as unknown as import('sql.js').Database)
    expect(result).toBe(true)
    expect(mockDb.run).toHaveBeenCalledWith('ALTER TABLE agent_groups ADD COLUMN parent_id INTEGER')
  })

  it('runs exactly one db.run call (no extra ops)', () => {
    const mockDb = createParentIdMockDb(['id', 'name', 'sort_order', 'created_at'])
    runAddParentIdToAgentGroupsMigration(mockDb as unknown as import('sql.js').Database)
    expect(mockDb.run).toHaveBeenCalledTimes(1)
  })
})

// ── migrateDb bootstrap (T958) ────────────────────────────────────────────────

describe('migrateDb bootstrap (T958)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  /** Legacy DB: user_version=0, config table with schema_version, agent_groups without parent_id */
  function createLegacyBootstrapMockDb() {
    const agentGroupCols = ['id', 'name', 'sort_order', 'created_at']
    const agentGroupPragmaValues = agentGroupCols.map((name, idx) => [idx, name, 'TEXT', 0, null, 0])
    return {
      exec: vi.fn().mockImplementation((query: string) => {
        if (query.includes('PRAGMA user_version')) {
          return [{ columns: ['user_version'], values: [[0]] }]
        }
        if (query.includes('schema_version')) {
          return [{ columns: ['value'], values: [['23']] }]
        }
        if (query.includes('PRAGMA table_info(agent_groups)')) {
          return [{ columns: ['cid', 'name', 'type', 'notnull', 'dflt_value', 'pk'], values: agentGroupPragmaValues }]
        }
        return []
      }),
      run: vi.fn(),
    }
  }

  it('sets user_version to 23 (bootstrap cursor) for legacy DB', () => {
    const mockDb = createLegacyBootstrapMockDb()
    migrateDb(mockDb as unknown as import('sql.js').Database)
    expect(mockDb.run).toHaveBeenCalledWith('PRAGMA user_version = 23')
  })

  it('runs v24 migration (ALTER TABLE agent_groups ADD COLUMN parent_id) on legacy DB', () => {
    const mockDb = createLegacyBootstrapMockDb()
    migrateDb(mockDb as unknown as import('sql.js').Database)
    expect(mockDb.run).toHaveBeenCalledWith('ALTER TABLE agent_groups ADD COLUMN parent_id INTEGER')
  })

  it('returns 5 (v24–v28 applied) for legacy DB with cursor set to 23', () => {
    const mockDb = createLegacyBootstrapMockDb()
    const result = migrateDb(mockDb as unknown as import('sql.js').Database)
    expect(result).toBe(5)
  })

  it('runs all migrations from scratch when user_version=0 and no config table', () => {
    const mockDb = {
      exec: vi.fn().mockImplementation((query: string) => {
        if (query.includes('PRAGMA user_version')) return [{ columns: ['user_version'], values: [[0]] }]
        return []  // no config table → bootstrap skipped
      }),
      run: vi.fn(),
    }
    const result = migrateDb(mockDb as unknown as import('sql.js').Database)
    expect(result).toBe(CURRENT_SCHEMA_VERSION)
  })
})
