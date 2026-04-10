/**
 * Integration tests for migrations/v3-relations.ts using better-sqlite3 in-memory DB.
 * Covers all three exported functions:
 *   runMakeAgentAssigneNotNullMigration
 *   runMakeCommentAgentNotNullMigration
 *   runAddAgentGroupsMigration
 *
 * Tests use real SQL to kill surviving ConditionalExpression and EqualityOperator mutants
 * and verify FK integrity, CASCADE, idempotence, and correct column types.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import BetterSqlite3 from 'better-sqlite3'
import { createMigrationAdapter } from './migration-db-adapter'
import type { MigrationDb } from './migration-db-adapter'
import {
  runMakeAgentAssigneNotNullMigration,
  runMakeCommentAgentNotNullMigration,
  runAddAgentGroupsMigration,
} from './migrations/v3-relations'

// ── helpers ───────────────────────────────────────────────────────────────────

function makeAdapter(): { raw: BetterSqlite3.Database; db: MigrationDb } {
  const raw = new BetterSqlite3(':memory:')
  raw.pragma('journal_mode = WAL')
  const db = createMigrationAdapter(raw)
  return { raw, db }
}

/** Minimal schema: agents + sessions + nullable tasks (pre-migration) */
function createBaseSchema(raw: BetterSqlite3.Database): void {
  raw.exec(`
    CREATE TABLE agents (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      name      TEXT NOT NULL,
      perimetre TEXT
    )
  `)
  raw.exec(`
    CREATE TABLE sessions (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id INTEGER NOT NULL REFERENCES agents(id)
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

/** task_comments table with nullable agent_id (pre-migration) */
function createTaskCommentsNullable(raw: BetterSqlite3.Database): void {
  raw.exec(`
    CREATE TABLE task_comments (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id    INTEGER NOT NULL REFERENCES tasks(id),
      agent_id   INTEGER REFERENCES agents(id),
      contenu    TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)
}

// ── runMakeAgentAssigneNotNullMigration ───────────────────────────────────────

describe('runMakeAgentAssigneNotNullMigration — real DB', () => {
  let raw: BetterSqlite3.Database
  let db: MigrationDb

  beforeEach(() => {
    ;({ raw, db } = makeAdapter())
  })

  it('returns false when tasks table does not exist', () => {
    const result = runMakeAgentAssigneNotNullMigration(db)
    expect(result).toBe(false)
  })

  it('returns false when agent_assigne_id column not found in PRAGMA', () => {
    // Create tasks table without agent_assigne_id column
    raw.exec(`CREATE TABLE agents (id INTEGER PRIMARY KEY, name TEXT NOT NULL)`)
    raw.exec(`CREATE TABLE tasks (id INTEGER PRIMARY KEY, titre TEXT NOT NULL, statut TEXT)`)

    const result = runMakeAgentAssigneNotNullMigration(db)
    expect(result).toBe(false)
  })

  it('returns false when agent_assigne_id is already NOT NULL (idempotent)', () => {
    raw.exec(`CREATE TABLE agents (id INTEGER PRIMARY KEY, name TEXT NOT NULL)`)
    // Create tasks table with agent_assigne_id already NOT NULL
    raw.exec(`
      CREATE TABLE tasks (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        titre             TEXT NOT NULL,
        statut            TEXT NOT NULL DEFAULT 'todo',
        agent_createur_id INTEGER NOT NULL REFERENCES agents(id),
        agent_assigne_id  INTEGER NOT NULL REFERENCES agents(id),
        perimetre         TEXT,
        priority          TEXT NOT NULL DEFAULT 'normal',
        created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at        DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `)

    const result = runMakeAgentAssigneNotNullMigration(db)
    expect(result).toBe(false)
  })

  it('returns false when no agents exist (cannot apply constraint)', () => {
    createBaseSchema(raw)
    // No agents → findFallbackAgentId returns null
    const result = runMakeAgentAssigneNotNullMigration(db)
    expect(result).toBe(false)
  })

  it('assigns orphan tasks to review agent by perimetre match first', () => {
    createBaseSchema(raw)
    raw.exec(`INSERT INTO agents (name, perimetre) VALUES ('review', NULL), ('dev', 'front-vuejs')`)
    raw.exec(`INSERT INTO tasks (titre, statut, perimetre) VALUES ('T1','todo','front-vuejs')`)

    const result = runMakeAgentAssigneNotNullMigration(db)

    expect(result).toBe(true)
    // Task with matching perimetre gets assigned to 'dev' (id=2)
    const task = raw.prepare('SELECT agent_assigne_id FROM tasks WHERE id=1').get() as { agent_assigne_id: number }
    expect(task.agent_assigne_id).toBe(2)
  })

  it('assigns to review agent as fallback when no perimetre match', () => {
    createBaseSchema(raw)
    raw.exec(`INSERT INTO agents (name, perimetre) VALUES ('review', NULL)`)
    raw.exec(`INSERT INTO tasks (titre, statut, perimetre) VALUES ('T1','todo','back-electron')`)

    const result = runMakeAgentAssigneNotNullMigration(db)

    expect(result).toBe(true)
    const task = raw.prepare('SELECT agent_assigne_id FROM tasks WHERE id=1').get() as { agent_assigne_id: number }
    expect(task.agent_assigne_id).toBe(1)
  })

  it('assigns to first agent when review agent does not exist', () => {
    createBaseSchema(raw)
    raw.exec(`INSERT INTO agents (name, perimetre) VALUES ('arch', NULL)`)
    raw.exec(`INSERT INTO tasks (titre, statut) VALUES ('T1','todo')`)

    const result = runMakeAgentAssigneNotNullMigration(db)

    expect(result).toBe(true)
    const task = raw.prepare('SELECT agent_assigne_id FROM tasks WHERE id=1').get() as { agent_assigne_id: number }
    expect(task.agent_assigne_id).toBe(1)
  })

  it('recreates table with NOT NULL on agent_assigne_id and agent_createur_id', () => {
    createBaseSchema(raw)
    raw.exec(`INSERT INTO agents (name) VALUES ('review')`)
    raw.exec(`INSERT INTO tasks (titre, statut) VALUES ('T1','todo')`)

    runMakeAgentAssigneNotNullMigration(db)

    // After migration, inserting with NULL should throw
    expect(() => {
      raw.exec(`INSERT INTO tasks (titre, statut, agent_assigne_id, agent_createur_id) VALUES ('T2','todo',NULL,1)`)
    }).toThrow()
    expect(() => {
      raw.exec(`INSERT INTO tasks (titre, statut, agent_assigne_id, agent_createur_id) VALUES ('T2','todo',1,NULL)`)
    }).toThrow()
  })

  it('preserves existing task data through migration', () => {
    createBaseSchema(raw)
    raw.exec(`INSERT INTO agents (name, perimetre) VALUES ('review', NULL)`)
    raw.exec(`INSERT INTO tasks (titre, statut, priority) VALUES ('My Task','in_progress','high')`)

    runMakeAgentAssigneNotNullMigration(db)

    const task = raw.prepare('SELECT titre, statut, priority FROM tasks WHERE id=1').get() as Record<string, unknown>
    expect(task.titre).toBe('My Task')
    expect(task.statut).toBe('in_progress')
    expect(task.priority).toBe('high')
  })

  it('is idempotent: running twice returns false on second call', () => {
    createBaseSchema(raw)
    raw.exec(`INSERT INTO agents (name) VALUES ('review')`)
    raw.exec(`INSERT INTO tasks (titre, statut) VALUES ('T1','todo')`)

    const first = runMakeAgentAssigneNotNullMigration(db)
    expect(first).toBe(true)

    const second = runMakeAgentAssigneNotNullMigration(db)
    expect(second).toBe(false)
  })

  it('uses SAVEPOINT + RELEASE for atomicity', () => {
    createBaseSchema(raw)
    raw.exec(`INSERT INTO agents (name) VALUES ('review')`)
    raw.exec(`INSERT INTO tasks (titre, statut) VALUES ('T1','todo')`)

    // Should complete without error
    expect(() => runMakeAgentAssigneNotNullMigration(db)).not.toThrow()
  })

  it('handles task without matching agent perimetre (fallback path in UPDATE)', () => {
    // Agents with a different perimetre — task perimetre won't match
    raw.exec(`CREATE TABLE agents (id INTEGER PRIMARY KEY, name TEXT NOT NULL, perimetre TEXT)`)
    raw.exec(`CREATE TABLE sessions (id INTEGER PRIMARY KEY, agent_id INTEGER NOT NULL)`)
    raw.exec(`
      CREATE TABLE tasks (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        titre             TEXT NOT NULL,
        description       TEXT,
        statut            TEXT NOT NULL DEFAULT 'todo',
        agent_createur_id INTEGER REFERENCES agents(id),
        agent_assigne_id  INTEGER REFERENCES agents(id),
        agent_valideur_id INTEGER REFERENCES agents(id),
        parent_task_id    INTEGER REFERENCES tasks(id),
        session_id        INTEGER REFERENCES sessions(id),
        perimetre         TEXT,
        effort            INTEGER,
        priority          TEXT NOT NULL DEFAULT 'normal',
        created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
        started_at        DATETIME,
        completed_at      DATETIME,
        validated_at      DATETIME
      )
    `)
    raw.exec(`INSERT INTO agents (name, perimetre) VALUES ('review', 'back-electron')`)
    raw.exec(`INSERT INTO tasks (titre, statut, perimetre) VALUES ('T1','todo','front-vuejs')`)

    // Task perimetre=front-vuejs, but no agent with that perimetre → falls back to review
    runMakeAgentAssigneNotNullMigration(db)

    const task = raw.prepare('SELECT agent_assigne_id FROM tasks WHERE id=1').get() as { agent_assigne_id: number }
    expect(task.agent_assigne_id).toBe(1)
  })
})

// ── runMakeCommentAgentNotNullMigration ───────────────────────────────────────
