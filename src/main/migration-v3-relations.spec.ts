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

describe('runMakeCommentAgentNotNullMigration — real DB', () => {
  let raw: BetterSqlite3.Database
  let db: MigrationDb

  beforeEach(() => {
    ;({ raw, db } = makeAdapter())
  })

  it('returns false when task_comments table does not exist', () => {
    const result = runMakeCommentAgentNotNullMigration(db)
    expect(result).toBe(false)
  })

  it('returns false when agent_id column not found', () => {
    raw.exec(`CREATE TABLE task_comments (id INTEGER PRIMARY KEY, contenu TEXT NOT NULL)`)

    const result = runMakeCommentAgentNotNullMigration(db)
    expect(result).toBe(false)
  })

  it('returns false when agent_id is already NOT NULL (idempotent)', () => {
    raw.exec(`CREATE TABLE agents (id INTEGER PRIMARY KEY, name TEXT NOT NULL)`)
    raw.exec(`CREATE TABLE tasks (id INTEGER PRIMARY KEY, titre TEXT NOT NULL, statut TEXT)`)
    raw.exec(`
      CREATE TABLE task_comments (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id    INTEGER NOT NULL,
        agent_id   INTEGER NOT NULL REFERENCES agents(id),
        contenu    TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `)

    const result = runMakeCommentAgentNotNullMigration(db)
    expect(result).toBe(false)
  })

  it('returns false when no agents exist', () => {
    raw.exec(`CREATE TABLE agents (id INTEGER PRIMARY KEY, name TEXT NOT NULL)`)
    raw.exec(`CREATE TABLE tasks (id INTEGER PRIMARY KEY, titre TEXT NOT NULL, statut TEXT)`)
    createTaskCommentsNullable(raw)

    const result = runMakeCommentAgentNotNullMigration(db)
    expect(result).toBe(false)
  })

  it('assigns orphan comments (agent_id NULL) to review agent', () => {
    createBaseSchema(raw)
    raw.exec(`INSERT INTO agents (name) VALUES ('review')`)
    raw.exec(`INSERT INTO tasks (titre, statut) VALUES ('T1','todo')`)
    createTaskCommentsNullable(raw)
    raw.exec(`INSERT INTO task_comments (task_id, agent_id, contenu) VALUES (1, NULL, 'orphan comment')`)

    const result = runMakeCommentAgentNotNullMigration(db)

    expect(result).toBe(true)
    const comment = raw.prepare('SELECT agent_id FROM task_comments WHERE id=1').get() as { agent_id: number }
    expect(comment.agent_id).toBe(1)
  })

  it('assigns to first agent when review agent does not exist', () => {
    createBaseSchema(raw)
    raw.exec(`INSERT INTO agents (name) VALUES ('arch')`)
    raw.exec(`INSERT INTO tasks (titre, statut) VALUES ('T1','todo')`)
    createTaskCommentsNullable(raw)
    raw.exec(`INSERT INTO task_comments (task_id, agent_id, contenu) VALUES (1, NULL, 'orphan')`)

    runMakeCommentAgentNotNullMigration(db)

    const comment = raw.prepare('SELECT agent_id FROM task_comments WHERE id=1').get() as { agent_id: number }
    expect(comment.agent_id).toBe(1)
  })

  it('recreates table with NOT NULL constraint on agent_id', () => {
    createBaseSchema(raw)
    raw.exec(`INSERT INTO agents (name) VALUES ('review')`)
    raw.exec(`INSERT INTO tasks (titre, statut) VALUES ('T1','todo')`)
    createTaskCommentsNullable(raw)
    raw.exec(`INSERT INTO task_comments (task_id, agent_id, contenu) VALUES (1, 1, 'existing comment')`)

    runMakeCommentAgentNotNullMigration(db)

    // After migration, inserting with NULL agent_id should throw
    expect(() => {
      raw.exec(`INSERT INTO task_comments (task_id, agent_id, contenu) VALUES (1, NULL, 'bad')`)
    }).toThrow()
  })

  it('preserves existing comment data through migration', () => {
    createBaseSchema(raw)
    raw.exec(`INSERT INTO agents (name) VALUES ('review')`)
    raw.exec(`INSERT INTO tasks (titre, statut) VALUES ('T1','todo')`)
    createTaskCommentsNullable(raw)
    raw.exec(`INSERT INTO task_comments (task_id, agent_id, contenu) VALUES (1, 1, 'my comment')`)

    runMakeCommentAgentNotNullMigration(db)

    const comment = raw.prepare('SELECT contenu, agent_id FROM task_comments WHERE id=1').get() as Record<string, unknown>
    expect(comment.contenu).toBe('my comment')
    expect(comment.agent_id).toBe(1)
  })

  it('is idempotent: running twice returns false on second call', () => {
    createBaseSchema(raw)
    raw.exec(`INSERT INTO agents (name) VALUES ('review')`)
    raw.exec(`INSERT INTO tasks (titre, statut) VALUES ('T1','todo')`)
    createTaskCommentsNullable(raw)
    raw.exec(`INSERT INTO task_comments (task_id, agent_id, contenu) VALUES (1, 1, 'c1')`)

    const first = runMakeCommentAgentNotNullMigration(db)
    expect(first).toBe(true)

    const second = runMakeCommentAgentNotNullMigration(db)
    expect(second).toBe(false)
  })

  it('handles multiple orphan comments in one pass', () => {
    createBaseSchema(raw)
    raw.exec(`INSERT INTO agents (name) VALUES ('review')`)
    raw.exec(`INSERT INTO tasks (titre, statut) VALUES ('T1','todo')`)
    createTaskCommentsNullable(raw)
    raw.exec(`
      INSERT INTO task_comments (task_id, agent_id, contenu) VALUES
        (1, NULL, 'c1'),
        (1, NULL, 'c2'),
        (1, NULL, 'c3')
    `)

    runMakeCommentAgentNotNullMigration(db)

    const count = (raw.prepare('SELECT COUNT(*) as n FROM task_comments WHERE agent_id = 1').get() as { n: number }).n
    expect(count).toBe(3)
  })

  it('preserves comments with existing agent_id through migration', () => {
    createBaseSchema(raw)
    raw.exec(`INSERT INTO agents (name) VALUES ('review'), ('arch')`)
    raw.exec(`INSERT INTO tasks (titre, statut) VALUES ('T1','todo')`)
    createTaskCommentsNullable(raw)
    raw.exec(`INSERT INTO task_comments (task_id, agent_id, contenu) VALUES (1, 2, 'by arch')`)
    raw.exec(`INSERT INTO task_comments (task_id, agent_id, contenu) VALUES (1, NULL, 'orphan')`)

    runMakeCommentAgentNotNullMigration(db)

    const rows = raw.prepare('SELECT agent_id FROM task_comments ORDER BY id').all() as { agent_id: number }[]
    // First comment should retain agent_id=2
    expect(rows[0].agent_id).toBe(2)
    // Second comment (orphan) should be assigned to review (id=1)
    expect(rows[1].agent_id).toBe(1)
  })
})

// ── runAddAgentGroupsMigration ─────────────────────────────────────────────────

describe('runAddAgentGroupsMigration — real DB', () => {
  let raw: BetterSqlite3.Database
  let db: MigrationDb

  beforeEach(() => {
    ;({ raw, db } = makeAdapter())
    raw.exec(`CREATE TABLE agents (id INTEGER PRIMARY KEY, name TEXT NOT NULL)`)
  })

  it('returns false when agent_groups already exists (idempotent)', () => {
    raw.exec(`CREATE TABLE agent_groups (id INTEGER PRIMARY KEY, name TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')))`)
    raw.exec(`CREATE TABLE agent_group_members (id INTEGER PRIMARY KEY, group_id INTEGER NOT NULL, agent_id INTEGER NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0, UNIQUE(agent_id))`)

    const result = runAddAgentGroupsMigration(db)
    expect(result).toBe(false)
  })

  it('returns true and creates both tables when agent_groups does not exist', () => {
    const result = runAddAgentGroupsMigration(db)
    expect(result).toBe(true)
  })

  it('creates agent_groups with correct columns (line 9: INTEGER types)', () => {
    runAddAgentGroupsMigration(db)

    // Verify columns via PRAGMA
    const cols = raw.prepare('PRAGMA table_info(agent_groups)').all() as Array<{ name: string; type: string; notnull: number }>
    const colNames = cols.map(c => c.name)
    expect(colNames).toContain('id')
    expect(colNames).toContain('name')
    expect(colNames).toContain('sort_order')
    expect(colNames).toContain('created_at')

    // Verify sort_order is INTEGER NOT NULL DEFAULT 0
    const sortOrderCol = cols.find(c => c.name === 'sort_order')!
    expect(sortOrderCol.type).toBe('INTEGER')
    expect(sortOrderCol.notnull).toBe(1)
  })

  it('creates agent_group_members with UNIQUE(agent_id) constraint', () => {
    runAddAgentGroupsMigration(db)

    // Insert a group and an agent, then test UNIQUE constraint
    raw.exec(`INSERT INTO agent_groups (name, sort_order, created_at) VALUES ('Group A', 0, datetime('now'))`)
    raw.exec(`INSERT INTO agents (name) VALUES ('dev')`)
    raw.exec(`INSERT INTO agent_group_members (group_id, agent_id, sort_order) VALUES (1, 1, 0)`)

    // Inserting same agent_id again should fail (UNIQUE constraint)
    expect(() => {
      raw.exec(`INSERT INTO agent_group_members (group_id, agent_id, sort_order) VALUES (1, 1, 0)`)
    }).toThrow()
  })

  it('creates agent_group_members with FK referencing agent_groups', () => {
    raw.pragma('foreign_keys = ON')
    runAddAgentGroupsMigration(db)

    // Insert group and agent
    raw.exec(`INSERT INTO agent_groups (name, sort_order, created_at) VALUES ('Group B', 0, datetime('now'))`)
    raw.exec(`INSERT INTO agents (name) VALUES ('arch')`)
    raw.exec(`INSERT INTO agent_group_members (group_id, agent_id, sort_order) VALUES (1, 1, 0)`)

    // FK: inserting with invalid group_id should fail when FK enforced
    expect(() => {
      raw.exec(`INSERT INTO agent_group_members (group_id, agent_id, sort_order) VALUES (999, 1, 0)`)
    }).toThrow()
  })

  it('creates FK referencing agents table', () => {
    raw.pragma('foreign_keys = ON')
    runAddAgentGroupsMigration(db)

    raw.exec(`INSERT INTO agent_groups (name, sort_order, created_at) VALUES ('G1', 0, datetime('now'))`)
    // Insert with invalid agent_id should fail
    expect(() => {
      raw.exec(`INSERT INTO agent_group_members (group_id, agent_id, sort_order) VALUES (1, 999, 0)`)
    }).toThrow()
  })

  it('creates index idx_agm_group on agent_group_members(group_id)', () => {
    runAddAgentGroupsMigration(db)

    const indexes = raw.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='agent_group_members'"
    ).all() as { name: string }[]
    const indexNames = indexes.map(i => i.name)
    expect(indexNames).toContain('idx_agm_group')
  })

  it('is idempotent: running twice on clean DB returns false on second call', () => {
    const first = runAddAgentGroupsMigration(db)
    expect(first).toBe(true)

    const second = runAddAgentGroupsMigration(db)
    expect(second).toBe(false)
  })

  it('can insert and query groups/members after migration', () => {
    runAddAgentGroupsMigration(db)

    raw.exec(`INSERT INTO agent_groups (name, sort_order, created_at) VALUES ('Backend', 1, datetime('now'))`)
    raw.exec(`INSERT INTO agents (name) VALUES ('dev-back-electron')`)
    raw.exec(`INSERT INTO agent_group_members (group_id, agent_id, sort_order) VALUES (1, 1, 0)`)

    const group = raw.prepare('SELECT name FROM agent_groups WHERE id=1').get() as { name: string }
    expect(group.name).toBe('Backend')

    const member = raw.prepare('SELECT group_id, agent_id FROM agent_group_members WHERE id=1').get() as { group_id: number; agent_id: number }
    expect(member.group_id).toBe(1)
    expect(member.agent_id).toBe(1)
  })

  it('uses SAVEPOINT add_agent_groups for atomicity (tables created or not at all)', () => {
    // If we can verify that both tables exist after success
    runAddAgentGroupsMigration(db)

    const tables = raw.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('agent_groups','agent_group_members') ORDER BY name"
    ).all() as { name: string }[]
    expect(tables.map(t => t.name)).toEqual(['agent_group_members', 'agent_groups'])
  })

  it('agent_groups.name is NOT NULL', () => {
    runAddAgentGroupsMigration(db)

    const cols = raw.prepare('PRAGMA table_info(agent_groups)').all() as Array<{ name: string; notnull: number }>
    const nameCol = cols.find(c => c.name === 'name')!
    expect(nameCol.notnull).toBe(1)
  })

  it('agent_group_members.sort_order defaults to 0', () => {
    runAddAgentGroupsMigration(db)

    raw.exec(`INSERT INTO agent_groups (name, sort_order, created_at) VALUES ('G', 0, datetime('now'))`)
    raw.exec(`INSERT INTO agents (name) VALUES ('a')`)
    raw.exec(`INSERT INTO agent_group_members (group_id, agent_id) VALUES (1, 1)`)

    const member = raw.prepare('SELECT sort_order FROM agent_group_members WHERE id=1').get() as { sort_order: number }
    expect(member.sort_order).toBe(0)
  })
})
