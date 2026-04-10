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

  it('recreates table with modern English CHECK constraint', () => {
    createLegacyNoArchive(raw)
    recreateTasksTableWithArchive(db)

    const schema = raw.prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='tasks'"
    ).get() as { sql: string }
    expect(schema.sql).toContain('archived')
    expect(schema.sql).toContain('todo')
    expect(schema.sql).toContain('in_progress')
    expect(schema.sql).toContain('done')
    expect(schema.sql).toContain('priority')
  })

  it('adds priority column to new table', () => {
    createLegacyNoArchive(raw)
    recreateTasksTableWithArchive(db)

    const cols = raw.prepare('PRAGMA table_info(tasks)').all() as { name: string }[]
    expect(cols.map(c => c.name)).toContain('priority')
  })

  it('drops backup table after migration', () => {
    createLegacyNoArchive(raw)
    recreateTasksTableWithArchive(db)

    const backup = raw.prepare("SELECT name FROM sqlite_master WHERE name='tasks_backup'").get()
    expect(backup).toBeUndefined()
  })

  it('preserves existing rows (data migration)', () => {
    createLegacyNoArchive(raw)
    raw.exec("INSERT INTO tasks (titre, statut) VALUES ('Task A', 'a_faire'), ('Task B', 'en_cours')")

    recreateTasksTableWithArchive(db)

    const rows = raw.prepare(
      'SELECT title, status FROM tasks ORDER BY id'
    ).all() as { title: string; status: string }[]
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({ title: 'Task A', status: 'todo' })
    expect(rows[1]).toEqual({ title: 'Task B', status: 'in_progress' })
  })

  it('maps French statut "terminé" → "done"', () => {
    createLegacyNoArchive(raw)
    raw.exec("INSERT INTO tasks (titre, statut) VALUES ('Done Task', 'terminé')")
    recreateTasksTableWithArchive(db)

    const row = raw.prepare('SELECT status FROM tasks WHERE title = ?').get('Done Task') as { status: string }
    expect(row.status).toBe('done')
  })

  it('maps French statut "validé" → "archived"', () => {
    createBareTable(raw)
    raw.exec("INSERT INTO tasks (titre, statut) VALUES ('Val Task', 'validé')")
    recreateTasksTableWithArchive(makeAdapter(raw))

    const row = raw.prepare('SELECT status FROM tasks WHERE title = ?').get('Val Task') as { status: string }
    expect(row.status).toBe('archived')
  })

  it('maps French statut "archivé" → "archived"', () => {
    createLegacyWithArchive(raw)
    raw.exec("INSERT INTO tasks (titre, statut) VALUES ('Arc Task', 'archivé')")
    recreateTasksTableWithArchive(makeAdapter(raw))

    const row = raw.prepare('SELECT status FROM tasks WHERE title = ?').get('Arc Task') as { status: string }
    expect(row.status).toBe('archived')
  })

  it('maps unknown statut → "todo" (ELSE branch)', () => {
    createBareTable(raw)
    raw.exec("INSERT INTO tasks (titre, statut) VALUES ('Unknown', 'unexpected_val')")
    recreateTasksTableWithArchive(makeAdapter(raw))

    const row = raw.prepare('SELECT status FROM tasks').get() as { status: string }
    expect(row.status).toBe('todo')
  })

  it('handles NULL statut → maps to "todo" (COALESCE)', () => {
    createBareTable(raw)
    raw.exec("INSERT INTO tasks (titre, statut) VALUES ('Null Task', NULL)")
    recreateTasksTableWithArchive(makeAdapter(raw))

    const row = raw.prepare('SELECT status FROM tasks').get() as { status: string }
    expect(row.status).toBe('todo')
  })

  it('uses "title" column if already English (titleSrc — no fallback)', () => {
    raw.exec(`
      CREATE TABLE tasks (
        id INTEGER PRIMARY KEY,
        title TEXT NOT NULL DEFAULT '',
        description TEXT,
        scope TEXT,
        statut TEXT NOT NULL DEFAULT 'a_faire',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `)
    raw.exec("INSERT INTO tasks (title, statut) VALUES ('English Title', 'a_faire')")
    recreateTasksTableWithArchive(makeAdapter(raw))

    const row = raw.prepare('SELECT title, status FROM tasks').get() as { title: string; status: string }
    expect(row.title).toBe('English Title')
    expect(row.status).toBe('todo')
  })

  it('uses "scope" column if already English (scopeSrc — scope present)', () => {
    raw.exec(`
      CREATE TABLE tasks (
        id INTEGER PRIMARY KEY,
        title TEXT NOT NULL DEFAULT '',
        description TEXT,
        scope TEXT,
        statut TEXT DEFAULT 'a_faire',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `)
    raw.exec("INSERT INTO tasks (title, scope, statut) VALUES ('T', 'front-vuejs', 'a_faire')")
    recreateTasksTableWithArchive(makeAdapter(raw))

    const row = raw.prepare('SELECT scope FROM tasks').get() as { scope: string | null }
    expect(row.scope).toBe('front-vuejs')
  })

  it('uses "perimetre" when scope absent (scopeSrc fallback)', () => {
    raw.exec(`
      CREATE TABLE tasks (
        id INTEGER PRIMARY KEY,
        titre TEXT NOT NULL DEFAULT '',
        description TEXT,
        perimetre TEXT,
        statut TEXT DEFAULT 'a_faire',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `)
    raw.exec("INSERT INTO tasks (titre, perimetre, statut) VALUES ('T', 'back-electron', 'a_faire')")
    recreateTasksTableWithArchive(makeAdapter(raw))

    const row = raw.prepare('SELECT scope FROM tasks').get() as { scope: string | null }
    expect(row.scope).toBe('back-electron')
  })

  it('uses "status" if already English (statusSrc — no CASE expression)', () => {
    raw.exec(`
      CREATE TABLE tasks (
        id INTEGER PRIMARY KEY,
        title TEXT NOT NULL DEFAULT '',
        description TEXT,
        scope TEXT,
        status TEXT NOT NULL DEFAULT 'todo',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `)
    raw.exec("INSERT INTO tasks (title, status) VALUES ('T', 'in_progress')")
    recreateTasksTableWithArchive(makeAdapter(raw))

    const row = raw.prepare('SELECT status FROM tasks').get() as { status: string }
    expect(row.status).toBe('in_progress')
  })

  it('uses existing "priority" column if present (priorityExpr — column used)', () => {
    raw.exec(`
      CREATE TABLE tasks (
        id INTEGER PRIMARY KEY,
        title TEXT NOT NULL DEFAULT '',
        description TEXT,
        scope TEXT,
        status TEXT NOT NULL DEFAULT 'todo',
        priority TEXT NOT NULL DEFAULT 'normal',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `)
    raw.exec("INSERT INTO tasks (title, status, priority) VALUES ('T', 'todo', 'high')")
    recreateTasksTableWithArchive(makeAdapter(raw))

    const row = raw.prepare('SELECT priority FROM tasks').get() as { priority: string }
    expect(row.priority).toBe('high')
  })

  it("defaults priority to 'normal' when column absent (priorityExpr — literal)", () => {
    createLegacyNoArchive(raw)
    raw.exec("INSERT INTO tasks (titre, statut) VALUES ('T', 'a_faire')")
    recreateTasksTableWithArchive(db)

    const row = raw.prepare('SELECT priority FROM tasks').get() as { priority: string }
    expect(row.priority).toBe('normal')
  })

  it('uses agent_creator_id if present (English)', () => {
    raw.exec('INSERT INTO agents VALUES (42)') // satisfy FK
    raw.exec(`
      CREATE TABLE tasks (
        id INTEGER PRIMARY KEY,
        title TEXT NOT NULL DEFAULT '',
        description TEXT,
        scope TEXT,
        status TEXT NOT NULL DEFAULT 'todo',
        agent_creator_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `)
    raw.exec("INSERT INTO tasks (title, status, agent_creator_id) VALUES ('T', 'todo', 42)")
    recreateTasksTableWithArchive(makeAdapter(raw))

    const row = raw.prepare('SELECT agent_creator_id FROM tasks').get() as { agent_creator_id: number | null }
    expect(row.agent_creator_id).toBe(42)
  })

  it('falls back to agent_createur_id (French) when agent_creator_id absent', () => {
    raw.exec('INSERT INTO agents VALUES (7)') // satisfy FK
    raw.exec(`
      CREATE TABLE tasks (
        id INTEGER PRIMARY KEY,
        titre TEXT NOT NULL DEFAULT '',
        description TEXT,
        perimetre TEXT,
        statut TEXT NOT NULL DEFAULT 'a_faire',
        agent_createur_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `)
    raw.exec("INSERT INTO tasks (titre, statut, agent_createur_id) VALUES ('T', 'a_faire', 7)")
    recreateTasksTableWithArchive(makeAdapter(raw))

    const row = raw.prepare('SELECT agent_creator_id FROM tasks').get() as { agent_creator_id: number | null }
    expect(row.agent_creator_id).toBe(7)
  })

  it('uses agent_assigned_id if present (English)', () => {
    raw.exec('INSERT INTO agents VALUES (15)') // satisfy FK
    raw.exec(`
      CREATE TABLE tasks (
        id INTEGER PRIMARY KEY,
        title TEXT NOT NULL DEFAULT '',
        description TEXT,
        scope TEXT,
        status TEXT NOT NULL DEFAULT 'todo',
        agent_assigned_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `)
    raw.exec("INSERT INTO tasks (title, status, agent_assigned_id) VALUES ('T', 'todo', 15)")
    recreateTasksTableWithArchive(makeAdapter(raw))

    const row = raw.prepare('SELECT agent_assigned_id FROM tasks').get() as { agent_assigned_id: number | null }
    expect(row.agent_assigned_id).toBe(15)
  })

})
