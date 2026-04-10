import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runDropCommentaireColumnMigration, runAddTokensToSessionsMigration, runSessionStatutI18nMigration, runMakeCommentAgentNotNullMigration } from './migration'

// Mock Database for sql.js
interface MockDatabase {
  exec: ReturnType<typeof vi.fn>
  run: ReturnType<typeof vi.fn>
  getRowsModified: ReturnType<typeof vi.fn>
}

// ── runDropCommentaireColumnMigration ────────────────────────────────────────────

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

    const result = runMakeCommentAgentNotNullMigration(mockDb as unknown as import('./migration-db-adapter').MigrationDb)

    expect(result).toBe(false)
    expect(mockDb.run).not.toHaveBeenCalled()
  })

  it('should return false when task_comments table does not exist', () => {
    const mockDb: MockDatabase = {
      exec: vi.fn().mockReturnValue([]),
      run: vi.fn(),
      getRowsModified: vi.fn().mockReturnValue(0)
    }

    const result = runMakeCommentAgentNotNullMigration(mockDb as unknown as import('./migration-db-adapter').MigrationDb)

    expect(result).toBe(false)
    expect(mockDb.run).not.toHaveBeenCalled()
  })

  it('should return false when no agents exist', () => {
    const mockDb = createCommentNotNullMockDb({ hasReviewAgent: false, hasAnyAgent: false })

    const result = runMakeCommentAgentNotNullMigration(mockDb as unknown as import('./migration-db-adapter').MigrationDb)

    expect(result).toBe(false)
  })

  it('should assign orphan comments and recreate table with NOT NULL', () => {
    const mockDb = createCommentNotNullMockDb({ notnull: 0 })

    const result = runMakeCommentAgentNotNullMigration(mockDb as unknown as import('./migration-db-adapter').MigrationDb)

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
      runMakeCommentAgentNotNullMigration(mockDb as unknown as import('./migration-db-adapter').MigrationDb)
    }).toThrow('simulated failure')

    const calls = (mockDb.run as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string)
    expect(calls.some(s => s.includes('ROLLBACK TO SAVEPOINT make_comment_agent_notnull'))).toBe(true)
    expect(calls.some(s => s.includes('RELEASE SAVEPOINT make_comment_agent_notnull'))).toBe(true)
  })
})
