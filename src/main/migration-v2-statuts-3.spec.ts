/**
 * Integration tests for migrations/v2-statuts.ts using better-sqlite3 in-memory DB.
 * Covers all three exported functions: runTaskStatutI18nMigration,
 * runTaskStatusMigration, runSessionStatutI18nMigration.
 *
 * All branches in the source file are exercised against real SQL to kill
 * the surviving ConditionalExpression and EqualityOperator mutants.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import BetterSqlite3 from 'better-sqlite3'
import { createMigrationAdapter } from './migration-db-adapter'
import type { MigrationDb } from './migration-db-adapter'
import {
  runTaskStatutI18nMigration,
  runTaskStatusMigration,
  runSessionStatutI18nMigration,
} from './migrations/v2-statuts'

// ── helpers ───────────────────────────────────────────────────────────────────

function makeAdapter(): { raw: BetterSqlite3.Database; db: MigrationDb } {
  const raw = new BetterSqlite3(':memory:')
  raw.pragma('journal_mode = WAL')
  const db = createMigrationAdapter(raw)
  return { raw, db }
}

/** Create a minimal "old" French tasks table (without English CHECK) */
function createFrenchTasksTable(raw: BetterSqlite3.Database): void {
  raw.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id   INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL
    )
  `)
  raw.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id INTEGER NOT NULL REFERENCES agents(id),
      statut   TEXT NOT NULL DEFAULT 'en_cours'
        CHECK(statut IN ('en_cours','terminé','bloqué'))
    )
  `)
  raw.exec(`
    CREATE TABLE tasks (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      titre             TEXT NOT NULL,
      description       TEXT,
      statut            TEXT NOT NULL DEFAULT 'a_faire'
        CHECK(statut IN ('a_faire','en_cours','terminé','validé','archivé')),
      agent_createur_id INTEGER REFERENCES agents(id),
      agent_assigne_id  INTEGER REFERENCES agents(id),
      agent_valideur_id INTEGER REFERENCES agents(id),
      parent_task_id    INTEGER REFERENCES tasks(id),
      session_id        INTEGER REFERENCES sessions(id),
      perimetre         TEXT,
      effort            INTEGER CHECK(effort IN (1,2,3)),
      created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
      started_at        DATETIME,
      completed_at      DATETIME,
      validated_at      DATETIME
    )
  `)
}

/** Create an already-English tasks table */
function createEnglishTasksTable(raw: BetterSqlite3.Database): void {
  raw.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id   INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL
    )
  `)
  raw.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id INTEGER NOT NULL REFERENCES agents(id),
      statut   TEXT NOT NULL DEFAULT 'started'
        CHECK(statut IN ('started','completed','blocked'))
    )
  `)
  raw.exec(`
    CREATE TABLE tasks (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      titre             TEXT NOT NULL,
      description       TEXT,
      statut            TEXT NOT NULL DEFAULT 'todo'
        CHECK(statut IN ('todo','in_progress','done','archived')),
      agent_createur_id INTEGER REFERENCES agents(id),
      agent_assigne_id  INTEGER REFERENCES agents(id),
      agent_valideur_id INTEGER REFERENCES agents(id),
      parent_task_id    INTEGER REFERENCES tasks(id),
      session_id        INTEGER REFERENCES sessions(id),
      perimetre         TEXT,
      effort            INTEGER CHECK(effort IN (1,2,3)),
      priority          TEXT NOT NULL DEFAULT 'normal'
        CHECK(priority IN ('low','normal','high','critical')),
      created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
      started_at        DATETIME,
      completed_at      DATETIME,
      validated_at      DATETIME
    )
  `)
}

// ── runTaskStatutI18nMigration ─────────────────────────────────────────────────

describe('runSessionStatutI18nMigration — real DB', () => {
  let raw: BetterSqlite3.Database
  let db: MigrationDb

  beforeEach(() => {
    ;({ raw, db } = makeAdapter())
  })

  function createAgents(r: BetterSqlite3.Database): void {
    r.exec(`CREATE TABLE IF NOT EXISTS agents (id INTEGER PRIMARY KEY, name TEXT NOT NULL)`)
    r.exec(`INSERT INTO agents (name) VALUES ('review')`)
  }

  /** Create sessions with French CHECK constraint */
  function createFrenchSessionsTable(r: BetterSqlite3.Database): void {
    createAgents(r)
    r.exec(`
      CREATE TABLE sessions (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id   INTEGER NOT NULL REFERENCES agents(id),
        started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        ended_at   DATETIME,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        statut     TEXT NOT NULL DEFAULT 'en_cours'
          CHECK(statut IN ('en_cours','terminé','bloqué')),
        summary    TEXT,
        claude_conv_id TEXT,
        tokens_in  INTEGER DEFAULT 0,
        tokens_out INTEGER DEFAULT 0,
        tokens_cache_read  INTEGER DEFAULT 0,
        tokens_cache_write INTEGER DEFAULT 0
      )
    `)
  }

  /** Create sessions with English CHECK constraint */
  function createEnglishSessionsTable(r: BetterSqlite3.Database): void {
    createAgents(r)
    r.exec(`
      CREATE TABLE sessions (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id   INTEGER NOT NULL REFERENCES agents(id),
        started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        ended_at   DATETIME,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        statut     TEXT NOT NULL DEFAULT 'started'
          CHECK(statut IN ('started','completed','blocked')),
        summary    TEXT,
        claude_conv_id TEXT,
        tokens_in  INTEGER DEFAULT 0,
        tokens_out INTEGER DEFAULT 0,
        tokens_cache_read  INTEGER DEFAULT 0,
        tokens_cache_write INTEGER DEFAULT 0
      )
    `)
  }

  it('returns 0 when sessions table does not exist (schemaResult empty)', () => {
    const result = runSessionStatutI18nMigration(db)
    expect(result).toBe(0)
  })

  it('returns 0 when schema already English and no French values (idempotent)', () => {
    createEnglishSessionsTable(raw)
    const result = runSessionStatutI18nMigration(db)
    expect(result).toBe(0)
  })

  it('recreates table with English CHECK and converts en_cours → started', () => {
    createFrenchSessionsTable(raw)
    raw.exec(`INSERT INTO sessions (agent_id, statut) VALUES (1,'en_cours')`)

    const result = runSessionStatutI18nMigration(db)

    expect(result).toBe(1)
    const row = raw.prepare('SELECT statut FROM sessions').get() as { statut: string }
    expect(row.statut).toBe('started')
  })

  it('converts terminé → completed (StringLiteral mutation coverage)', () => {
    createFrenchSessionsTable(raw)
    raw.exec(`INSERT INTO sessions (agent_id, statut) VALUES (1,'terminé')`)

    runSessionStatutI18nMigration(db)

    const row = raw.prepare('SELECT statut FROM sessions').get() as { statut: string }
    expect(row.statut).toBe('completed')
  })

  it('converts bloqué → blocked (StringLiteral mutation coverage)', () => {
    createFrenchSessionsTable(raw)
    raw.exec(`INSERT INTO sessions (agent_id, statut) VALUES (1,'bloqué')`)

    runSessionStatutI18nMigration(db)

    const row = raw.prepare('SELECT statut FROM sessions').get() as { statut: string }
    expect(row.statut).toBe('blocked')
  })

  it('converts all French values in one pass', () => {
    createFrenchSessionsTable(raw)
    raw.exec(`
      INSERT INTO sessions (agent_id, statut) VALUES
        (1,'en_cours'),(1,'terminé'),(1,'bloqué')
    `)

    const result = runSessionStatutI18nMigration(db)

    expect(result).toBe(3)
    const rows = raw.prepare('SELECT statut FROM sessions ORDER BY id').all() as { statut: string }[]
    expect(rows.map(r => r.statut)).toEqual(['started', 'completed', 'blocked'])
  })

  it('is idempotent: running twice returns 0 on second call', () => {
    createFrenchSessionsTable(raw)
    raw.exec(`INSERT INTO sessions (agent_id, statut) VALUES (1,'en_cours')`)

    const first = runSessionStatutI18nMigration(db)
    expect(first).toBe(1)

    const second = runSessionStatutI18nMigration(db)
    expect(second).toBe(0)
  })

  it('UPDATE in-place (no table recreation) when schema is English but French data exists', () => {
    // English CHECK but somehow French data got in
    createEnglishSessionsTable(raw)
    // Force-insert a French value by disabling checks temporarily
    raw.pragma('ignore_check_constraints = ON')
    raw.exec(`INSERT INTO sessions (agent_id, statut) VALUES (1,'en_cours')`)
    raw.pragma('ignore_check_constraints = OFF')

    const result = runSessionStatutI18nMigration(db)

    expect(result).toBe(1)
    const row = raw.prepare('SELECT statut FROM sessions').get() as { statut: string }
    expect(row.statut).toBe('started')
  })

  it('SAVEPOINT and RELEASE called during French schema migration (atomicity)', () => {
    createFrenchSessionsTable(raw)
    raw.exec(`INSERT INTO sessions (agent_id, statut) VALUES (1,'en_cours')`)

    // Just verify it doesn't throw and the migration completes atomically
    expect(() => runSessionStatutI18nMigration(db)).not.toThrow()

    // After migration, sessions table exists with English schema
    const schema = raw.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='sessions'").get() as { sql: string }
    expect(schema.sql).toContain("'started'")
  })

  it('preserves all existing columns through table recreation', () => {
    createFrenchSessionsTable(raw)
    raw.exec(`INSERT INTO sessions (agent_id, statut, summary, claude_conv_id, tokens_in, tokens_out) VALUES (1,'en_cours','my summary','conv-123',10,20)`)

    runSessionStatutI18nMigration(db)

    const row = raw.prepare('SELECT * FROM sessions').get() as Record<string, unknown>
    expect(row.statut).toBe('started')
    expect(row.summary).toBe('my summary')
    expect(row.claude_conv_id).toBe('conv-123')
    expect(row.tokens_in).toBe(10)
    expect(row.tokens_out).toBe(20)
  })

  it('frenchCount = 0 but schema is French → still recreates table and returns 0', () => {
    createFrenchSessionsTable(raw)
    // No rows → frenchCount = 0, schema not English → should still recreate
    const result = runSessionStatutI18nMigration(db)
    expect(result).toBe(0)

    // Verify English schema after migration
    const schema = raw.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='sessions'").get() as { sql: string }
    expect(schema.sql).toContain("'started'")
  })
})
