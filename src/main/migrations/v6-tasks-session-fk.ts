import type { MigrationDb } from '../migration-db-adapter'
type Database = MigrationDb

/**
 * Migration: Fix tasks.session_id foreign key reference (T1161).
 *
 * Problem: After the sessions i18n migration (v16) which temporarily renamed
 * sessions → sessions_backup_i18n, the tasks table retains the stale
 * REFERENCES "sessions_backup_i18n"(id) in its stored CREATE TABLE statement.
 * With better-sqlite3 enabling foreign_keys=ON by default, any DML on tasks
 * fails with "no such table: main.sessions_backup_i18n".
 *
 * Fix: Recreate the tasks table with session_id REFERENCES sessions(id),
 * preserving all data and re-attaching the tasks_fts triggers.
 *
 * Idempotent: returns false if the FK reference is already correct.
 *
 * @returns true if the table was recreated, false if already correct.
 */
export function runFixTasksSessionFkMigration(db: Database): boolean {
  const schemaResult = db.exec(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='tasks'"
  )
  if (schemaResult.length === 0 || schemaResult[0].values.length === 0) return false

  const tasksSql = schemaResult[0].values[0][0] as string
  if (!tasksSql.includes('sessions_backup_i18n')) return false

  const tmpTable = 'tasks_session_fk_old'

  // Drop FTS triggers that reference the tasks table (will be recreated below)
  db.run('DROP TRIGGER IF EXISTS tasks_fts_ai')
  db.run('DROP TRIGGER IF EXISTS tasks_fts_au')
  db.run('DROP TRIGGER IF EXISTS tasks_fts_ad')

  // Use legacy_alter_table to prevent SQLite 3.26+ from cascading FK reference
  // updates into task_agents/task_links/task_comments when renaming tasks.
  // This keeps those tables referencing 'tasks' by name, so they automatically
  // point to the newly created tasks table after the recreation.
  db.run('PRAGMA legacy_alter_table = ON')
  db.run(`ALTER TABLE tasks RENAME TO ${tmpTable}`)
  db.run('PRAGMA legacy_alter_table = OFF')

  // Recreate tasks with correct FK reference
  db.run(`
    CREATE TABLE tasks (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      title             TEXT NOT NULL,
      description       TEXT,
      status            TEXT NOT NULL DEFAULT 'todo'
        CHECK(status IN ('todo','in_progress','done','archived')),
      agent_creator_id  INTEGER NOT NULL REFERENCES agents(id),
      agent_assigned_id INTEGER NOT NULL REFERENCES agents(id),
      agent_validator_id INTEGER REFERENCES agents(id),
      parent_task_id    INTEGER REFERENCES tasks(id),
      session_id        INTEGER REFERENCES sessions(id),
      scope             TEXT,
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

  // Copy all data from old table
  db.run(`INSERT INTO tasks SELECT id, title, description, status,
    agent_creator_id, agent_assigned_id, agent_validator_id,
    parent_task_id, session_id, scope, effort, priority,
    created_at, updated_at, started_at, completed_at, validated_at
    FROM ${tmpTable}`)

  // Drop old table
  db.run(`DROP TABLE ${tmpTable}`)

  // Recreate FTS triggers for tasks_fts (if the FTS table exists)
  const ftsExists = db.exec(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='tasks_fts'"
  )
  if (ftsExists.length > 0 && ftsExists[0].values.length > 0) {
    db.run(`CREATE TRIGGER tasks_fts_ai AFTER INSERT ON tasks BEGIN
      INSERT INTO tasks_fts(rowid, title, description) VALUES (new.id, new.title, new.description);
    END`)
    db.run(`CREATE TRIGGER tasks_fts_au AFTER UPDATE ON tasks BEGIN
      DELETE FROM tasks_fts WHERE rowid = old.id;
      INSERT INTO tasks_fts(rowid, title, description) VALUES (new.id, new.title, new.description);
    END`)
    db.run(`CREATE TRIGGER tasks_fts_ad AFTER DELETE ON tasks BEGIN
      DELETE FROM tasks_fts WHERE rowid = old.id;
    END`)
  }

  // Recreate indexes that were on tasks
  db.run('CREATE INDEX IF NOT EXISTS idx_tasks_updated_at ON tasks(updated_at DESC)')
  db.run('CREATE INDEX IF NOT EXISTS idx_tasks_agent_assigne ON tasks(agent_assigned_id)')
  db.run('CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)')

  return true
}
