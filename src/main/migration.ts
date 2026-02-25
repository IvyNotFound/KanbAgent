import type { Database } from 'sql.js'

/**
 * Migration: Convertit les tâches "terminé" en "archivé"
 * car dans le workflow actuel, "terminé" est un état intermédiaire
 * et "archivé" est l'état final (après validation par review).
 *
 * Migration additionnelle: Convertit les tâches "validé" en "archivé"
 * pour les anciens projets qui utilisaient "validé" au lieu de "archivé".
 */
export function runTaskStatusMigration(db: Database): number {
  let totalMigrated = 0

  // Migration 1: terminé → archivé
  const countTerminé = db.exec("SELECT COUNT(*) as count FROM tasks WHERE statut = 'terminé'")
  if (countTerminé.length > 0 && countTerminé[0].values[0][0] > 0) {
    db.run("UPDATE tasks SET statut = 'archivé', updated_at = CURRENT_TIMESTAMP WHERE statut = 'terminé'")
    totalMigrated += db.getRowsModified()
  }

  // Migration 2: validé → archivé (anciens projets)
  const countValidé = db.exec("SELECT COUNT(*) as count FROM tasks WHERE statut = 'validé'")
  if (countValidé.length > 0 && countValidé[0].values[0][0] > 0) {
    db.run("UPDATE tasks SET statut = 'archivé', updated_at = CURRENT_TIMESTAMP WHERE statut = 'validé'")
    totalMigrated += db.getRowsModified()
  }

  if (totalMigrated === 0) {
    return 0
  }

  // Logger la migration dans agent_logs si la table existe
  const tableResult = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='agent_logs'")
  if (tableResult.length > 0) {
    db.run(
      "INSERT INTO agent_logs (session_id, agent_id, niveau, action, detail, created_at) VALUES (NULL, NULL, 'info', 'Migration', ?, CURRENT_TIMESTAMP)",
      [`Auto-migration: ${totalMigrated} tâche(s) migrée(s) vers 'archivé'`]
    )
  }

  return totalMigrated
}
