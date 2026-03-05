// Barrel — re-exports all public migration symbols for backward compatibility.
// Consumers (db.ts, migration.spec.ts) continue to import from './migration'.

export { CURRENT_SCHEMA_VERSION, migrateDb } from './migration-runner'

export {
  runDropCommentaireColumnMigration,
  runRemoveThinkingModeBudgetTokensMigration,
  runAddTokensToSessionsMigration,
  runAddConvIdToSessionsMigration,
  runAddPriorityMigration,
} from './migrations/v1-columns'

export {
  runTaskStatutI18nMigration,
  runTaskStatusMigration,
  runSessionStatutI18nMigration,
} from './migrations/v2-statuts'

export {
  runMakeAgentAssigneNotNullMigration,
  runMakeCommentAgentNotNullMigration,
  runAddAgentGroupsMigration,
} from './migrations/v3-relations'
