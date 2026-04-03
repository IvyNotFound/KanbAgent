/**
 * Tests for v1-columns.ts migrations.
 * Uses mock MigrationDb (no real better-sqlite3).
 *
 * Coverage:
 *   - runDropCommentaireColumnMigration
 *   - runRemoveThinkingModeBudgetTokensMigration
 *   - runAddTokensToSessionsMigration
 *   - runAddConvIdToSessionsMigration
 *   - runAddPriorityMigration
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { MigrationDb } from '../migration-db-adapter'
import {
  runDropCommentaireColumnMigration,
  runRemoveThinkingModeBudgetTokensMigration,
  runAddTokensToSessionsMigration,
  runAddConvIdToSessionsMigration,
  runAddPriorityMigration,
} from './v1-columns'

// ── Mock helpers ──────────────────────────────────────────────────────────────

type MockDb = {
  exec: ReturnType<typeof vi.fn>
  run: ReturnType<typeof vi.fn>
  getRowsModified: ReturnType<typeof vi.fn>
  prepare: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
}

function colPragma(cols: string[]) {
  return [{ columns: ['cid','name','type','notnull','dflt_value','pk'], values: cols.map((n,i) => [i,n,'TEXT',0,null,i===0?1:0]) }]
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

// ── runDropCommentaireColumnMigration ─────────────────────────────────────────

describe('runDropCommentaireColumnMigration', () => {
  it('returns 0 when tasks table does not exist (exec returns [])', () => {
    const db = makeDb({ exec: vi.fn().mockReturnValue([]) })
    expect(runDropCommentaireColumnMigration(db as unknown as MigrationDb)).toBe(0)
    expect(db.run).not.toHaveBeenCalled()
  })

  it('returns 0 (idempotent) when commentaire column absent', () => {
    const db = makeDb({
      exec: vi.fn().mockReturnValue(colPragma(['id','titre','statut'])),
    })
    expect(runDropCommentaireColumnMigration(db as unknown as MigrationDb)).toBe(0)
    expect(db.run).not.toHaveBeenCalled()
  })

  it('runs INSERT and DROP when commentaire column present', () => {
    const db = makeDb({
      exec: vi.fn().mockReturnValue(colPragma(['id','titre','commentaire','statut'])),
      getRowsModified: vi.fn().mockReturnValue(2),
    })
    const result = runDropCommentaireColumnMigration(db as unknown as MigrationDb)
    expect(result).toBe(2)
    const calls = (db.run as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string)
    expect(calls.some(s => s.includes('INSERT INTO task_comments'))).toBe(true)
    expect(calls.some(s => s.includes('DROP COLUMN commentaire'))).toBe(true)
  })

  it('INSERT filters non-null and non-empty commentaire via WHERE clause', () => {
    const db = makeDb({
      exec: vi.fn().mockReturnValue(colPragma(['id','titre','commentaire','statut'])),
    })
    runDropCommentaireColumnMigration(db as unknown as MigrationDb)
    const calls = (db.run as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string)
    const insertSql = calls.find(s => s.includes('INSERT INTO task_comments'))
    expect(insertSql).toContain('commentaire IS NOT NULL')
    expect(insertSql).toContain("TRIM(commentaire) != ''")
  })
})

// ── runRemoveThinkingModeBudgetTokensMigration ────────────────────────────────

describe('runRemoveThinkingModeBudgetTokensMigration', () => {
  it('returns false when agents table does not exist (exec returns [])', () => {
    const db = makeDb({ exec: vi.fn().mockReturnValue([]) })
    expect(runRemoveThinkingModeBudgetTokensMigration(db as unknown as MigrationDb)).toBe(false)
  })

  it('returns false when result rows are empty', () => {
    const db = makeDb({
      exec: vi.fn().mockReturnValue([{ columns: ['sql'], values: [] }]),
    })
    expect(runRemoveThinkingModeBudgetTokensMigration(db as unknown as MigrationDb)).toBe(false)
  })

  it('returns false when schema does not contain budget_tokens', () => {
    const db = makeDb({
      exec: vi.fn()
        .mockReturnValueOnce([{ columns: ['sql'], values: [["CREATE TABLE agents (thinking_mode TEXT CHECK(thinking_mode IN ('auto','disabled')))"]] }])
        .mockReturnValue([]),
    })
    expect(runRemoveThinkingModeBudgetTokensMigration(db as unknown as MigrationDb)).toBe(false)
  })

  it('returns true and runs table recreation when budget_tokens in schema', () => {
    const schemaWithBudget = "CREATE TABLE agents (thinking_mode TEXT CHECK(thinking_mode IN ('auto','disabled','budget_tokens')))"
    const db = makeDb({
      exec: vi.fn()
        .mockReturnValueOnce([{ columns: ['sql'], values: [[schemaWithBudget]] }])
        .mockReturnValue(colPragma(['id','name','type','thinking_mode'])),
    })
    const result = runRemoveThinkingModeBudgetTokensMigration(db as unknown as MigrationDb)
    expect(result).toBe(true)
    const calls = (db.run as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string)
    expect(calls.some(s => s.includes('RENAME TO'))).toBe(true)
    expect(calls.some(s => s.includes("CHECK(thinking_mode IN ('auto', 'disabled'))"))).toBe(true)
    expect(calls.some(s => s.includes('DROP TABLE'))).toBe(true)
  })

  it('converts budget_tokens to NULL in SELECT expression', () => {
    const schemaWithBudget = "CREATE TABLE agents (thinking_mode TEXT CHECK(thinking_mode IN ('auto','budget_tokens')))"
    const db = makeDb({
      exec: vi.fn()
        .mockReturnValueOnce([{ columns: ['sql'], values: [[schemaWithBudget]] }])
        .mockReturnValue(colPragma(['id','name','thinking_mode'])),
    })
    runRemoveThinkingModeBudgetTokensMigration(db as unknown as MigrationDb)
    const calls = (db.run as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string)
    const insertCall = calls.find(s => s.includes('INSERT INTO agents'))
    expect(insertCall).toContain('budget_tokens')
    expect(insertCall).toContain('NULL')
  })
})

// ── runAddTokensToSessionsMigration ──────────────────────────────────────────

describe('runAddTokensToSessionsMigration', () => {
  it('returns 0 when sessions table does not exist', () => {
    const db = makeDb({ exec: vi.fn().mockReturnValue([]) })
    expect(runAddTokensToSessionsMigration(db as unknown as MigrationDb)).toBe(0)
    expect(db.run).not.toHaveBeenCalled()
  })

  it('adds all 4 token columns when none exist', () => {
    const db = makeDb({
      exec: vi.fn().mockReturnValue(colPragma(['id','agent_id','statut'])),
    })
    const result = runAddTokensToSessionsMigration(db as unknown as MigrationDb)
    expect(result).toBe(4)
    const calls = (db.run as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string)
    expect(calls.some(s => s.includes('tokens_in'))).toBe(true)
    expect(calls.some(s => s.includes('tokens_out'))).toBe(true)
    expect(calls.some(s => s.includes('tokens_cache_read'))).toBe(true)
    expect(calls.some(s => s.includes('tokens_cache_write'))).toBe(true)
  })

  it('adds only missing columns when some already exist', () => {
    const db = makeDb({
      exec: vi.fn().mockReturnValue(colPragma(['id','agent_id','tokens_in','tokens_out'])),
    })
    const result = runAddTokensToSessionsMigration(db as unknown as MigrationDb)
    expect(result).toBe(2)
    const calls = (db.run as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string)
    expect(calls.some(s => s.includes('tokens_cache_read'))).toBe(true)
    expect(calls.some(s => s.includes('tokens_cache_write'))).toBe(true)
    expect(calls.some(s => s.includes('tokens_in') && !s.includes('tokens_cache'))).toBe(false)
  })

  it('is idempotent: returns 0 when all columns already exist', () => {
    const db = makeDb({
      exec: vi.fn().mockReturnValue(colPragma(['id','agent_id','tokens_in','tokens_out','tokens_cache_read','tokens_cache_write'])),
    })
    expect(runAddTokensToSessionsMigration(db as unknown as MigrationDb)).toBe(0)
    expect(db.run).not.toHaveBeenCalled()
  })

  it('uses SAVEPOINT for atomicity', () => {
    const db = makeDb({
      exec: vi.fn().mockReturnValue(colPragma(['id','agent_id'])),
    })
    runAddTokensToSessionsMigration(db as unknown as MigrationDb)
    const calls = (db.run as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string)
    expect(calls.some(s => s.includes('SAVEPOINT'))).toBe(true)
    expect(calls.some(s => s.includes('RELEASE SAVEPOINT'))).toBe(true)
  })
})

// ── runAddConvIdToSessionsMigration ──────────────────────────────────────────

describe('runAddConvIdToSessionsMigration', () => {
  it('returns false when sessions table does not exist', () => {
    const db = makeDb({ exec: vi.fn().mockReturnValue([]) })
    expect(runAddConvIdToSessionsMigration(db as unknown as MigrationDb)).toBe(false)
    expect(db.run).not.toHaveBeenCalled()
  })

  it('returns false when claude_conv_id already exists', () => {
    const db = makeDb({
      exec: vi.fn().mockReturnValue(colPragma(['id','agent_id','claude_conv_id'])),
    })
    expect(runAddConvIdToSessionsMigration(db as unknown as MigrationDb)).toBe(false)
    expect(db.run).not.toHaveBeenCalled()
  })

  it('runs ALTER TABLE and returns true when column absent', () => {
    const db = makeDb({
      exec: vi.fn().mockReturnValue(colPragma(['id','agent_id','statut'])),
    })
    const result = runAddConvIdToSessionsMigration(db as unknown as MigrationDb)
    expect(result).toBe(true)
    const calls = (db.run as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string)
    expect(calls.some(s => s.includes('ADD COLUMN claude_conv_id TEXT'))).toBe(true)
  })
})

// ── runAddPriorityMigration ───────────────────────────────────────────────────

describe('runAddPriorityMigration', () => {
  it('returns false when tasks table does not exist', () => {
    const db = makeDb({ exec: vi.fn().mockReturnValue([]) })
    expect(runAddPriorityMigration(db as unknown as MigrationDb)).toBe(false)
    expect(db.run).not.toHaveBeenCalled()
  })

  it('returns false when priority column already exists', () => {
    const db = makeDb({
      exec: vi.fn().mockReturnValue(colPragma(['id','titre','statut','priority'])),
    })
    expect(runAddPriorityMigration(db as unknown as MigrationDb)).toBe(false)
    expect(db.run).not.toHaveBeenCalled()
  })

  it('runs ALTER TABLE with DEFAULT normal and CHECK constraint', () => {
    const db = makeDb({
      exec: vi.fn().mockReturnValue(colPragma(['id','titre','statut'])),
    })
    const result = runAddPriorityMigration(db as unknown as MigrationDb)
    expect(result).toBe(true)
    const calls = (db.run as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string)
    const alterSql = calls.find(s => s.includes('ADD COLUMN priority'))
    expect(alterSql).toBeDefined()
    expect(alterSql).toContain("DEFAULT 'normal'")
    expect(alterSql).toContain('CHECK')
    expect(alterSql).toContain('low')
    expect(alterSql).toContain('high')
    expect(alterSql).toContain('critical')
  })
})
