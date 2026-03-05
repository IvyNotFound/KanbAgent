import type { Database } from 'sql.js'

/**
 * Helper: finds the 'review' agent id, or the first agent id as fallback.
 * Returns null if no agents exist.
 */
function findFallbackAgentId(db: Database): number | null {
  const reviewResult = db.exec("SELECT id FROM agents WHERE name = 'review' LIMIT 1")
  if (reviewResult.length > 0 && reviewResult[0].values.length > 0) {
    return reviewResult[0].values[0][0] as number
  }
  const anyAgent = db.exec('SELECT id FROM agents ORDER BY id LIMIT 1')
  if (anyAgent.length > 0 && anyAgent[0].values.length > 0) {
    return anyAgent[0].values[0][0] as number
  }
  return null
}

/**
 * Migration: Makes `agent_assigne_id` and `agent_createur_id` NOT NULL on the
 * tasks table (task #342).
 *
 * Strategy:
 *   1. Check if agent_assigne_id is already NOT NULL (idempotent).
 *   2. Assign orphan tasks (NULL agent columns) to a default agent:
 *      - Match by perimetre if possible (first agent with same perimetre).
 *      - Fallback to the 'review' agent (global scope).
 *      - Last resort: first agent in the agents table.
 *   3. Recreate the tasks table with both columns as NOT NULL.
 *
 * Idempotent: returns false if agent_assigne_id is already NOT NULL.
 *
 * @returns true if the migration was applied, false if already up-to-date.
 */
export function runMakeAgentAssigneNotNullMigration(db: Database): boolean {
  const colResult = db.exec('PRAGMA table_info(tasks)')
  if (colResult.length === 0) return false

  const cols = colResult[0].values // [cid, name, type, notnull, dflt_value, pk]
  const assigneCol = cols.find((r: unknown[]) => r[1] === 'agent_assigne_id')
  if (!assigneCol) return false
  if (assigneCol[3] === 1) return false // already NOT NULL

  // Find a fallback agent id for orphan tasks
  const fallbackAgentId = findFallbackAgentId(db)
  if (fallbackAgentId === null) return false // no agents → can't apply constraint

  // Assign orphan tasks by perimetre match first, then fallback
  db.run(`
    UPDATE tasks SET agent_assigne_id = (
      SELECT a.id FROM agents a
      WHERE a.perimetre = tasks.perimetre
      ORDER BY a.id LIMIT 1
    )
    WHERE agent_assigne_id IS NULL
    AND EXISTS (
      SELECT 1 FROM agents a WHERE a.perimetre = tasks.perimetre
    )
  `)
  db.run(
    'UPDATE tasks SET agent_assigne_id = ? WHERE agent_assigne_id IS NULL',
    [fallbackAgentId]
  )

  // Same for agent_createur_id
  db.run(`
    UPDATE tasks SET agent_createur_id = (
      SELECT a.id FROM agents a
      WHERE a.perimetre = tasks.perimetre
      ORDER BY a.id LIMIT 1
    )
    WHERE agent_createur_id IS NULL
    AND EXISTS (
      SELECT 1 FROM agents a WHERE a.perimetre = tasks.perimetre
    )
  `)
  db.run(
    'UPDATE tasks SET agent_createur_id = ? WHERE agent_createur_id IS NULL',
    [fallbackAgentId]
  )

  // Recreate table with NOT NULL constraints
  const existingCols = cols.map((r: unknown[]) => r[1] as string)
  const tempTable = 'tasks_backup_notnull'

  db.run('SAVEPOINT make_assigne_notnull')
  try {
    db.run(`ALTER TABLE tasks RENAME TO ${tempTable}`)

    db.run(`
      CREATE TABLE tasks (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        titre             TEXT NOT NULL,
        description       TEXT,
        statut            TEXT NOT NULL DEFAULT 'todo'
          CHECK(statut IN ('todo','in_progress','done','archived')),
        agent_createur_id INTEGER NOT NULL REFERENCES agents(id),
        agent_assigne_id  INTEGER NOT NULL REFERENCES agents(id),
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

    const colMapping: Record<string, string> = {
      id:               'id',
      titre:            'titre',
      description:      'description',
      statut:           'statut',
      agent_createur_id: existingCols.includes('agent_createur_id') ? 'agent_createur_id' : String(fallbackAgentId),
      agent_assigne_id:  'agent_assigne_id',
      agent_valideur_id: existingCols.includes('agent_valideur_id') ? 'agent_valideur_id' : 'NULL',
      parent_task_id:    existingCols.includes('parent_task_id')    ? 'parent_task_id'    : 'NULL',
      session_id:        existingCols.includes('session_id')        ? 'session_id'        : 'NULL',
      perimetre:        'perimetre',
      effort:            existingCols.includes('effort')            ? 'effort'            : 'NULL',
      priority:          existingCols.includes('priority')          ? 'priority'          : "'normal'",
      created_at:       'created_at',
      updated_at:       'updated_at',
      started_at:        existingCols.includes('started_at')   ? 'started_at'   : 'NULL',
      completed_at:      existingCols.includes('completed_at') ? 'completed_at' : 'NULL',
      validated_at:      existingCols.includes('validated_at') ? 'validated_at' : 'NULL',
    }

    const insertCols = Object.keys(colMapping).join(', ')
    const insertVals = Object.values(colMapping).join(', ')

    db.run(`INSERT INTO tasks (${insertCols}) SELECT ${insertVals} FROM ${tempTable}`)
    db.run(`DROP TABLE ${tempTable}`)

    db.run('RELEASE SAVEPOINT make_assigne_notnull')
  } catch (err) {
    db.run('ROLLBACK TO SAVEPOINT make_assigne_notnull')
    db.run('RELEASE SAVEPOINT make_assigne_notnull')
    throw err
  }

  return true
}

/**
 * Migration: Makes `agent_id` NOT NULL on the task_comments table (task #342).
 *
 * Orphan comments (agent_id IS NULL, typically from the commentaire→task_comments
 * migration) are assigned to the 'review' agent or the first available agent.
 *
 * Idempotent: returns false if agent_id is already NOT NULL.
 *
 * @returns true if the migration was applied, false if already up-to-date.
 */
export function runMakeCommentAgentNotNullMigration(db: Database): boolean {
  const colResult = db.exec('PRAGMA table_info(task_comments)')
  if (colResult.length === 0) return false

  const cols = colResult[0].values
  const agentCol = cols.find((r: unknown[]) => r[1] === 'agent_id')
  if (!agentCol) return false
  if (agentCol[3] === 1) return false // already NOT NULL

  const fallbackAgentId = findFallbackAgentId(db)
  if (fallbackAgentId === null) return false

  // Assign orphan comments to fallback agent
  db.run(
    'UPDATE task_comments SET agent_id = ? WHERE agent_id IS NULL',
    [fallbackAgentId]
  )

  // Recreate table with NOT NULL constraint
  const existingCols = cols.map((r: unknown[]) => r[1] as string)
  const tempTable = 'task_comments_backup_notnull'

  db.run('SAVEPOINT make_comment_agent_notnull')
  try {
    db.run(`ALTER TABLE task_comments RENAME TO ${tempTable}`)

    db.run(`
      CREATE TABLE task_comments (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id    INTEGER NOT NULL REFERENCES tasks(id),
        agent_id   INTEGER NOT NULL REFERENCES agents(id),
        contenu    TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `)

    const colMapping: Record<string, string> = {
      id:         'id',
      task_id:    'task_id',
      agent_id:   'agent_id',
      contenu:    'contenu',
      created_at: existingCols.includes('created_at') ? 'created_at' : 'CURRENT_TIMESTAMP',
    }

    const insertCols = Object.keys(colMapping).join(', ')
    const insertVals = Object.values(colMapping).join(', ')

    db.run(`INSERT INTO task_comments (${insertCols}) SELECT ${insertVals} FROM ${tempTable}`)
    db.run(`DROP TABLE ${tempTable}`)

    db.run('RELEASE SAVEPOINT make_comment_agent_notnull')
  } catch (err) {
    db.run('ROLLBACK TO SAVEPOINT make_comment_agent_notnull')
    db.run('RELEASE SAVEPOINT make_comment_agent_notnull')
    throw err
  }

  return true
}

/**
 * Migration: Creates agent_groups and agent_group_members tables (T556).
 *
 * agent_groups: user-defined groupings for agents (name, sort_order).
 * agent_group_members: links agents to groups (one agent → at most one group, UNIQUE(agent_id)).
 *
 * ON DELETE CASCADE is NOT used here — FK enforcement requires PRAGMA foreign_keys = ON
 * which is not enabled by default in sql.js. Cascades are handled explicitly in handlers.
 *
 * Idempotent: returns false if agent_groups already exists.
 *
 * @returns true if the tables were created, false if already present.
 */
export function runAddAgentGroupsMigration(db: Database): boolean {
  const tableResult = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='agent_groups'")
  if (tableResult.length > 0 && tableResult[0].values.length > 0) return false

  db.run('SAVEPOINT add_agent_groups')
  try {
    db.run(`
      CREATE TABLE agent_groups (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `)
    db.run(`
      CREATE TABLE agent_group_members (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        group_id   INTEGER NOT NULL REFERENCES agent_groups(id),
        agent_id   INTEGER NOT NULL REFERENCES agents(id),
        sort_order INTEGER NOT NULL DEFAULT 0,
        UNIQUE(agent_id)
      )
    `)
    db.run('CREATE INDEX IF NOT EXISTS idx_agm_group ON agent_group_members(group_id)')
    db.run('RELEASE SAVEPOINT add_agent_groups')
  } catch (err) {
    db.run('ROLLBACK TO SAVEPOINT add_agent_groups')
    db.run('RELEASE SAVEPOINT add_agent_groups')
    throw err
  }
  return true
}
