import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runMakeAgentAssigneNotNullMigration, runAddAgentGroupsMigration, runAddParentIdToAgentGroupsMigration, migrateDb, CURRENT_SCHEMA_VERSION } from './migration'

// Mock Database for sql.js
interface MockDatabase {
  exec: ReturnType<typeof vi.fn>
  run: ReturnType<typeof vi.fn>
  getRowsModified: ReturnType<typeof vi.fn>
}

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

    const result = runMakeAgentAssigneNotNullMigration(mockDb as unknown as import('./migration-db-adapter').MigrationDb)

    expect(result).toBe(false)
    expect(mockDb.run).not.toHaveBeenCalled()
  })

  it('should return false when tasks table does not exist', () => {
    const mockDb: MockDatabase = {
      exec: vi.fn().mockReturnValue([]),
      run: vi.fn(),
      getRowsModified: vi.fn().mockReturnValue(0)
    }

    const result = runMakeAgentAssigneNotNullMigration(mockDb as unknown as import('./migration-db-adapter').MigrationDb)

    expect(result).toBe(false)
    expect(mockDb.run).not.toHaveBeenCalled()
  })

  it('should return false when no agents exist (cannot apply constraint)', () => {
    const mockDb = createNotNullMockDb({ hasReviewAgent: false, hasAnyAgent: false })

    const result = runMakeAgentAssigneNotNullMigration(mockDb as unknown as import('./migration-db-adapter').MigrationDb)

    expect(result).toBe(false)
  })

  it('should assign orphan tasks by perimetre then fallback, and recreate table', () => {
    const mockDb = createNotNullMockDb({ notnull: 0 })

    const result = runMakeAgentAssigneNotNullMigration(mockDb as unknown as import('./migration-db-adapter').MigrationDb)

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

    const result = runMakeAgentAssigneNotNullMigration(mockDb as unknown as import('./migration-db-adapter').MigrationDb)

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
      runMakeAgentAssigneNotNullMigration(mockDb as unknown as import('./migration-db-adapter').MigrationDb)
    }).toThrow('simulated failure')

    const calls = (mockDb.run as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string)
    expect(calls.some(s => s.includes('ROLLBACK TO SAVEPOINT make_assigne_notnull'))).toBe(true)
    expect(calls.some(s => s.includes('RELEASE SAVEPOINT make_assigne_notnull'))).toBe(true)
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
    const result = runAddAgentGroupsMigration(mockDb as unknown as import('./migration-db-adapter').MigrationDb)
    expect(result).toBe(false)
    expect(mockDb.run).not.toHaveBeenCalled()
  })

  it('returns true when agent_groups does not exist (creates tables)', () => {
    const mockDb = createAgentGroupsMockDb(false)
    const result = runAddAgentGroupsMigration(mockDb as unknown as import('./migration-db-adapter').MigrationDb)
    expect(result).toBe(true)
  })

  it('creates agent_groups table with correct schema', () => {
    const mockDb = createAgentGroupsMockDb(false)
    runAddAgentGroupsMigration(mockDb as unknown as import('./migration-db-adapter').MigrationDb)

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
    runAddAgentGroupsMigration(mockDb as unknown as import('./migration-db-adapter').MigrationDb)

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
    runAddAgentGroupsMigration(mockDb as unknown as import('./migration-db-adapter').MigrationDb)

    const calls = (mockDb.run as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string)
    expect(calls.some(s => s.includes('idx_agm_group') && s.includes('agent_group_members(group_id)'))).toBe(true)
  })

  it('uses SAVEPOINT add_agent_groups for atomicity', () => {
    const mockDb = createAgentGroupsMockDb(false)
    runAddAgentGroupsMigration(mockDb as unknown as import('./migration-db-adapter').MigrationDb)

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
      runAddAgentGroupsMigration(mockDb as unknown as import('./migration-db-adapter').MigrationDb)
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
    const result = runAddParentIdToAgentGroupsMigration(mockDb as unknown as import('./migration-db-adapter').MigrationDb)
    expect(result).toBe(false)
    expect(mockDb.run).not.toHaveBeenCalled()
  })

  it('returns false when parent_id column already exists (idempotent)', () => {
    const mockDb = createParentIdMockDb(['id', 'name', 'sort_order', 'created_at', 'parent_id'])
    const result = runAddParentIdToAgentGroupsMigration(mockDb as unknown as import('./migration-db-adapter').MigrationDb)
    expect(result).toBe(false)
    expect(mockDb.run).not.toHaveBeenCalled()
  })

  it('returns true and runs ALTER TABLE when parent_id is missing', () => {
    const mockDb = createParentIdMockDb(['id', 'name', 'sort_order', 'created_at'])
    const result = runAddParentIdToAgentGroupsMigration(mockDb as unknown as import('./migration-db-adapter').MigrationDb)
    expect(result).toBe(true)
    expect(mockDb.run).toHaveBeenCalledWith('ALTER TABLE agent_groups ADD COLUMN parent_id INTEGER')
  })

  it('runs exactly one db.run call (no extra ops)', () => {
    const mockDb = createParentIdMockDb(['id', 'name', 'sort_order', 'created_at'])
    runAddParentIdToAgentGroupsMigration(mockDb as unknown as import('./migration-db-adapter').MigrationDb)
    expect(mockDb.run).toHaveBeenCalledTimes(1)
  })
})

// ── migrateDb bootstrap (T958) ────────────────────────────────────────────────

describe('migrateDb bootstrap (T958)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  /** Legacy DB: user_version=0, config table with schema_version, agent_groups without parent_id.
   * agents includes permission_mode+max_sessions so the bootstrap guard passes. */
  function createLegacyBootstrapMockDb() {
    const agentGroupCols = ['id', 'name', 'sort_order', 'created_at']
    const agentGroupPragmaValues = agentGroupCols.map((name, idx) => [idx, name, 'TEXT', 0, null, 0])
    // Genuine legacy KanbAgent DB: already has permission_mode and max_sessions
    const agentCols = ['id', 'name', 'scope', 'system_prompt', 'system_prompt_suffix',
      'thinking_mode', 'allowed_tools', 'auto_launch', 'permission_mode', 'max_sessions']
    const agentPragmaValues = agentCols.map((name, idx) => [idx, name, 'TEXT', 0, null, 0])
    return {
      exec: vi.fn().mockImplementation((query: string) => {
        if (query.includes('PRAGMA user_version')) {
          return [{ columns: ['user_version'], values: [[0]] }]
        }
        if (query.includes('schema_version')) {
          return [{ columns: ['value'], values: [['23']] }]
        }
        if (query.includes('PRAGMA table_info(agents)')) {
          return [{ columns: ['cid', 'name', 'type', 'notnull', 'dflt_value', 'pk'], values: agentPragmaValues }]
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
    migrateDb(mockDb as unknown as import('./migration-db-adapter').MigrationDb)
    expect(mockDb.run).toHaveBeenCalledWith('PRAGMA user_version = 23')
  })

  it('runs v24 migration (ALTER TABLE agent_groups ADD COLUMN parent_id) on legacy DB', () => {
    const mockDb = createLegacyBootstrapMockDb()
    migrateDb(mockDb as unknown as import('./migration-db-adapter').MigrationDb)
    expect(mockDb.run).toHaveBeenCalledWith('ALTER TABLE agent_groups ADD COLUMN parent_id INTEGER')
  })

  it('returns 7 (v24–v30 applied) for legacy DB with cursor set to 23', () => {
    const mockDb = createLegacyBootstrapMockDb()
    const result = migrateDb(mockDb as unknown as import('./migration-db-adapter').MigrationDb)
    expect(result).toBe(7)
  })

  it('runs all migrations from scratch when user_version=0 and no config table', () => {
    const mockDb = {
      exec: vi.fn().mockImplementation((query: string) => {
        if (query.includes('PRAGMA user_version')) return [{ columns: ['user_version'], values: [[0]] }]
        return []  // no config table → bootstrap skipped
      }),
      run: vi.fn(),
    }
    const result = migrateDb(mockDb as unknown as import('./migration-db-adapter').MigrationDb)
    expect(result).toBe(CURRENT_SCHEMA_VERSION)
  })
})
