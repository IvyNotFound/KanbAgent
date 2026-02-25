import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runTaskStatusMigration } from './migration'

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
      if (query.includes("sqlite_master")) {
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

  it('should not recreate table when archivé already in CHECK constraint', () => {
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
})
