import type { MigrationDb } from '../migration-db-adapter'
type Database = MigrationDb

/**
 * Migration: Add preferred_model column to agents table (T1354).
 *
 * Stores the preferred CLI model for a given agent (e.g. "anthropic/claude-opus-4-5").
 * Used by adapters that support a --model flag (OpenCode, Gemini, etc.).
 *
 * Nullable, no DEFAULT, no CHECK constraint — any string value is valid.
 *
 * Idempotent: returns false if the column already exists.
 *
 * @returns true if the column was added, false if already present.
 */
export function runAddPreferredModelToAgentsMigration(db: Database): boolean {
  const colResult = db.exec('PRAGMA table_info(agents)')
  if (colResult.length === 0 || colResult[0].values.length === 0) return false

  const cols = new Set(colResult[0].values.map((r: unknown[]) => r[1] as string))
  if (cols.has('preferred_model')) return false

  db.run('ALTER TABLE agents ADD COLUMN preferred_model TEXT')
  return true
}
