import type { Database } from 'sql.js'

// ── Internal helpers ────────────────────────────────────────────────────────────

/**
 * Returns true if the tasks table CHECK constraint already includes a modern
 * archive value ('archivé' French or 'archived' / 'done' English).
 * When false, the table needs to be recreated before any status migration can run.
 */
function isArchiveAllowedInCheck(db: Database): boolean {
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
function recreateTasksTableWithArchive(db: Database): void {
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

// ── Exported migrations ─────────────────────────────────────────────────────────

/**
 * Migration: Drops the legacy `commentaire` column from the tasks table.
 *
 * Background: task comments were moved to the `task_comments` table (more flexible,
 * author-tracked). The old inline `commentaire` TEXT column is redundant and must
 * be removed to avoid silent data loss when the tasks table is recreated by other
 * migrations (runTaskStatutI18nMigration, recreateTasksTableWithArchive).
 *
 * Strategy:
 *   1. Migrate any non-null commentaire values to task_comments (agent_id = NULL,
 *      timestamp = task's updated_at or created_at).
 *   2. Drop the column via ALTER TABLE DROP COLUMN (SQLite >= 3.35, bundled version
 *      is 3.49.x so this is safe).
 *
 * Idempotent: returns false immediately if the `commentaire` column does not exist.
 *
 * @returns number of rows migrated to task_comments (0 if column already absent).
 */
export function runDropCommentaireColumnMigration(db: Database): number {
  // Idempotency check: is commentaire still a column on tasks?
  const colResult = db.exec('PRAGMA table_info(tasks)')
  if (colResult.length === 0) return 0

  const cols = colResult[0].values.map((r: unknown[]) => r[1] as string)
  if (!cols.includes('commentaire')) return 0

  // Step 1: migrate non-empty commentaire values to task_comments
  db.run(`
    INSERT INTO task_comments (task_id, agent_id, contenu, created_at)
    SELECT id, NULL, commentaire, COALESCE(updated_at, created_at)
    FROM tasks
    WHERE commentaire IS NOT NULL AND TRIM(commentaire) != ''
  `)
  const migrated = db.getRowsModified()

  // Step 2: drop the column (SQLite 3.35+)
  db.run('ALTER TABLE tasks DROP COLUMN commentaire')

  return migrated
}

/**
 * Migration: Removes 'budget_tokens' from the agents.thinking_mode CHECK constraint.
 *
 * SQLite does not support ALTER COLUMN. Uses the CREATE new + INSERT SELECT + DROP old
 * + RENAME pattern to safely recreate the agents table with the updated constraint:
 *   CHECK(thinking_mode IN ('auto', 'disabled'))
 *
 * Any existing rows with thinking_mode = 'budget_tokens' are converted to NULL (falls
 * back to 'auto' behavior at runtime).
 *
 * Idempotent: returns false immediately if 'budget_tokens' is not found in the agents
 * table schema (already migrated or freshly created with the correct constraint).
 *
 * @returns true if the migration was applied, false if already up-to-date.
 */
export function runRemoveThinkingModeBudgetTokensMigration(db: Database): boolean {
  const result = db.exec("SELECT sql FROM sqlite_master WHERE type='table' AND name='agents'")
  if (result.length === 0 || result[0].values.length === 0) return false

  const tableSchema = result[0].values[0][0] as string
  if (!tableSchema.includes('budget_tokens')) return false

  // Inspect existing columns for safe INSERT SELECT mapping
  const colResult = db.exec('PRAGMA table_info(agents)')
  const existingCols: string[] =
    colResult.length > 0
      ? colResult[0].values.map((r: unknown[]) => r[1] as string)
      : []

  const tempTable = 'agents_backup_thinking'

  // Wrap the table recreation in a SAVEPOINT for atomicity.
  // If any step fails, ROLLBACK restores the in-memory DB to its original state.
  db.run('SAVEPOINT remove_budget_tokens')
  try {
    db.run(`ALTER TABLE agents RENAME TO ${tempTable}`)

    // Create new agents table without 'budget_tokens' in the CHECK constraint
    db.run(`
      CREATE TABLE agents (
        id                   INTEGER PRIMARY KEY AUTOINCREMENT,
        name                 TEXT NOT NULL UNIQUE,
        type                 TEXT NOT NULL,
        perimetre            TEXT,
        system_prompt        TEXT,
        system_prompt_suffix TEXT,
        thinking_mode        TEXT CHECK(thinking_mode IN ('auto', 'disabled')),
        allowed_tools        TEXT,
        created_at           DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `)

    // All new-table columns: copy existing ones, skip any that did not exist in old table
    const allNewCols = ['id', 'name', 'type', 'perimetre', 'system_prompt', 'system_prompt_suffix', 'thinking_mode', 'allowed_tools', 'created_at']
    const colsToMigrate = allNewCols.filter(c => existingCols.includes(c))

    // Convert 'budget_tokens' → NULL; keep other values as-is
    const selectExprs = colsToMigrate.map(c =>
      c === 'thinking_mode'
        ? `CASE thinking_mode WHEN 'budget_tokens' THEN NULL ELSE thinking_mode END`
        : c
    )

    db.run(`INSERT INTO agents (${colsToMigrate.join(', ')}) SELECT ${selectExprs.join(', ')} FROM ${tempTable}`)
    db.run(`DROP TABLE ${tempTable}`)

    db.run('RELEASE SAVEPOINT remove_budget_tokens')
  } catch (err) {
    db.run('ROLLBACK TO SAVEPOINT remove_budget_tokens')
    db.run('RELEASE SAVEPOINT remove_budget_tokens')
    throw err
  }

  return true
}

/**
 * Migration: Adds the `claude_conv_id` column to the sessions table (task #218).
 *
 * Stores the Claude Code CLI conversation/session UUID so the app can resume
 * conversations with `--resume <conv_id>` instead of re-injecting all context.
 *
 * Idempotent: checks PRAGMA table_info before running ALTER TABLE.
 *
 * @returns true if the column was added, false if it already existed.
 */
export function runAddConvIdToSessionsMigration(db: Database): boolean {
  const colResult = db.exec('PRAGMA table_info(sessions)')
  if (colResult.length === 0) return false

  const cols = colResult[0].values.map((r: unknown[]) => r[1] as string)
  if (cols.includes('claude_conv_id')) return false

  db.run('ALTER TABLE sessions ADD COLUMN claude_conv_id TEXT')
  return true
}

/**
 * Migration: Adds the `priority` column to the tasks table (task #205).
 *
 * Idempotent: checks PRAGMA table_info before running ALTER TABLE.
 *
 * @returns true if the column was added, false if it already existed.
 */
export function runAddPriorityMigration(db: Database): boolean {
  const colResult = db.exec('PRAGMA table_info(tasks)')
  if (colResult.length === 0) return false

  const cols = colResult[0].values.map((r: unknown[]) => r[1] as string)
  if (cols.includes('priority')) return false

  db.run(
    "ALTER TABLE tasks ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal'" +
    " CHECK(priority IN ('low','normal','high','critical'))"
  )
  return true
}

/**
 * Migration: Converts all French task statut values to English (task #206).
 *
 * Mapping:
 *   a_faire  → todo
 *   en_cours → in_progress
 *   terminé  → done
 *   validé   → archived   (legacy)
 *   archivé  → archived
 *
 * If the CHECK constraint is still French, the table is recreated with the
 * modern English constraint in one atomic operation (no data loss).
 *
 * Idempotent: returns 0 immediately if schema is already English and no
 * French values remain.
 *
 * @returns number of tasks whose statut was converted.
 */
export function runTaskStatutI18nMigration(db: Database): number {
  // Check current schema
  const schemaResult = db.exec(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='tasks'"
  )
  if (schemaResult.length === 0 || schemaResult[0].values.length === 0) return 0

  const tableSchema = schemaResult[0].values[0][0] as string
  const isAlreadyEnglish = tableSchema.includes("'todo'")

  // Count remaining French values
  const countResult = db.exec(
    "SELECT COUNT(*) FROM tasks WHERE statut IN ('a_faire','en_cours','terminé','archivé','validé')"
  )
  const frenchCount =
    countResult.length > 0 ? (countResult[0].values[0][0] as number) : 0

  // Nothing to do if schema is modern and data is already English
  if (isAlreadyEnglish && frenchCount === 0) return 0

  // Recreate the table with English CHECK constraint and convert data
  const tempTable = 'tasks_backup_i18n'
  db.run(`ALTER TABLE tasks RENAME TO ${tempTable}`)

  // Inspect old columns for safe mapping
  const oldCols = db.exec(`PRAGMA table_info(${tempTable})`)
  const oldColNames: string[] =
    oldCols.length > 0
      ? (oldCols[0].values.map((r: unknown[]) => r[1] as string))
      : []

  // Create new table with English statut CHECK + priority
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

  // Convert French → English in the CASE expression
  const statutExpr = `CASE COALESCE(statut, 'a_faire')
      WHEN 'a_faire'  THEN 'todo'
      WHEN 'en_cours' THEN 'in_progress'
      WHEN 'terminé'  THEN 'done'
      WHEN 'validé'   THEN 'archived'
      WHEN 'archivé'  THEN 'archived'
      WHEN 'todo'         THEN 'todo'
      WHEN 'in_progress'  THEN 'in_progress'
      WHEN 'done'         THEN 'done'
      WHEN 'archived'     THEN 'archived'
      ELSE 'todo'
    END`

  const priorityExpr = oldColNames.includes('priority') ? 'priority' : "'normal'"

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
  db.run(`DROP TABLE ${tempTable}`)

  return frenchCount
}

/**
 * Migration: Converts legacy French task statuts to the archivé state (pre-v0.4.0).
 *
 * Handles two legacy cases:
 *   - 'terminé' → 'archivé'  (old workflow where terminé was the final state)
 *   - 'validé'  → 'archivé'  (old projects that used validé instead of archivé)
 *
 * NOTE: As of v0.4.0, this migration is typically a no-op because
 * runTaskStatutI18nMigration (run first in migrateDb) already converts all
 * French values to English equivalents. This function is kept for backward
 * compatibility when called in isolation.
 *
 * @returns number of tasks migrated (0 if none found).
 */
export function runTaskStatusMigration(db: Database): number {
  // First, ensure the CHECK constraint allows 'archivé' or modern English values
  if (!isArchiveAllowedInCheck(db)) {
    console.warn('[migration] Old CHECK constraint detected. Recreating tasks table...')
    recreateTasksTableWithArchive(db)
    console.log('[migration] tasks table recreated with modern CHECK constraint.')
  }

  let totalMigrated = 0

  // Migration 1: terminé → archivé (old final-state DBs)
  const countTerminé = db.exec("SELECT COUNT(*) as count FROM tasks WHERE statut = 'terminé'")
  if (countTerminé.length > 0 && (countTerminé[0].values[0][0] as number) > 0) {
    db.run("UPDATE tasks SET statut = 'archivé', updated_at = CURRENT_TIMESTAMP WHERE statut = 'terminé'")
    totalMigrated += db.getRowsModified()
  }

  // Migration 2: validé → archivé (old projects using validé)
  const countValidé = db.exec("SELECT COUNT(*) as count FROM tasks WHERE statut = 'validé'")
  if (countValidé.length > 0 && (countValidé[0].values[0][0] as number) > 0) {
    db.run("UPDATE tasks SET statut = 'archivé', updated_at = CURRENT_TIMESTAMP WHERE statut = 'validé'")
    totalMigrated += db.getRowsModified()
  }

  // Note: no INSERT into agent_logs — session_id and agent_id are NOT NULL
  // and no valid session context exists during DB migration.

  return totalMigrated
}
