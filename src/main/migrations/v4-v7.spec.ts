/**
 * Tests for v4–v7 small migrations.
 * Uses mock MigrationDb (no real better-sqlite3).
 *
 * Coverage:
 *   - v4: runAddParentIdToAgentGroupsMigration
 *   - v5: runAddWorktreeToAgentsMigration
 *   - v6: runFixTasksSessionFkMigration
 *   - v7: runAddPreferredModelToAgentsMigration
 */

import { describe, it, expect, vi } from 'vitest'
import type { MigrationDb } from '../migration-db-adapter'
import { runAddParentIdToAgentGroupsMigration } from './v4-agent-groups-hierarchy'
import { runAddWorktreeToAgentsMigration } from './v5-agent-worktree'
import { runFixTasksSessionFkMigration } from './v6-tasks-session-fk'
import { runAddPreferredModelToAgentsMigration } from './v7-agent-preferred-model'

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

function colPragma(names: string[]) {
  return [{ columns: ['cid','name','type','notnull','dflt_value','pk'], values: names.map((n,i) => [i,n,'TEXT',0,null,i===0?1:0]) }]
}

// ── v4: runAddParentIdToAgentGroupsMigration ──────────────────────────────────

describe('runAddParentIdToAgentGroupsMigration', () => {
  it('returns false when agent_groups table does not exist (exec returns [])', () => {
    const db = makeDb({ exec: vi.fn().mockReturnValue([]) })
    expect(runAddParentIdToAgentGroupsMigration(asDb(db))).toBe(false)
    expect(db.run).not.toHaveBeenCalled()
  })

  it('returns false when result rows are empty', () => {
    const db = makeDb({
      exec: vi.fn().mockReturnValue([{ columns: ['cid','name'], values: [] }]),
    })
    expect(runAddParentIdToAgentGroupsMigration(asDb(db))).toBe(false)
    expect(db.run).not.toHaveBeenCalled()
  })

  it('returns false when parent_id already exists', () => {
    const db = makeDb({ exec: vi.fn().mockReturnValue(colPragma(['id','name','sort_order','parent_id'])) })
    expect(runAddParentIdToAgentGroupsMigration(asDb(db))).toBe(false)
    expect(db.run).not.toHaveBeenCalled()
  })

  it('runs ALTER TABLE ADD COLUMN and returns true when parent_id absent', () => {
    const db = makeDb({ exec: vi.fn().mockReturnValue(colPragma(['id','name','sort_order'])) })
    const result = runAddParentIdToAgentGroupsMigration(asDb(db))
    expect(result).toBe(true)
    const calls = (db.run as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string)
    expect(calls.some(s => s.includes('ADD COLUMN parent_id INTEGER'))).toBe(true)
  })

  it('parent_id is added without FK or NOT NULL constraint', () => {
    const db = makeDb({ exec: vi.fn().mockReturnValue(colPragma(['id','name'])) })
    runAddParentIdToAgentGroupsMigration(asDb(db))
    const calls = (db.run as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string)
    const sql = calls.find(s => s.includes('parent_id'))
    // Should be nullable INTEGER with no DEFAULT
    expect(sql).toContain('parent_id INTEGER')
    expect(sql).not.toContain('NOT NULL')
    expect(sql).not.toContain('DEFAULT')
  })
})

// ── v5: runAddWorktreeToAgentsMigration ───────────────────────────────────────

describe('runAddWorktreeToAgentsMigration', () => {
  it('returns false when agents table does not exist', () => {
    const db = makeDb({ exec: vi.fn().mockReturnValue([]) })
    expect(runAddWorktreeToAgentsMigration(asDb(db))).toBe(false)
    expect(db.run).not.toHaveBeenCalled()
  })

  it('returns false when result rows are empty', () => {
    const db = makeDb({
      exec: vi.fn().mockReturnValue([{ columns: ['cid','name'], values: [] }]),
    })
    expect(runAddWorktreeToAgentsMigration(asDb(db))).toBe(false)
    expect(db.run).not.toHaveBeenCalled()
  })

  it('returns false when worktree_enabled already exists', () => {
    const db = makeDb({ exec: vi.fn().mockReturnValue(colPragma(['id','name','worktree_enabled'])) })
    expect(runAddWorktreeToAgentsMigration(asDb(db))).toBe(false)
    expect(db.run).not.toHaveBeenCalled()
  })

  it('runs ALTER TABLE ADD COLUMN and returns true', () => {
    const db = makeDb({ exec: vi.fn().mockReturnValue(colPragma(['id','name','type'])) })
    const result = runAddWorktreeToAgentsMigration(asDb(db))
    expect(result).toBe(true)
    const calls = (db.run as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string)
    expect(calls.some(s => s.includes('ADD COLUMN worktree_enabled INTEGER'))).toBe(true)
  })

  it('worktree_enabled is nullable INTEGER (tri-state: NULL/0/1)', () => {
    const db = makeDb({ exec: vi.fn().mockReturnValue(colPragma(['id','name'])) })
    runAddWorktreeToAgentsMigration(asDb(db))
    const calls = (db.run as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string)
    const sql = calls.find(s => s.includes('worktree_enabled'))
    expect(sql).toContain('worktree_enabled INTEGER')
    expect(sql).not.toContain('NOT NULL')
    expect(sql).not.toContain('DEFAULT')
  })
})

// ── v6: runFixTasksSessionFkMigration ─────────────────────────────────────────

describe('runFixTasksSessionFkMigration', () => {
  const STALE_SCHEMA = "CREATE TABLE tasks (session_id INTEGER REFERENCES sessions_backup_i18n(id), title TEXT)"
  const CORRECT_SCHEMA = "CREATE TABLE tasks (session_id INTEGER REFERENCES sessions(id), title TEXT)"

  it('returns false when tasks table does not exist', () => {
    const db = makeDb({ exec: vi.fn().mockReturnValue([]) })
    expect(runFixTasksSessionFkMigration(asDb(db))).toBe(false)
    expect(db.run).not.toHaveBeenCalled()
  })

  it('returns false when result rows are empty', () => {
    const db = makeDb({
      exec: vi.fn().mockReturnValue([{ columns: ['sql'], values: [] }]),
    })
    expect(runFixTasksSessionFkMigration(asDb(db))).toBe(false)
  })

  it('returns false when FK is already correct (no sessions_backup_i18n)', () => {
    const db = makeDb({
      exec: vi.fn().mockReturnValue([{ columns: ['sql'], values: [[CORRECT_SCHEMA]] }]),
    })
    expect(runFixTasksSessionFkMigration(asDb(db))).toBe(false)
    expect(db.run).not.toHaveBeenCalled()
  })

  it('returns true when stale FK reference is present', () => {
    const db = makeDb({
      exec: vi.fn()
        .mockReturnValueOnce([{ columns: ['sql'], values: [[STALE_SCHEMA]] }]) // tasks schema
        .mockReturnValueOnce([]), // tasks_fts check
    })
    const result = runFixTasksSessionFkMigration(asDb(db))
    expect(result).toBe(true)
  })

  it('drops FTS triggers before recreation', () => {
    const db = makeDb({
      exec: vi.fn()
        .mockReturnValueOnce([{ columns: ['sql'], values: [[STALE_SCHEMA]] }])
        .mockReturnValueOnce([]),
    })
    runFixTasksSessionFkMigration(asDb(db))
    const calls = (db.run as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string)
    expect(calls.some(s => s.includes('DROP TRIGGER IF EXISTS tasks_fts_ai'))).toBe(true)
    expect(calls.some(s => s.includes('DROP TRIGGER IF EXISTS tasks_fts_au'))).toBe(true)
    expect(calls.some(s => s.includes('DROP TRIGGER IF EXISTS tasks_fts_ad'))).toBe(true)
  })

  it('uses legacy_alter_table pragma during rename', () => {
    const db = makeDb({
      exec: vi.fn()
        .mockReturnValueOnce([{ columns: ['sql'], values: [[STALE_SCHEMA]] }])
        .mockReturnValueOnce([]),
    })
    runFixTasksSessionFkMigration(asDb(db))
    const calls = (db.run as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string)
    expect(calls.some(s => s.includes('legacy_alter_table = ON'))).toBe(true)
    expect(calls.some(s => s.includes('legacy_alter_table = OFF'))).toBe(true)
  })

  it('recreates tasks table with REFERENCES sessions(id)', () => {
    const db = makeDb({
      exec: vi.fn()
        .mockReturnValueOnce([{ columns: ['sql'], values: [[STALE_SCHEMA]] }])
        .mockReturnValueOnce([]),
    })
    runFixTasksSessionFkMigration(asDb(db))
    const calls = (db.run as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string)
    const createSql = calls.find(s => s.includes('CREATE TABLE tasks'))
    expect(createSql).toBeDefined()
    expect(createSql).toContain('REFERENCES sessions(id)')
    expect(createSql).not.toContain('sessions_backup_i18n')
  })

  it('recreates idx_tasks_updated_at, idx_tasks_agent_assigne, idx_tasks_status indexes', () => {
    const db = makeDb({
      exec: vi.fn()
        .mockReturnValueOnce([{ columns: ['sql'], values: [[STALE_SCHEMA]] }])
        .mockReturnValueOnce([]),
    })
    runFixTasksSessionFkMigration(asDb(db))
    const calls = (db.run as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string)
    expect(calls.some(s => s.includes('idx_tasks_updated_at'))).toBe(true)
    expect(calls.some(s => s.includes('idx_tasks_agent_assigne'))).toBe(true)
    expect(calls.some(s => s.includes('idx_tasks_status'))).toBe(true)
  })

  it('does not recreate FTS triggers when tasks_fts does not exist', () => {
    const db = makeDb({
      exec: vi.fn()
        .mockReturnValueOnce([{ columns: ['sql'], values: [[STALE_SCHEMA]] }])
        .mockReturnValueOnce([]), // tasks_fts not found
    })
    runFixTasksSessionFkMigration(asDb(db))
    const calls = (db.run as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string)
    expect(calls.some(s => s.includes('CREATE TRIGGER tasks_fts_ai'))).toBe(false)
  })

  it('recreates FTS triggers when tasks_fts exists', () => {
    const db = makeDb({
      exec: vi.fn()
        .mockReturnValueOnce([{ columns: ['sql'], values: [[STALE_SCHEMA]] }])
        .mockReturnValueOnce([{ columns: ['name'], values: [['tasks_fts']] }]), // tasks_fts exists
    })
    runFixTasksSessionFkMigration(asDb(db))
    const calls = (db.run as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string)
    expect(calls.some(s => s.includes('CREATE TRIGGER tasks_fts_ai'))).toBe(true)
    expect(calls.some(s => s.includes('CREATE TRIGGER tasks_fts_au'))).toBe(true)
    expect(calls.some(s => s.includes('CREATE TRIGGER tasks_fts_ad'))).toBe(true)
  })
})

// ── v7: runAddPreferredModelToAgentsMigration ─────────────────────────────────

describe('runAddPreferredModelToAgentsMigration', () => {
  it('returns false when agents table does not exist', () => {
    const db = makeDb({ exec: vi.fn().mockReturnValue([]) })
    expect(runAddPreferredModelToAgentsMigration(asDb(db))).toBe(false)
    expect(db.run).not.toHaveBeenCalled()
  })

  it('returns false when result rows are empty', () => {
    const db = makeDb({
      exec: vi.fn().mockReturnValue([{ columns: ['cid','name'], values: [] }]),
    })
    expect(runAddPreferredModelToAgentsMigration(asDb(db))).toBe(false)
    expect(db.run).not.toHaveBeenCalled()
  })

  it('returns false when preferred_model already exists', () => {
    const db = makeDb({ exec: vi.fn().mockReturnValue(colPragma(['id','name','preferred_model'])) })
    expect(runAddPreferredModelToAgentsMigration(asDb(db))).toBe(false)
    expect(db.run).not.toHaveBeenCalled()
  })

  it('runs ALTER TABLE ADD COLUMN and returns true', () => {
    const db = makeDb({ exec: vi.fn().mockReturnValue(colPragma(['id','name','type'])) })
    const result = runAddPreferredModelToAgentsMigration(asDb(db))
    expect(result).toBe(true)
    const calls = (db.run as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string)
    expect(calls.some(s => s.includes('ADD COLUMN preferred_model TEXT'))).toBe(true)
  })

  it('preferred_model has no DEFAULT and no CHECK constraint', () => {
    const db = makeDb({ exec: vi.fn().mockReturnValue(colPragma(['id','name'])) })
    runAddPreferredModelToAgentsMigration(asDb(db))
    const calls = (db.run as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string)
    const sql = calls.find(s => s.includes('preferred_model'))
    expect(sql).toBeDefined()
    expect(sql).not.toContain('DEFAULT')
    expect(sql).not.toContain('CHECK')
    expect(sql).not.toContain('NOT NULL')
  })
})
