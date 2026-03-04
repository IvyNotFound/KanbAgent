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
 * Migration: Adds token tracking columns to the sessions table (task #314).
 *
 * Columns added:
 *   - tokens_in         INTEGER DEFAULT 0   (input tokens consumed)
 *   - tokens_out        INTEGER DEFAULT 0   (output tokens generated)
 *   - tokens_cache_read INTEGER DEFAULT 0   (cache read tokens)
 *   - tokens_cache_write INTEGER DEFAULT 0  (cache write tokens)
 *
 * Idempotent: checks PRAGMA table_info before running each ALTER TABLE.
 *
 * @returns number of columns actually added (0–4).
 */
export function runAddTokensToSessionsMigration(db: Database): number {
  const colResult = db.exec('PRAGMA table_info(sessions)')
  if (colResult.length === 0) return 0

  const cols = new Set(colResult[0].values.map((r: unknown[]) => r[1] as string))

  const toAdd: Array<[string, string]> = [
    ['tokens_in', 'ALTER TABLE sessions ADD COLUMN tokens_in INTEGER DEFAULT 0'],
    ['tokens_out', 'ALTER TABLE sessions ADD COLUMN tokens_out INTEGER DEFAULT 0'],
    ['tokens_cache_read', 'ALTER TABLE sessions ADD COLUMN tokens_cache_read INTEGER DEFAULT 0'],
    ['tokens_cache_write', 'ALTER TABLE sessions ADD COLUMN tokens_cache_write INTEGER DEFAULT 0'],
  ]

  const missing = toAdd.filter(([name]) => !cols.has(name))
  if (missing.length === 0) return 0

  // T327: Use SAVEPOINT for atomicity — if any ALTER fails, all are rolled back
  db.run('SAVEPOINT add_token_cols')
  try {
    for (const [, sql] of missing) {
      db.run(sql)
    }
    db.run('RELEASE SAVEPOINT add_token_cols')
  } catch (err) {
    db.run('ROLLBACK TO SAVEPOINT add_token_cols')
    db.run('RELEASE SAVEPOINT add_token_cols')
    throw err
  }
  return missing.length
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

/**
 * Migration: Converts French session statut values to English (T329).
 *
 * Mapping:
 *   en_cours → started
 *   terminé  → completed
 *   bloqué   → blocked
 *
 * Recreates the sessions table with English CHECK constraint if needed,
 * then converts any remaining French data values.
 *
 * Idempotent: returns 0 if schema is already English and no French values remain.
 *
 * @returns number of sessions whose statut was converted.
 */
export function runSessionStatutI18nMigration(db: Database): number {
  const schemaResult = db.exec(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='sessions'"
  )
  if (schemaResult.length === 0 || schemaResult[0].values.length === 0) return 0

  const tableSchema = schemaResult[0].values[0][0] as string
  const isAlreadyEnglish = tableSchema.includes("'started'")

  // Count remaining French values
  const countResult = db.exec(
    "SELECT COUNT(*) FROM sessions WHERE statut IN ('en_cours','terminé','bloqué')"
  )
  const frenchCount = countResult.length > 0 ? (countResult[0].values[0][0] as number) : 0

  if (isAlreadyEnglish && frenchCount === 0) return 0

  // If CHECK constraint is still French, recreate the table
  if (!isAlreadyEnglish) {
    // Get existing columns
    const colResult = db.exec('PRAGMA table_info(sessions)')
    if (colResult.length === 0) return 0
    const existingCols = colResult[0].values.map((r: unknown[]) => r[1] as string)

    const tempTable = 'sessions_backup_i18n'

    db.run('SAVEPOINT session_i18n')
    try {
      db.run(`ALTER TABLE sessions RENAME TO ${tempTable}`)

      // Recreate with English CHECK constraint
      db.run(`
        CREATE TABLE sessions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          agent_id INTEGER NOT NULL REFERENCES agents(id),
          started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          ended_at DATETIME,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          statut TEXT NOT NULL DEFAULT 'started' CHECK(statut IN ('started','completed','blocked')),
          summary TEXT,
          claude_conv_id TEXT,
          tokens_in INTEGER DEFAULT 0,
          tokens_out INTEGER DEFAULT 0,
          tokens_cache_read INTEGER DEFAULT 0,
          tokens_cache_write INTEGER DEFAULT 0
        )
      `)

      // All new-table columns: copy existing ones
      const allNewCols = ['id', 'agent_id', 'started_at', 'ended_at', 'updated_at', 'statut',
        'summary', 'claude_conv_id', 'tokens_in', 'tokens_out', 'tokens_cache_read', 'tokens_cache_write']
      const colsToMigrate = allNewCols.filter(c => existingCols.includes(c))

      const selectExprs = colsToMigrate.map(c =>
        c === 'statut'
          ? `CASE statut
               WHEN 'en_cours' THEN 'started'
               WHEN 'terminé'  THEN 'completed'
               WHEN 'bloqué'   THEN 'blocked'
               ELSE statut
             END`
          : c
      )

      db.run(`INSERT INTO sessions (${colsToMigrate.join(', ')}) SELECT ${selectExprs.join(', ')} FROM ${tempTable}`)
      db.run(`DROP TABLE ${tempTable}`)

      db.run('RELEASE SAVEPOINT session_i18n')

      // All rows were migrated during table recreation
      return frenchCount
    } catch (err) {
      db.run('ROLLBACK TO SAVEPOINT session_i18n')
      db.run('RELEASE SAVEPOINT session_i18n')
      throw err
    }
  }

  // Schema is already English — just convert remaining French values
  db.run(`UPDATE sessions SET statut = CASE statut
    WHEN 'en_cours' THEN 'started'
    WHEN 'terminé'  THEN 'completed'
    WHEN 'bloqué'   THEN 'blocked'
    ELSE statut
  END WHERE statut IN ('en_cours','terminé','bloqué')`)

  return db.getRowsModified()
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

// ── Numbered migration system ────────────────────────────────────────────────

interface Migration {
  version: number
  up: (db: Database) => void
}

const migrations: Migration[] = [
  // v1: drop legacy commentaire column from tasks
  { version: 1, up: (db) => { runDropCommentaireColumnMigration(db) } },

  // v2: add base agent columns
  { version: 2, up: (db) => {
    const colResult = db.exec('PRAGMA table_info(agents)')
    if (colResult.length === 0) return
    const cols = new Set(colResult[0].values.map((r: unknown[]) => r[1] as string))
    if (!cols.has('system_prompt')) db.run('ALTER TABLE agents ADD COLUMN system_prompt TEXT')
    if (!cols.has('system_prompt_suffix')) db.run('ALTER TABLE agents ADD COLUMN system_prompt_suffix TEXT')
    if (!cols.has('thinking_mode')) db.run("ALTER TABLE agents ADD COLUMN thinking_mode TEXT CHECK(thinking_mode IN ('auto', 'disabled'))")
    if (!cols.has('allowed_tools')) db.run('ALTER TABLE agents ADD COLUMN allowed_tools TEXT')
  } },

  // v3: create config table
  { version: 3, up: (db) => {
    const r = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='config'")
    if (r.length > 0 && r[0].values.length > 0) return
    db.run(`CREATE TABLE config (
      key        TEXT NOT NULL PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`)
    db.run(`INSERT INTO config (key, value) VALUES ('claude_md_commit', ''), ('schema_version', '2')`)
  } },

  // v4: create perimetres table
  { version: 4, up: (db) => {
    const r = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='perimetres'")
    if (r.length > 0 && r[0].values.length > 0) return
    db.run(`CREATE TABLE perimetres (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL UNIQUE,
      dossier     TEXT,
      techno      TEXT,
      description TEXT,
      actif       INTEGER NOT NULL DEFAULT 1,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    )`)
    db.run(`INSERT INTO perimetres (name, dossier, techno, description) VALUES
      ('front-vuejs',   'renderer/', 'Vue 3 + TypeScript + Tailwind CSS', 'Interface utilisateur Electron'),
      ('back-electron', 'main/',     'Electron + Node.js + SQLite',       'Process principal, IPC, accès DB'),
      ('global',        '',          '—',                                  'Transversal, aucun périmètre spécifique')`)
  } },

  // v5: create base indexes
  { version: 5, up: (db) => {
    db.run('CREATE INDEX IF NOT EXISTS idx_sessions_agent_id ON sessions(agent_id)')
    db.run('CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON sessions(started_at DESC)')
    db.run('CREATE INDEX IF NOT EXISTS idx_agent_logs_agent_id ON agent_logs(agent_id)')
    db.run('CREATE INDEX IF NOT EXISTS idx_agent_logs_created_at ON agent_logs(created_at DESC)')
    db.run('CREATE INDEX IF NOT EXISTS idx_locks_released_at ON locks(released_at)')
    db.run('CREATE INDEX IF NOT EXISTS idx_tasks_updated_at ON tasks(updated_at DESC)')
    db.run('CREATE INDEX IF NOT EXISTS idx_tasks_agent_assigne ON tasks(agent_assigne_id)')
    db.run('CREATE INDEX IF NOT EXISTS idx_sessions_agent_started ON sessions(agent_id, started_at DESC)')
    db.run('CREATE INDEX IF NOT EXISTS idx_task_comments_task_id ON task_comments(task_id)')
  } },

  // v6: create task_agents table (T414)
  { version: 6, up: (db) => {
    const r = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='task_agents'")
    if (r.length > 0 && r[0].values.length > 0) return
    db.run(`CREATE TABLE IF NOT EXISTS task_agents (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id     INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      agent_id    INTEGER NOT NULL REFERENCES agents(id),
      role        TEXT CHECK(role IN ('primary', 'support', 'reviewer')),
      assigned_at TEXT DEFAULT (datetime('now')),
      UNIQUE(task_id, agent_id)
    )`)
    db.run('CREATE INDEX IF NOT EXISTS idx_task_agents_task_id ON task_agents(task_id)')
    db.run('CREATE INDEX IF NOT EXISTS idx_task_agents_agent_id ON task_agents(agent_id)')
  } },

  // v7: add sessions.claude_conv_id (T218)
  { version: 7, up: (db) => { runAddConvIdToSessionsMigration(db) } },

  // v8: add sessions token columns (T314)
  { version: 8, up: (db) => { runAddTokensToSessionsMigration(db) } },

  // v9: add tasks.priority (T205)
  { version: 9, up: (db) => { runAddPriorityMigration(db) } },

  // v10: task statut i18n French→English (T206)
  { version: 10, up: (db) => { runTaskStatutI18nMigration(db) } },

  // v11: remove budget_tokens from agents.thinking_mode CHECK
  { version: 11, up: (db) => { runRemoveThinkingModeBudgetTokensMigration(db) } },

  // v12: legacy task status migration (pre-v0.4.0 French values)
  { version: 12, up: (db) => { runTaskStatusMigration(db) } },

  // v13: tasks agent_assigne_id / agent_createur_id NOT NULL (T342)
  { version: 13, up: (db) => { runMakeAgentAssigneNotNullMigration(db) } },

  // v14: task_comments.agent_id NOT NULL (T342)
  { version: 14, up: (db) => { runMakeCommentAgentNotNullMigration(db) } },

  // v15: create agent_groups + agent_group_members tables (T556)
  { version: 15, up: (db) => { runAddAgentGroupsMigration(db) } },

  // v16: session statut i18n French→English (T329)
  { version: 16, up: (db) => { runSessionStatutI18nMigration(db) } },

  // v17: add agents.auto_launch column
  { version: 17, up: (db) => {
    const colResult = db.exec('PRAGMA table_info(agents)')
    if (colResult.length === 0) return
    const cols = new Set(colResult[0].values.map((r: unknown[]) => r[1] as string))
    if (!cols.has('auto_launch')) db.run('ALTER TABLE agents ADD COLUMN auto_launch INTEGER NOT NULL DEFAULT 1')
  } },

  // v18: add agents.permission_mode column
  { version: 18, up: (db) => {
    const colResult = db.exec('PRAGMA table_info(agents)')
    if (colResult.length === 0) return
    const cols = new Set(colResult[0].values.map((r: unknown[]) => r[1] as string))
    if (!cols.has('permission_mode')) db.run("ALTER TABLE agents ADD COLUMN permission_mode TEXT CHECK(permission_mode IN ('default', 'auto')) DEFAULT 'default'")
  } },

  // v19: add agents.max_sessions column
  { version: 19, up: (db) => {
    const colResult = db.exec('PRAGMA table_info(agents)')
    if (colResult.length === 0) return
    const cols = new Set(colResult[0].values.map((r: unknown[]) => r[1] as string))
    if (!cols.has('max_sessions')) db.run('ALTER TABLE agents ADD COLUMN max_sessions INTEGER NOT NULL DEFAULT 3')
  } },
]

/** Current schema version — always equals the last migration's version number. */
export const CURRENT_SCHEMA_VERSION = migrations[migrations.length - 1].version

/**
 * Apply all pending migrations to an in-memory sql.js Database.
 *
 * Reads PRAGMA user_version to determine current schema level.
 * Runs each migration with version > current in a SAVEPOINT for atomicity.
 * Bootstrap: if user_version=0 but the config table already exists (old
 * config-based system), bumps user_version to CURRENT and returns 0 — all
 * migrations were already applied by the previous system.
 *
 * @returns Number of migrations applied.
 */
export function migrateDb(db: Database): number {
  const uvResult = db.exec('PRAGMA user_version')
  const current = uvResult.length > 0 && uvResult[0].values.length > 0
    ? (uvResult[0].values[0][0] as number)
    : 0

  // Bootstrap: existing DB initialized by the old config-based system
  if (current === 0) {
    const configResult = db.exec("SELECT value FROM config WHERE key = 'schema_version'")
    if (configResult.length > 0 && configResult[0].values.length > 0) {
      db.run(`PRAGMA user_version = ${CURRENT_SCHEMA_VERSION}`)
      return 0
    }
  }

  const pending = migrations.filter(m => m.version > current)
  for (const migration of pending) {
    db.run(`SAVEPOINT m${migration.version}`)
    try {
      migration.up(db)
      db.run(`PRAGMA user_version = ${migration.version}`)
      db.run(`RELEASE SAVEPOINT m${migration.version}`)
    } catch (e) {
      db.run(`ROLLBACK TO SAVEPOINT m${migration.version}`)
      db.run(`RELEASE SAVEPOINT m${migration.version}`)
      throw e
    }
  }
  return pending.length
}
