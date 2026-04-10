import type { MigrationDb } from '../migration-db-adapter'
type Database = MigrationDb
import { isArchiveAllowedInCheck, recreateTasksTableWithArchive } from './schema-init'

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

  // English-schema DBs use 'status' not 'statut' — no French values possible
  const colResult = db.exec('PRAGMA table_info(tasks)')
  const colNames = colResult.length > 0 ? colResult[0].values.map((r: unknown[]) => r[1] as string) : []
  if (!colNames.includes('statut')) return 0

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
  // English-schema DBs use 'status' not 'statut' — no French values possible
  const colResult = db.exec('PRAGMA table_info(tasks)')
  const colNames = colResult.length > 0 ? colResult[0].values.map((r: unknown[]) => r[1] as string) : []
  if (!colNames.includes('statut')) return 0

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

  // English-schema DBs use 'status' not 'statut' — no French values possible
  const sesColResult = db.exec('PRAGMA table_info(sessions)')
  const sesColNames = sesColResult.length > 0 ? sesColResult[0].values.map((r: unknown[]) => r[1] as string) : []
  if (!sesColNames.includes('statut')) return 0

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
