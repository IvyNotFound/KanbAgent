import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runDropCommentaireColumnMigration, runAddTokensToSessionsMigration, runSessionStatutI18nMigration, runMakeCommentAgentNotNullMigration } from './migration'

// Mock Database for sql.js
interface MockDatabase {
  exec: ReturnType<typeof vi.fn>
  run: ReturnType<typeof vi.fn>
  getRowsModified: ReturnType<typeof vi.fn>
}

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

    const result = runDropCommentaireColumnMigration(mockDb as unknown as import('./migration-db-adapter').MigrationDb)

    expect(result).toBe(0)
    expect(mockDb.run).not.toHaveBeenCalled()
  })

  it('should migrate rows and drop column when commentaire column exists', () => {
    const mockDb = createCommentaireMockDb(['id', 'titre', 'commentaire', 'statut'])

    const result = runDropCommentaireColumnMigration(mockDb as unknown as import('./migration-db-adapter').MigrationDb)

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

    const first = runDropCommentaireColumnMigration(mockDb as unknown as import('./migration-db-adapter').MigrationDb)
    expect(first).toBe(0)
    expect(mockDb.run).not.toHaveBeenCalled()

    const second = runDropCommentaireColumnMigration(mockDb as unknown as import('./migration-db-adapter').MigrationDb)
    expect(second).toBe(0)
    expect(mockDb.run).not.toHaveBeenCalled()
  })

  it('should filter only non-null and non-empty commentaire values via WHERE clause', () => {
    const mockDb = createCommentaireMockDb(['id', 'titre', 'commentaire', 'statut'])

    runDropCommentaireColumnMigration(mockDb as unknown as import('./migration-db-adapter').MigrationDb)

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

    const result = runAddTokensToSessionsMigration(mockDb as unknown as import('./migration-db-adapter').MigrationDb)

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

    const result = runAddTokensToSessionsMigration(mockDb as unknown as import('./migration-db-adapter').MigrationDb)

    expect(result).toBe(0)
    expect(mockDb.run).not.toHaveBeenCalled()
  })

  it('should only add missing columns (partial migration)', () => {
    const mockDb = createSessionsMockDb(['id', 'agent_id', 'statut', 'tokens_in', 'tokens_out'])

    const result = runAddTokensToSessionsMigration(mockDb as unknown as import('./migration-db-adapter').MigrationDb)

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

    const result = runAddTokensToSessionsMigration(mockDb as unknown as import('./migration-db-adapter').MigrationDb)

    expect(result).toBe(0)
    expect(mockDb.run).not.toHaveBeenCalled()
  })

  it('should use DEFAULT 0 for all columns', () => {
    const mockDb = createSessionsMockDb(['id', 'agent_id', 'statut'])

    runAddTokensToSessionsMigration(mockDb as unknown as import('./migration-db-adapter').MigrationDb)

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

    const result = runSessionStatutI18nMigration(mockDb as unknown as import('./migration-db-adapter').MigrationDb)

    expect(result).toBe(0)
    expect(mockDb.run).not.toHaveBeenCalled()
  })

  it('should return 0 when sessions table does not exist', () => {
    const mockDb = createSessionI18nMockDb({ schema: '', frenchCount: 0 })

    const result = runSessionStatutI18nMigration(mockDb as unknown as import('./migration-db-adapter').MigrationDb)

    expect(result).toBe(0)
    expect(mockDb.run).not.toHaveBeenCalled()
  })

  it('should recreate table with English CHECK and convert data when schema is French', () => {
    const frenchSchema = `CREATE TABLE sessions (statut TEXT DEFAULT 'en_cours' CHECK(statut IN ('en_cours','terminé','bloqué')))`
    const mockDb = createSessionI18nMockDb({ schema: frenchSchema, frenchCount: 5 })

    const result = runSessionStatutI18nMigration(mockDb as unknown as import('./migration-db-adapter').MigrationDb)

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

    const result = runSessionStatutI18nMigration(mockDb as unknown as import('./migration-db-adapter').MigrationDb)

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
      runSessionStatutI18nMigration(mockDb as unknown as import('./migration-db-adapter').MigrationDb)
    }).toThrow('simulated failure')

    const calls = (mockDb.run as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string)
    expect(calls.some(s => s.includes('SAVEPOINT session_i18n'))).toBe(true)
    expect(calls.some(s => s.includes('ROLLBACK TO SAVEPOINT session_i18n'))).toBe(true)
    expect(calls.some(s => s.includes('RELEASE SAVEPOINT session_i18n'))).toBe(true)
  })
})

// ── runMakeCommentAgentNotNullMigration ──────────────────────────────────────
