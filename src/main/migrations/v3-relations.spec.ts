/**
 * Tests for v3-relations.ts migrations.
 * Uses mock MigrationDb (no real better-sqlite3).
 *
 * Coverage:
 *   - runMakeAgentAssigneNotNullMigration
 *   - runMakeCommentAgentNotNullMigration
 *   - runAddAgentGroupsMigration
 */

import { describe, it, expect, vi } from 'vitest'
import type { MigrationDb } from '../migration-db-adapter'
import {
  runMakeAgentAssigneNotNullMigration,
  runMakeCommentAgentNotNullMigration,
  runAddAgentGroupsMigration,
} from './v3-relations'

// ── Mock helpers ──────────────────────────────────────────────────────────────

type MockDb = {
  exec: ReturnType<typeof vi.fn>
  run: ReturnType<typeof vi.fn>
  getRowsModified: ReturnType<typeof vi.fn>
  prepare: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
}

function makeDb(overrides: Partial<MockDb> = {}): MockDb {
  return {
    exec: vi.fn().mockReturnValue([]),
    run: vi.fn(),
    getRowsModified: vi.fn().mockReturnValue(0),
    prepare: vi.fn(),
    close: vi.fn(),
    ...overrides,
  }
}

function asDb(db: MockDb): MigrationDb {
  return db as unknown as MigrationDb
}

// PRAGMA table_info row format: [cid, name, type, notnull, dflt_value, pk]
function colPragma(cols: Array<{ name: string; notnull?: number }>) {
  return [{
    columns: ['cid','name','type','notnull','dflt_value','pk'],
    values: cols.map(({ name, notnull = 0 }, i) => [i, name, 'TEXT', notnull, null, i === 0 ? 1 : 0]),
  }]
}

// ── runMakeAgentAssigneNotNullMigration ────────────────────────────────────────

describe('runMakeAgentAssigneNotNullMigration', () => {
  it('returns false when tasks table does not exist', () => {
    const db = makeDb({ exec: vi.fn().mockReturnValue([]) })
    expect(runMakeAgentAssigneNotNullMigration(asDb(db))).toBe(false)
    expect(db.run).not.toHaveBeenCalled()
  })

  it('returns false when agent_assigne_id column does not exist', () => {
    const db = makeDb({
      exec: vi.fn().mockReturnValue(colPragma([{ name: 'id' }, { name: 'titre' }, { name: 'statut' }])),
    })
    expect(runMakeAgentAssigneNotNullMigration(asDb(db))).toBe(false)
  })

  it('returns false when agent_assigne_id is already NOT NULL (notnull=1)', () => {
    const db = makeDb({
      exec: vi.fn().mockReturnValue(colPragma([
        { name: 'id' },
        { name: 'agent_assigne_id', notnull: 1 },
      ])),
    })
    expect(runMakeAgentAssigneNotNullMigration(asDb(db))).toBe(false)
    expect(db.run).not.toHaveBeenCalled()
  })

  it('returns false when no agents exist (fallbackAgentId = null)', () => {
    const db = makeDb({
      exec: vi.fn()
        .mockReturnValueOnce(colPragma([{ name: 'id' }, { name: 'agent_assigne_id', notnull: 0 }])) // PRAGMA tasks
        .mockReturnValueOnce([]) // SELECT id FROM agents WHERE name = 'review'
        .mockReturnValueOnce([]), // SELECT id FROM agents ORDER BY id
    })
    expect(runMakeAgentAssigneNotNullMigration(asDb(db))).toBe(false)
  })

  it('applies migration and returns true when agents exist', () => {
    const db = makeDb({
      exec: vi.fn()
        .mockReturnValueOnce(colPragma([{ name: 'id' }, { name: 'titre' }, { name: 'statut' }, { name: 'agent_assigne_id', notnull: 0 }, { name: 'agent_createur_id', notnull: 0 }, { name: 'perimetre' }, { name: 'priority' }, { name: 'created_at' }, { name: 'updated_at' }])) // PRAGMA tasks
        .mockReturnValueOnce([{ columns: ['id'], values: [[1]] }]) // review agent
        .mockReturnValue([{ columns: ['cid','name'], values: [[0,'id'],[1,'titre']] }]),
    })
    const result = runMakeAgentAssigneNotNullMigration(asDb(db))
    expect(result).toBe(true)
  })

  it('runs UPDATE to assign orphan tasks before recreation', () => {
    const db = makeDb({
      exec: vi.fn()
        .mockReturnValueOnce(colPragma([{ name: 'id' }, { name: 'agent_assigne_id', notnull: 0 }, { name: 'perimetre' }, { name: 'priority' }, { name: 'created_at' }, { name: 'updated_at' }]))
        .mockReturnValueOnce([{ columns: ['id'], values: [[5]] }]) // review agent id=5
        .mockReturnValue([{ columns: ['cid','name'], values: [[0,'id'],[1,'agent_assigne_id']] }]),
    })
    runMakeAgentAssigneNotNullMigration(asDb(db))
    const calls = (db.run as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string)
    // Should UPDATE tasks SET agent_assigne_id = ? WHERE agent_assigne_id IS NULL
    expect(calls.some(s => s.includes('UPDATE tasks') && s.includes('agent_assigne_id IS NULL'))).toBe(true)
  })

  it('uses SAVEPOINT for atomicity', () => {
    const db = makeDb({
      exec: vi.fn()
        .mockReturnValueOnce(colPragma([{ name: 'id' }, { name: 'agent_assigne_id', notnull: 0 }, { name: 'priority' }, { name: 'created_at' }, { name: 'updated_at' }]))
        .mockReturnValueOnce([{ columns: ['id'], values: [[1]] }])
        .mockReturnValue([{ columns: ['cid','name'], values: [[0,'id']] }]),
    })
    runMakeAgentAssigneNotNullMigration(asDb(db))
    const calls = (db.run as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string)
    expect(calls.some(s => s.includes('SAVEPOINT'))).toBe(true)
    expect(calls.some(s => s.includes('RELEASE SAVEPOINT'))).toBe(true)
  })

  it('recreated tasks table has agent_assigne_id and agent_createur_id NOT NULL', () => {
    const db = makeDb({
      exec: vi.fn()
        .mockReturnValueOnce(colPragma([{ name: 'id' }, { name: 'titre' }, { name: 'agent_assigne_id', notnull: 0 }, { name: 'agent_createur_id', notnull: 0 }, { name: 'priority' }, { name: 'created_at' }, { name: 'updated_at' }]))
        .mockReturnValueOnce([{ columns: ['id'], values: [[1]] }])
        .mockReturnValue([{ columns: ['cid','name'], values: [[0,'id'],[1,'titre']] }]),
    })
    runMakeAgentAssigneNotNullMigration(asDb(db))
    const calls = (db.run as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string)
    const createSql = calls.find(s => s.includes('CREATE TABLE tasks'))
    expect(createSql).toContain('agent_assigne_id  INTEGER NOT NULL')
    expect(createSql).toContain('agent_createur_id INTEGER NOT NULL')
  })
})

// ── runMakeCommentAgentNotNullMigration ────────────────────────────────────────

describe('runMakeCommentAgentNotNullMigration', () => {
  it('returns false when task_comments table does not exist', () => {
    const db = makeDb({ exec: vi.fn().mockReturnValue([]) })
    expect(runMakeCommentAgentNotNullMigration(asDb(db))).toBe(false)
    expect(db.run).not.toHaveBeenCalled()
  })

  it('returns false when agent_id column does not exist in task_comments', () => {
    const db = makeDb({
      exec: vi.fn().mockReturnValue(colPragma([{ name: 'id' }, { name: 'task_id' }, { name: 'contenu' }])),
    })
    expect(runMakeCommentAgentNotNullMigration(asDb(db))).toBe(false)
  })

  it('returns false when agent_id is already NOT NULL', () => {
    const db = makeDb({
      exec: vi.fn().mockReturnValue(colPragma([
        { name: 'id' },
        { name: 'task_id' },
        { name: 'agent_id', notnull: 1 },
        { name: 'contenu' },
      ])),
    })
    expect(runMakeCommentAgentNotNullMigration(asDb(db))).toBe(false)
  })

  it('returns false when no agents exist', () => {
    const db = makeDb({
      exec: vi.fn()
        .mockReturnValueOnce(colPragma([{ name: 'id' }, { name: 'agent_id', notnull: 0 }, { name: 'contenu' }]))
        .mockReturnValueOnce([]) // review agent not found
        .mockReturnValueOnce([]), // any agent not found
    })
    expect(runMakeCommentAgentNotNullMigration(asDb(db))).toBe(false)
  })

  it('applies migration and returns true', () => {
    const db = makeDb({
      exec: vi.fn()
        .mockReturnValueOnce(colPragma([{ name: 'id' }, { name: 'task_id' }, { name: 'agent_id', notnull: 0 }, { name: 'contenu' }, { name: 'created_at' }]))
        .mockReturnValueOnce([{ columns: ['id'], values: [[2]] }]) // review agent
        .mockReturnValue([{ columns: ['cid','name'], values: [[0,'id'],[1,'agent_id']] }]),
    })
    expect(runMakeCommentAgentNotNullMigration(asDb(db))).toBe(true)
  })

  it('runs UPDATE to assign orphan comments to fallback agent', () => {
    const db = makeDb({
      exec: vi.fn()
        .mockReturnValueOnce(colPragma([{ name: 'id' }, { name: 'agent_id', notnull: 0 }, { name: 'contenu' }, { name: 'created_at' }]))
        .mockReturnValueOnce([{ columns: ['id'], values: [[3]] }]) // review agent id=3
        .mockReturnValue([{ columns: ['cid','name'], values: [[0,'id']] }]),
    })
    runMakeCommentAgentNotNullMigration(asDb(db))
    const calls = (db.run as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string)
    expect(calls.some(s => s.includes('UPDATE task_comments') && s.includes('agent_id IS NULL'))).toBe(true)
  })

  it('uses SAVEPOINT for atomicity', () => {
    const db = makeDb({
      exec: vi.fn()
        .mockReturnValueOnce(colPragma([{ name: 'id' }, { name: 'agent_id', notnull: 0 }, { name: 'contenu' }, { name: 'created_at' }]))
        .mockReturnValueOnce([{ columns: ['id'], values: [[1]] }])
        .mockReturnValue([{ columns: ['cid','name'], values: [[0,'id']] }]),
    })
    runMakeCommentAgentNotNullMigration(asDb(db))
    const calls = (db.run as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string)
    expect(calls.some(s => s.includes('SAVEPOINT'))).toBe(true)
    expect(calls.some(s => s.includes('RELEASE SAVEPOINT'))).toBe(true)
  })

  it('recreated task_comments table has agent_id NOT NULL', () => {
    const db = makeDb({
      exec: vi.fn()
        .mockReturnValueOnce(colPragma([{ name: 'id' }, { name: 'task_id' }, { name: 'agent_id', notnull: 0 }, { name: 'contenu' }, { name: 'created_at' }]))
        .mockReturnValueOnce([{ columns: ['id'], values: [[1]] }])
        .mockReturnValue([{ columns: ['cid','name'], values: [[0,'id'],[1,'agent_id']] }]),
    })
    runMakeCommentAgentNotNullMigration(asDb(db))
    const calls = (db.run as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string)
    const createSql = calls.find(s => s.includes('CREATE TABLE task_comments'))
    expect(createSql).toContain('agent_id   INTEGER NOT NULL')
  })
})

// ── runAddAgentGroupsMigration ─────────────────────────────────────────────────

describe('runAddAgentGroupsMigration', () => {
  it('returns false when agent_groups already exists', () => {
    const db = makeDb({
      exec: vi.fn().mockReturnValue([{ columns: ['name'], values: [['agent_groups']] }]),
    })
    expect(runAddAgentGroupsMigration(asDb(db))).toBe(false)
    expect(db.run).not.toHaveBeenCalled()
  })

  it('returns true and creates both tables when agent_groups absent', () => {
    const db = makeDb({
      exec: vi.fn().mockReturnValue([]), // agent_groups does not exist
    })
    const result = runAddAgentGroupsMigration(asDb(db))
    expect(result).toBe(true)
    const calls = (db.run as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string)
    expect(calls.some(s => s.includes('CREATE TABLE agent_groups'))).toBe(true)
    expect(calls.some(s => s.includes('CREATE TABLE agent_group_members'))).toBe(true)
  })

  it('creates index on agent_group_members(group_id)', () => {
    const db = makeDb({ exec: vi.fn().mockReturnValue([]) })
    runAddAgentGroupsMigration(asDb(db))
    const calls = (db.run as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string)
    expect(calls.some(s => s.includes('CREATE INDEX') && s.includes('idx_agm_group'))).toBe(true)
  })

  it('uses SAVEPOINT for atomicity', () => {
    const db = makeDb({ exec: vi.fn().mockReturnValue([]) })
    runAddAgentGroupsMigration(asDb(db))
    const calls = (db.run as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string)
    expect(calls.some(s => s.includes('SAVEPOINT add_agent_groups'))).toBe(true)
    expect(calls.some(s => s.includes('RELEASE SAVEPOINT add_agent_groups'))).toBe(true)
  })

  it('agent_groups table has correct columns in schema', () => {
    const db = makeDb({ exec: vi.fn().mockReturnValue([]) })
    runAddAgentGroupsMigration(asDb(db))
    const calls = (db.run as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string)
    const createSql = calls.find(s => s.includes('CREATE TABLE agent_groups'))
    expect(createSql).toContain('id')
    expect(createSql).toContain('name')
    expect(createSql).toContain('sort_order')
    expect(createSql).toContain('created_at')
  })

  it('agent_group_members table has UNIQUE(agent_id) constraint', () => {
    const db = makeDb({ exec: vi.fn().mockReturnValue([]) })
    runAddAgentGroupsMigration(asDb(db))
    const calls = (db.run as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string)
    const createSql = calls.find(s => s.includes('CREATE TABLE agent_group_members'))
    expect(createSql).toContain('UNIQUE(agent_id)')
  })
})
