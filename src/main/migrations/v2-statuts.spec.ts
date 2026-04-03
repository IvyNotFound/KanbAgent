/**
 * Tests for v2-statuts.ts migrations.
 * Uses mock MigrationDb (no real better-sqlite3).
 *
 * Coverage:
 *   - runTaskStatutI18nMigration
 *   - runTaskStatusMigration
 *   - runSessionStatutI18nMigration
 */

import { describe, it, expect, vi } from 'vitest'
import type { MigrationDb } from '../migration-db-adapter'
import {
  runTaskStatutI18nMigration,
  runTaskStatusMigration,
  runSessionStatutI18nMigration,
} from './v2-statuts'

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

const FRENCH_TASKS_SCHEMA = "CREATE TABLE tasks (statut TEXT CHECK(statut IN ('a_faire','en_cours','terminé','validé','archivé')))"
const ENGLISH_TASKS_SCHEMA = "CREATE TABLE tasks (status TEXT CHECK(status IN ('todo','in_progress','done','archived')))"
const FRENCH_SESSIONS_SCHEMA = "CREATE TABLE sessions (statut TEXT CHECK(statut IN ('en_cours','terminé','bloqué')))"
const ENGLISH_SESSIONS_SCHEMA = "CREATE TABLE sessions (statut TEXT CHECK(statut IN ('started','completed','blocked')))"

// ── runTaskStatutI18nMigration ────────────────────────────────────────────────

describe('runTaskStatutI18nMigration', () => {
  it('returns 0 when tasks table does not exist', () => {
    const db = makeDb({ exec: vi.fn().mockReturnValue([]) })
    expect(runTaskStatutI18nMigration(asDb(db))).toBe(0)
    expect(db.run).not.toHaveBeenCalled()
  })

  it('returns 0 when schema is already English and no French values', () => {
    const db = makeDb({
      exec: vi.fn()
        .mockReturnValueOnce([{ columns: ['sql'], values: [[ENGLISH_TASKS_SCHEMA]] }]) // sqlite_master
        .mockReturnValueOnce([{ columns: ['COUNT(*)'], values: [[0]] }]), // count French
    })
    expect(runTaskStatutI18nMigration(asDb(db))).toBe(0)
    expect(db.run).not.toHaveBeenCalled()
  })

  it('runs table recreation when schema is French and French values exist', () => {
    const db = makeDb({
      exec: vi.fn()
        .mockReturnValueOnce([{ columns: ['sql'], values: [[FRENCH_TASKS_SCHEMA]] }])
        .mockReturnValueOnce([{ columns: ['COUNT(*)'], values: [[3]] }])
        .mockReturnValue([{ columns: ['cid','name'], values: [[0,'id'],[1,'titre'],[2,'statut']] }]),
      getRowsModified: vi.fn().mockReturnValue(3),
    })
    const result = runTaskStatutI18nMigration(asDb(db))
    expect(result).toBe(3)
    const calls = (db.run as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string)
    expect(calls.some(s => s.includes('RENAME TO'))).toBe(true)
    expect(calls.some(s => s.includes('CREATE TABLE tasks'))).toBe(true)
    expect(calls.some(s => s.includes('INSERT INTO tasks'))).toBe(true)
    expect(calls.some(s => s.includes('DROP TABLE'))).toBe(true)
  })

  it('runs when French values exist even with English schema', () => {
    const db = makeDb({
      exec: vi.fn()
        .mockReturnValueOnce([{ columns: ['sql'], values: [[ENGLISH_TASKS_SCHEMA]] }])
        .mockReturnValueOnce([{ columns: ['COUNT(*)'], values: [[2]] }])
        .mockReturnValue([{ columns: ['cid','name'], values: [[0,'id'],[1,'titre'],[2,'statut']] }]),
      getRowsModified: vi.fn().mockReturnValue(2),
    })
    const result = runTaskStatutI18nMigration(asDb(db))
    expect(result).toBe(2)
  })

  it('CASE expression maps all French statuts to English', () => {
    const db = makeDb({
      exec: vi.fn()
        .mockReturnValueOnce([{ columns: ['sql'], values: [[FRENCH_TASKS_SCHEMA]] }])
        .mockReturnValueOnce([{ columns: ['COUNT(*)'], values: [[5]] }])
        .mockReturnValue([{ columns: ['cid','name'], values: [[0,'id'],[1,'statut']] }]),
    })
    runTaskStatutI18nMigration(asDb(db))
    const calls = (db.run as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string)
    const insertSql = calls.find(s => s.includes('INSERT INTO tasks'))
    expect(insertSql).toContain('a_faire')
    expect(insertSql).toContain('todo')
    expect(insertSql).toContain('en_cours')
    expect(insertSql).toContain('in_progress')
    expect(insertSql).toContain('terminé')
    expect(insertSql).toContain('done')
    expect(insertSql).toContain('archivé')
    expect(insertSql).toContain('archived')
  })

  it('new tasks table includes English CHECK constraint', () => {
    const db = makeDb({
      exec: vi.fn()
        .mockReturnValueOnce([{ columns: ['sql'], values: [[FRENCH_TASKS_SCHEMA]] }])
        .mockReturnValueOnce([{ columns: ['COUNT(*)'], values: [[1]] }])
        .mockReturnValue([{ columns: ['cid','name'], values: [[0,'id'],[1,'statut']] }]),
    })
    runTaskStatutI18nMigration(asDb(db))
    const calls = (db.run as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string)
    const createSql = calls.find(s => s.includes('CREATE TABLE tasks'))
    expect(createSql).toContain("'todo'")
    expect(createSql).toContain("'in_progress'")
    expect(createSql).toContain("'done'")
    expect(createSql).toContain("'archived'")
  })
})

// ── runTaskStatusMigration ────────────────────────────────────────────────────

describe('runTaskStatusMigration', () => {
  it('returns 0 when no terminé or validé rows exist', () => {
    // isArchiveAllowedInCheck: returns true if archived or done in schema
    const db = makeDb({
      exec: vi.fn()
        .mockReturnValueOnce([{ columns: ['sql'], values: [[ENGLISH_TASKS_SCHEMA]] }]) // isArchiveAllowedInCheck sqlite_master
        .mockReturnValueOnce([{ columns: ['COUNT(*)'], values: [[0]] }]) // count terminé
        .mockReturnValueOnce([{ columns: ['COUNT(*)'], values: [[0]] }]), // count validé
      getRowsModified: vi.fn().mockReturnValue(0),
    })
    expect(runTaskStatusMigration(asDb(db))).toBe(0)
    expect(db.run).not.toHaveBeenCalled()
  })

  it('migrates terminé rows and returns count', () => {
    const db = makeDb({
      exec: vi.fn()
        .mockReturnValueOnce([{ columns: ['sql'], values: [[FRENCH_TASKS_SCHEMA]] }]) // isArchiveAllowedInCheck — archivé present → true
        .mockReturnValueOnce([{ columns: ['COUNT(*)'], values: [[2]] }]) // count terminé
        .mockReturnValueOnce([{ columns: ['COUNT(*)'], values: [[0]] }]), // count validé
      getRowsModified: vi.fn().mockReturnValue(2),
    })
    const result = runTaskStatusMigration(asDb(db))
    expect(result).toBe(2)
    const calls = (db.run as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string)
    expect(calls.some(s => s.includes("statut = 'archivé'") && s.includes("terminé"))).toBe(true)
  })

  it('migrates validé rows and returns count', () => {
    const db = makeDb({
      exec: vi.fn()
        .mockReturnValueOnce([{ columns: ['sql'], values: [[FRENCH_TASKS_SCHEMA]] }]) // archivé present → isArchiveAllowed=true
        .mockReturnValueOnce([{ columns: ['COUNT(*)'], values: [[0]] }]) // count terminé
        .mockReturnValueOnce([{ columns: ['COUNT(*)'], values: [[3]] }]), // count validé
      getRowsModified: vi.fn().mockReturnValue(3),
    })
    const result = runTaskStatusMigration(asDb(db))
    expect(result).toBe(3)
    const calls = (db.run as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string)
    expect(calls.some(s => s.includes("statut = 'archivé'") && s.includes("validé"))).toBe(true)
  })

  it('calls recreateTasksTableWithArchive when CHECK does not allow archivé', () => {
    // isArchiveAllowedInCheck: returns false when schema has old-style French without archivé/done/archived
    const OLD_SCHEMA = "CREATE TABLE tasks (statut TEXT CHECK(statut IN ('a_faire','en_cours','terminé','validé')))"
    const db = makeDb({
      exec: vi.fn()
        .mockReturnValueOnce([{ columns: ['sql'], values: [[OLD_SCHEMA]] }]) // isArchiveAllowedInCheck sqlite_master
        .mockReturnValueOnce([{ columns: ['COUNT(*)'], values: [[0]] }]) // count terminé
        .mockReturnValueOnce([{ columns: ['COUNT(*)'], values: [[0]] }]) // count validé
        // recreateTasksTableWithArchive calls:
        .mockReturnValueOnce([{ columns: ['sql'], values: [[OLD_SCHEMA]] }]) // sqlite_master for colMapping
        .mockReturnValue([{ columns: ['cid','name'], values: [[0,'id'],[1,'statut']] }]),
    })
    // should not throw
    expect(() => runTaskStatusMigration(asDb(db))).not.toThrow()
    // Table recreation should be called (RENAME TO, CREATE TABLE, INSERT, DROP TABLE)
    const calls = (db.run as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string)
    expect(calls.some(s => s.includes('RENAME TO') || s.includes('CREATE TABLE tasks'))).toBe(true)
  })
})

// ── runSessionStatutI18nMigration ─────────────────────────────────────────────

describe('runSessionStatutI18nMigration', () => {
  it('returns 0 when sessions table does not exist', () => {
    const db = makeDb({ exec: vi.fn().mockReturnValue([]) })
    expect(runSessionStatutI18nMigration(asDb(db))).toBe(0)
    expect(db.run).not.toHaveBeenCalled()
  })

  it('returns 0 when schema is already English and no French values', () => {
    const db = makeDb({
      exec: vi.fn()
        .mockReturnValueOnce([{ columns: ['sql'], values: [[ENGLISH_SESSIONS_SCHEMA]] }]) // sqlite_master
        .mockReturnValueOnce([{ columns: ['COUNT(*)'], values: [[0]] }]), // count French
    })
    expect(runSessionStatutI18nMigration(asDb(db))).toBe(0)
    expect(db.run).not.toHaveBeenCalled()
  })

  it('recreates table and returns count when schema is French', () => {
    const db = makeDb({
      exec: vi.fn()
        .mockReturnValueOnce([{ columns: ['sql'], values: [[FRENCH_SESSIONS_SCHEMA]] }]) // sqlite_master
        .mockReturnValueOnce([{ columns: ['COUNT(*)'], values: [[2]] }]) // count French
        .mockReturnValue([{ columns: ['cid','name'], values: [[0,'id'],[1,'agent_id'],[2,'statut']] }]), // PRAGMA
    })
    const result = runSessionStatutI18nMigration(asDb(db))
    expect(result).toBe(2)
    const calls = (db.run as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string)
    expect(calls.some(s => s.includes('RENAME TO'))).toBe(true)
    expect(calls.some(s => s.includes('CREATE TABLE sessions'))).toBe(true)
    expect(calls.some(s => s.includes('SAVEPOINT'))).toBe(true)
  })

  it('CASE expression maps en_cours → started, terminé → completed, bloqué → blocked', () => {
    const db = makeDb({
      exec: vi.fn()
        .mockReturnValueOnce([{ columns: ['sql'], values: [[FRENCH_SESSIONS_SCHEMA]] }])
        .mockReturnValueOnce([{ columns: ['COUNT(*)'], values: [[3]] }])
        .mockReturnValue([{ columns: ['cid','name'], values: [[0,'id'],[1,'agent_id'],[2,'statut']] }]),
    })
    runSessionStatutI18nMigration(asDb(db))
    const calls = (db.run as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string)
    const insertSql = calls.find(s => s.includes('INSERT INTO sessions'))
    expect(insertSql).toContain('en_cours')
    expect(insertSql).toContain('started')
    expect(insertSql).toContain('terminé')
    expect(insertSql).toContain('completed')
    expect(insertSql).toContain('bloqué')
    expect(insertSql).toContain('blocked')
  })

  it('runs UPDATE when schema is already English but French values exist', () => {
    const db = makeDb({
      exec: vi.fn()
        .mockReturnValueOnce([{ columns: ['sql'], values: [[ENGLISH_SESSIONS_SCHEMA]] }]) // sqlite_master
        .mockReturnValueOnce([{ columns: ['COUNT(*)'], values: [[1]] }]), // count French
      getRowsModified: vi.fn().mockReturnValue(1),
    })
    const result = runSessionStatutI18nMigration(asDb(db))
    expect(result).toBe(1)
    const calls = (db.run as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string)
    expect(calls.some(s => s.includes('UPDATE sessions'))).toBe(true)
    expect(calls.some(s => s.includes('RENAME TO'))).toBe(false) // no table recreation
  })

  it('new sessions table has English CHECK constraint', () => {
    const db = makeDb({
      exec: vi.fn()
        .mockReturnValueOnce([{ columns: ['sql'], values: [[FRENCH_SESSIONS_SCHEMA]] }])
        .mockReturnValueOnce([{ columns: ['COUNT(*)'], values: [[1]] }])
        .mockReturnValue([{ columns: ['cid','name'], values: [[0,'id'],[1,'agent_id'],[2,'statut']] }]),
    })
    runSessionStatutI18nMigration(asDb(db))
    const calls = (db.run as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0] as string)
    const createSql = calls.find(s => s.includes('CREATE TABLE sessions'))
    expect(createSql).toContain("'started'")
    expect(createSql).toContain("'completed'")
    expect(createSql).toContain("'blocked'")
  })
})
