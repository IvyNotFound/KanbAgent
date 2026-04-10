/**
 * Tests for schema-init.ts — isArchiveAllowedInCheck and recreateTasksTableWithArchive.
 * Uses better-sqlite3 in-memory DB via createMigrationAdapter for realistic coverage.
 * Target: kill surviving mutants at score 13% (T1331).
 *
 * colMapping requirements: every source table must expose at minimum:
 *   id, description, created_at, updated_at
 *   + one of: title / titre
 *   + one of: scope / perimetre
 *   + one of: status (English) / statut (French, triggers CASE expression)
 */

import { describe, it, expect, beforeEach } from 'vitest'
import BetterSqlite3 from 'better-sqlite3'
import { createMigrationAdapter } from '../migration-db-adapter'
import type { MigrationDb } from '../migration-db-adapter'
import { isArchiveAllowedInCheck, recreateTasksTableWithArchive } from './schema-init'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRaw(): BetterSqlite3.Database {
  const raw = new BetterSqlite3(':memory:')
  // Create dependency tables so REFERENCES in the new tasks schema resolves.
  // SQLite resolves FK table references at CREATE TABLE time even with FK enforcement OFF.
  raw.exec('CREATE TABLE IF NOT EXISTS agents (id INTEGER PRIMARY KEY)')
  raw.exec('CREATE TABLE IF NOT EXISTS sessions (id INTEGER PRIMARY KEY)')
  return raw
}

function makeAdapter(raw: BetterSqlite3.Database): MigrationDb {
  return createMigrationAdapter(raw)
}

/** Full modern English schema */
function createModernTasksTable(raw: BetterSqlite3.Database): void {
  raw.exec(`
    CREATE TABLE tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      scope TEXT,
      status TEXT NOT NULL DEFAULT 'todo'
        CHECK(status IN ('todo','in_progress','done','archived')),
      priority TEXT NOT NULL DEFAULT 'normal'
        CHECK(priority IN ('low','normal','high','critical')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)
}

/**
 * French schema without 'archivé'/'archived' in CHECK.
 * Includes all columns required by colMapping fallback paths:
 * titre, perimetre, description, statut, created_at, updated_at.
 */
function createLegacyNoArchive(raw: BetterSqlite3.Database): void {
  raw.exec(`
    CREATE TABLE tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      titre TEXT NOT NULL DEFAULT '',
      description TEXT,
      perimetre TEXT,
      statut TEXT NOT NULL DEFAULT 'a_faire'
        CHECK(statut IN ('a_faire','en_cours','terminé','validé')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)
}

/**
 * French schema WITH 'archivé' in CHECK.
 */
function createLegacyWithArchive(raw: BetterSqlite3.Database): void {
  raw.exec(`
    CREATE TABLE tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      titre TEXT NOT NULL DEFAULT '',
      description TEXT,
      perimetre TEXT,
      statut TEXT NOT NULL DEFAULT 'a_faire'
        CHECK(statut IN ('a_faire','en_cours','terminé','validé','archivé')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)
}

/**
 * Bare French schema with no CHECK constraint (allows inserting any statut value).
 */
function createBareTable(raw: BetterSqlite3.Database): void {
  raw.exec(`
    CREATE TABLE tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      titre TEXT NOT NULL DEFAULT '',
      description TEXT,
      perimetre TEXT,
      statut TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)
}

// ── isArchiveAllowedInCheck ───────────────────────────────────────────────────

describe('recreateTasksTableWithArchive', () => {
  let raw: BetterSqlite3.Database
  let db: MigrationDb

  beforeEach(() => {
    raw = makeRaw()
    db = makeAdapter(raw)
  })

  it('falls back to agent_assigne_id (French) when agent_assigned_id absent', () => {
    raw.exec('INSERT INTO agents VALUES (9)') // satisfy FK
    raw.exec(`
      CREATE TABLE tasks (
        id INTEGER PRIMARY KEY,
        titre TEXT NOT NULL DEFAULT '',
        description TEXT,
        perimetre TEXT,
        statut TEXT NOT NULL DEFAULT 'a_faire',
        agent_assigne_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `)
    raw.exec("INSERT INTO tasks (titre, statut, agent_assigne_id) VALUES ('T', 'a_faire', 9)")
    recreateTasksTableWithArchive(makeAdapter(raw))

    const row = raw.prepare('SELECT agent_assigned_id FROM tasks').get() as { agent_assigned_id: number | null }
    expect(row.agent_assigned_id).toBe(9)
  })

  it('uses agent_validator_id if present (English)', () => {
    raw.exec('INSERT INTO agents VALUES (22)') // satisfy FK
    raw.exec(`
      CREATE TABLE tasks (
        id INTEGER PRIMARY KEY,
        title TEXT NOT NULL DEFAULT '',
        description TEXT,
        scope TEXT,
        status TEXT NOT NULL DEFAULT 'todo',
        agent_validator_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `)
    raw.exec("INSERT INTO tasks (title, status, agent_validator_id) VALUES ('T', 'todo', 22)")
    recreateTasksTableWithArchive(makeAdapter(raw))

    const row = raw.prepare('SELECT agent_validator_id FROM tasks').get() as { agent_validator_id: number | null }
    expect(row.agent_validator_id).toBe(22)
  })

  it('falls back to agent_valideur_id (French) when agent_validator_id absent', () => {
    raw.exec('INSERT INTO agents VALUES (5)') // satisfy FK
    raw.exec(`
      CREATE TABLE tasks (
        id INTEGER PRIMARY KEY,
        titre TEXT NOT NULL DEFAULT '',
        description TEXT,
        perimetre TEXT,
        statut TEXT NOT NULL DEFAULT 'a_faire',
        agent_valideur_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `)
    raw.exec("INSERT INTO tasks (titre, statut, agent_valideur_id) VALUES ('T', 'a_faire', 5)")
    recreateTasksTableWithArchive(makeAdapter(raw))

    const row = raw.prepare('SELECT agent_validator_id FROM tasks').get() as { agent_validator_id: number | null }
    expect(row.agent_validator_id).toBe(5)
  })

  it('preserves optional columns: parent_task_id, session_id, effort, started_at, completed_at, validated_at', () => {
    raw.exec('INSERT INTO sessions VALUES (10)') // satisfy FK
    raw.exec(`
      CREATE TABLE tasks (
        id INTEGER PRIMARY KEY,
        title TEXT NOT NULL DEFAULT '',
        description TEXT,
        scope TEXT,
        status TEXT NOT NULL DEFAULT 'todo',
        parent_task_id INTEGER,
        session_id INTEGER,
        effort INTEGER,
        started_at DATETIME,
        completed_at DATETIME,
        validated_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `)
    raw.exec(`
      INSERT INTO tasks (title, status, parent_task_id, session_id, effort, started_at, completed_at, validated_at)
      VALUES ('T', 'todo', NULL, 10, 2, '2024-01-01', '2024-01-02', '2024-01-03')
    `)
    recreateTasksTableWithArchive(makeAdapter(raw))

    const row = raw.prepare(
      'SELECT parent_task_id, session_id, effort, started_at, completed_at, validated_at FROM tasks'
    ).get() as {
      parent_task_id: number | null
      session_id: number | null
      effort: number | null
      started_at: string | null
      completed_at: string | null
      validated_at: string | null
    }
    expect(row.parent_task_id).toBeNull()
    expect(row.session_id).toBe(10)
    expect(row.effort).toBe(2)
    expect(row.started_at).toBe('2024-01-01')
    expect(row.completed_at).toBe('2024-01-02')
    expect(row.validated_at).toBe('2024-01-03')
  })

  it('NULLs optional columns when absent from old schema', () => {
    createLegacyNoArchive(raw)
    raw.exec("INSERT INTO tasks (titre, statut) VALUES ('Minimal', 'a_faire')")
    recreateTasksTableWithArchive(db)

    const row = raw.prepare(
      'SELECT parent_task_id, session_id, effort, started_at, completed_at, validated_at FROM tasks'
    ).get() as {
      parent_task_id: number | null
      session_id: number | null
      effort: number | null
      started_at: string | null
      completed_at: string | null
      validated_at: string | null
    }
    expect(row.parent_task_id).toBeNull()
    expect(row.session_id).toBeNull()
    expect(row.effort).toBeNull()
    expect(row.started_at).toBeNull()
    expect(row.completed_at).toBeNull()
    expect(row.validated_at).toBeNull()
  })

  it('handles empty table (0 rows) without error', () => {
    createLegacyNoArchive(raw)
    expect(() => recreateTasksTableWithArchive(db)).not.toThrow()
    const rows = raw.prepare('SELECT * FROM tasks').all()
    expect(rows).toHaveLength(0)
  })

  it('is idempotent: calling twice on already-modern table does not corrupt data', () => {
    createLegacyNoArchive(raw)
    raw.exec("INSERT INTO tasks (titre, statut) VALUES ('T', 'a_faire')")
    recreateTasksTableWithArchive(db)

    // Second call: table now has English columns
    const db2 = makeAdapter(raw)
    expect(() => recreateTasksTableWithArchive(db2)).not.toThrow()

    const rows = raw.prepare('SELECT title, status FROM tasks').all() as { title: string; status: string }[]
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('todo')
  })
})
