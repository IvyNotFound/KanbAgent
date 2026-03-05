import type { Database } from 'sql.js'

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
