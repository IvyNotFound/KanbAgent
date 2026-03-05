import type { Database } from 'sql.js'

/**
 * Returns true if the tasks table CHECK constraint already includes a modern
 * archive value ('archivé' French or 'archived' / 'done' English).
 * When false, the table needs to be recreated before any status migration can run.
 */
export function isArchiveAllowedInCheck(db: Database): boolean {
  const result = db.exec("SELECT sql FROM sqlite_master WHERE type='table' AND name='tasks'")
  if (result.length === 0 || result[0].values.length === 0) {
    // Table doesn't exist or no schema — assume OK
    return true
  }
  const tableSchema = result[0].values[0][0] as string
  // Accept both French legacy values and new English values
  return (
    tableSchema.includes('archivé') ||
    tableSchema.includes('archived') ||
    tableSchema.includes("'done'")
  )
}

/**
 * Recreates the tasks table with the modern English CHECK constraint.
 * Called for very old DBs whose CHECK constraint predates 'archivé'/'archived'.
 * Uses INSERT INTO ... SELECT to preserve existing data.
 * Also adds the `priority` column if not already present.
 */
export function recreateTasksTableWithArchive(db: Database): void {
  const tempTable = 'tasks_backup'
  db.run(`ALTER TABLE tasks RENAME TO ${tempTable}`)

  // Inspect old column list for safe SELECT mapping
  const oldColumns = db.exec(`PRAGMA table_info(${tempTable})`)
  const oldColNames: string[] =
    oldColumns.length > 0
      ? (oldColumns[0].values.map((row: unknown[]) => row[1] as string))
      : []

  // Create new table with English CHECK constraint (incl. priority)
  db.run(`
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

  // Map old French statut values to English in-place during the copy
  const statutExpr = `CASE COALESCE(statut, 'a_faire')
      WHEN 'a_faire'  THEN 'todo'
      WHEN 'en_cours' THEN 'in_progress'
      WHEN 'terminé'  THEN 'done'
      WHEN 'validé'   THEN 'archived'
      WHEN 'archivé'  THEN 'archived'
      ELSE 'todo'
    END`

  const priorityExpr = oldColNames.includes('priority') ? 'priority' : "'normal'"

  // Build dynamic INSERT based on old columns (handles old schemas without various columns)
  const colMapping: Record<string, string> = {
    id:               'id',
    titre:            'titre',
    description:      'description',
    statut:           statutExpr,
    agent_createur_id: oldColNames.includes('agent_createur_id') ? 'agent_createur_id' : 'NULL',
    agent_assigne_id:  oldColNames.includes('agent_assigne_id')  ? 'agent_assigne_id'  : 'NULL',
    agent_valideur_id: oldColNames.includes('agent_valideur_id') ? 'agent_valideur_id' : 'NULL',
    parent_task_id:    oldColNames.includes('parent_task_id')    ? 'parent_task_id'    : 'NULL',
    session_id:        oldColNames.includes('session_id')        ? 'session_id'        : 'NULL',
    perimetre:        'perimetre',
    effort:            oldColNames.includes('effort')            ? 'effort'            : 'NULL',
    priority:         priorityExpr,
    created_at:       'created_at',
    updated_at:       'updated_at',
    started_at:        oldColNames.includes('started_at')   ? 'started_at'   : 'NULL',
    completed_at:      oldColNames.includes('completed_at') ? 'completed_at' : 'NULL',
    validated_at:      oldColNames.includes('validated_at') ? 'validated_at' : 'NULL',
  }

  const insertCols = Object.keys(colMapping).join(', ')
  const insertVals = Object.values(colMapping).join(', ')

  db.run(`INSERT INTO tasks (${insertCols}) SELECT ${insertVals} FROM ${tempTable}`)

  // Drop backup table
  db.run(`DROP TABLE ${tempTable}`)
}
