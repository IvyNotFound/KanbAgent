import type { MigrationDb } from './migration-db-adapter'
import { runDropCommentaireColumnMigration, runRemoveThinkingModeBudgetTokensMigration, runAddTokensToSessionsMigration, runAddConvIdToSessionsMigration, runAddPriorityMigration } from './migrations/v1-columns'
import { runTaskStatutI18nMigration, runTaskStatusMigration, runSessionStatutI18nMigration } from './migrations/v2-statuts'
import { runMakeAgentAssigneNotNullMigration, runMakeCommentAgentNotNullMigration, runAddAgentGroupsMigration } from './migrations/v3-relations'
import { runAddParentIdToAgentGroupsMigration } from './migrations/v4-agent-groups-hierarchy'
import { runAddWorktreeToAgentsMigration } from './migrations/v5-agent-worktree'
import { runFixTasksSessionFkMigration } from './migrations/v6-tasks-session-fk'
import { runAddPreferredModelToAgentsMigration } from './migrations/v7-agent-preferred-model'

// ── Numbered migration system ────────────────────────────────────────────────

interface Migration {
  version: number
  up: (db: MigrationDb) => void
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

  // v20: add sessions.cost_usd, sessions.duration_ms, sessions.num_turns (T766)
  { version: 20, up: (db) => {
    const colResult = db.exec('PRAGMA table_info(sessions)')
    if (colResult.length === 0) return
    const cols = new Set(colResult[0].values.map((r: unknown[]) => r[1] as string))
    if (!cols.has('cost_usd')) db.run('ALTER TABLE sessions ADD COLUMN cost_usd REAL')
    if (!cols.has('duration_ms')) db.run('ALTER TABLE sessions ADD COLUMN duration_ms INTEGER')
    if (!cols.has('num_turns')) db.run('ALTER TABLE sessions ADD COLUMN num_turns INTEGER')
  } },

  // v21: add indexes on task_links(from_task) and task_links(to_task) (T789)
  { version: 21, up: (db) => {
    db.run('CREATE INDEX IF NOT EXISTS idx_task_links_from_task ON task_links(from_task)')
    db.run('CREATE INDEX IF NOT EXISTS idx_task_links_to_task ON task_links(to_task)')
  } },

  // v22: FTS4 virtual table + triggers for full-text search on tasks (T790)
  { version: 22, up: (db) => {
    db.run('CREATE VIRTUAL TABLE IF NOT EXISTS tasks_fts USING fts4(titre, description)')
    db.run(`CREATE TRIGGER IF NOT EXISTS tasks_fts_ai AFTER INSERT ON tasks BEGIN
      INSERT INTO tasks_fts(rowid, titre, description) VALUES (new.id, new.titre, new.description);
    END`)
    db.run(`CREATE TRIGGER IF NOT EXISTS tasks_fts_au AFTER UPDATE ON tasks BEGIN
      DELETE FROM tasks_fts WHERE rowid = old.id;
      INSERT INTO tasks_fts(rowid, titre, description) VALUES (new.id, new.titre, new.description);
    END`)
    db.run(`CREATE TRIGGER IF NOT EXISTS tasks_fts_ad AFTER DELETE ON tasks BEGIN
      DELETE FROM tasks_fts WHERE rowid = old.id;
    END`)
    db.run('INSERT INTO tasks_fts(rowid, titre, description) SELECT id, titre, description FROM tasks')
  } },

  // v23: replace "On startup: node scripts/dbstart.js" in all agents' system_prompt_suffix.
  // The launcher (build-agent-prompt IPC) now pre-creates the session and injects the startup
  // context block directly into the first user message — agents must NOT call dbstart.js.
  { version: 23, up: (db) => {
    db.run(`UPDATE agents
      SET system_prompt_suffix = REPLACE(
        system_prompt_suffix,
        '- On startup: node scripts/dbstart.js <agent-name> → read summary → identify YOUR task from initial prompt → start immediately on THAT task only',
        '- On startup: votre contexte (agent_id, session_id, tâches, locks) est pré-injecté dans le premier message user (bloc === IDENTIFIANTS ===). Ne pas appeler dbstart.js. Identifier votre tâche dans le prompt et démarrer immédiatement.'
      )
      WHERE system_prompt_suffix LIKE '%scripts/dbstart.js%'`)
  } },

  // v24: add parent_id to agent_groups for hierarchy support (T945)
  { version: 24, up: (db) => { runAddParentIdToAgentGroupsMigration(db) } },

  // v25: normalize all French column/table names to English (T1016)
  { version: 25, up: (db) => {
    const hasCol = (table: string, col: string): boolean => {
      const r = db.exec(`PRAGMA table_info(${table})`)
      return r.length > 0 && r[0].values.some((row: unknown[]) => row[1] === col)
    }
    const hasTable = (name: string): boolean => {
      const r = db.exec(`SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='${name}'`)
      return (r[0]?.values[0][0] as number) > 0
    }

    // agents.perimetre → scope
    if (hasCol('agents', 'perimetre')) db.run('ALTER TABLE agents RENAME COLUMN perimetre TO scope')

    // sessions.statut → status
    if (hasCol('sessions', 'statut')) db.run('ALTER TABLE sessions RENAME COLUMN statut TO status')

    // tasks: rename all French columns
    if (hasCol('tasks', 'titre'))             db.run('ALTER TABLE tasks RENAME COLUMN titre TO title')
    if (hasCol('tasks', 'statut'))            db.run('ALTER TABLE tasks RENAME COLUMN statut TO status')
    if (hasCol('tasks', 'agent_createur_id')) db.run('ALTER TABLE tasks RENAME COLUMN agent_createur_id TO agent_creator_id')
    if (hasCol('tasks', 'agent_assigne_id'))  db.run('ALTER TABLE tasks RENAME COLUMN agent_assigne_id TO agent_assigned_id')
    if (hasCol('tasks', 'agent_valideur_id')) db.run('ALTER TABLE tasks RENAME COLUMN agent_valideur_id TO agent_validator_id')
    if (hasCol('tasks', 'perimetre'))         db.run('ALTER TABLE tasks RENAME COLUMN perimetre TO scope')

    // task_comments.contenu → content
    if (hasCol('task_comments', 'contenu')) db.run('ALTER TABLE task_comments RENAME COLUMN contenu TO content')

    // task_links: recreate with English CHECK values (ALTER CONSTRAINT not supported in SQLite)
    const tlSchema = db.exec("SELECT sql FROM sqlite_master WHERE type='table' AND name='task_links'")
    if (tlSchema.length > 0 && tlSchema[0].values.length > 0) {
      const tlSql = tlSchema[0].values[0][0] as string
      if (tlSql.includes('bloque') || tlSql.includes('dépend_de')) {
        db.run(`CREATE TABLE task_links_new (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          from_task  INTEGER NOT NULL REFERENCES tasks(id),
          to_task    INTEGER NOT NULL REFERENCES tasks(id),
          type       TEXT NOT NULL CHECK(type IN ('blocks','depends_on','related_to','duplicates')),
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`)
        db.run(`INSERT INTO task_links_new (id, from_task, to_task, type, created_at)
          SELECT id, from_task, to_task,
            CASE type
              WHEN 'bloque'    THEN 'blocks'
              WHEN 'dépend_de' THEN 'depends_on'
              WHEN 'lié_à'     THEN 'related_to'
              WHEN 'duplique'  THEN 'duplicates'
              ELSE type
            END,
            created_at
          FROM task_links`)
        db.run('DROP TABLE task_links')
        db.run('ALTER TABLE task_links_new RENAME TO task_links')
        db.run('CREATE INDEX IF NOT EXISTS idx_task_links_from_task ON task_links(from_task)')
        db.run('CREATE INDEX IF NOT EXISTS idx_task_links_to_task ON task_links(to_task)')
      }
    }

    // locks.fichier → file
    if (hasCol('locks', 'fichier')) db.run('ALTER TABLE locks RENAME COLUMN fichier TO file')

    // agent_logs.niveau → level, agent_logs.fichiers → files
    if (hasCol('agent_logs', 'niveau'))   db.run('ALTER TABLE agent_logs RENAME COLUMN niveau TO level')
    if (hasCol('agent_logs', 'fichiers')) db.run('ALTER TABLE agent_logs RENAME COLUMN fichiers TO files')

    // perimetres columns + table rename → scopes
    if (hasTable('perimetres')) {
      if (hasCol('perimetres', 'dossier')) db.run('ALTER TABLE perimetres RENAME COLUMN dossier TO folder')
      if (hasCol('perimetres', 'actif'))   db.run('ALTER TABLE perimetres RENAME COLUMN actif TO active')
      if (!hasTable('scopes'))             db.run('ALTER TABLE perimetres RENAME TO scopes')
    }

    // Rebuild tasks_fts with new column name 'title' (was 'titre')
    db.run('DROP TRIGGER IF EXISTS tasks_fts_ai')
    db.run('DROP TRIGGER IF EXISTS tasks_fts_au')
    db.run('DROP TRIGGER IF EXISTS tasks_fts_ad')
    db.run('DROP TABLE IF EXISTS tasks_fts')
    db.run('CREATE VIRTUAL TABLE IF NOT EXISTS tasks_fts USING fts4(title, description)')
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
    db.run('INSERT INTO tasks_fts(rowid, title, description) SELECT id, title, description FROM tasks')

    // Patch stored agent prompts: replace French column/table refs with English equivalents
    // system_prompt_suffix (shared suffix + scoped agent suffixes)
    db.run("UPDATE agents SET system_prompt_suffix = REPLACE(system_prompt_suffix, 'agent_id, contenu,', 'agent_id, content,') WHERE system_prompt_suffix IS NOT NULL")
    db.run("UPDATE agents SET system_prompt_suffix = REPLACE(system_prompt_suffix, 'agent_id, contenu)', 'agent_id, content)') WHERE system_prompt_suffix IS NOT NULL")
    db.run("UPDATE agents SET system_prompt_suffix = REPLACE(system_prompt_suffix, 'SET statut=''', 'SET status=''') WHERE system_prompt_suffix IS NOT NULL")
    db.run("UPDATE agents SET system_prompt_suffix = REPLACE(system_prompt_suffix, '(fichier, agent_id', '(file, agent_id') WHERE system_prompt_suffix IS NOT NULL")
    db.run("UPDATE agents SET system_prompt_suffix = REPLACE(system_prompt_suffix, 'statut, effort, perimetre', 'status, effort, scope') WHERE system_prompt_suffix IS NOT NULL")
    db.run("UPDATE agents SET system_prompt_suffix = REPLACE(system_prompt_suffix, 'agent_createur_id, agent_assigne_id, agent_valideur_id', 'agent_creator_id, agent_assigned_id, agent_validator_id') WHERE system_prompt_suffix IS NOT NULL")
    // system_prompt (dev agent locks line, task-creator INSERT/field names)
    db.run("UPDATE agents SET system_prompt = REPLACE(system_prompt, '(fichier, agent_id, session_id)', '(file, agent_id, session_id)') WHERE system_prompt IS NOT NULL")
    db.run("UPDATE agents SET system_prompt = REPLACE(system_prompt, '(titre, description, statut, agent_createur_id, agent_assigne_id, perimetre', '(title, description, status, agent_creator_id, agent_assigned_id, scope') WHERE system_prompt IS NOT NULL")
    db.run("UPDATE agents SET system_prompt = REPLACE(system_prompt, '- titre :', '- title :') WHERE system_prompt IS NOT NULL")
    db.run("UPDATE agents SET system_prompt = REPLACE(system_prompt, '- titre:', '- title:') WHERE system_prompt IS NOT NULL")
    db.run("UPDATE agents SET system_prompt = REPLACE(system_prompt, '- agent_assigne_id :', '- agent_assigned_id :') WHERE system_prompt IS NOT NULL")
    db.run("UPDATE agents SET system_prompt = REPLACE(system_prompt, '- agent_assigne_id:', '- agent_assigned_id:') WHERE system_prompt IS NOT NULL")
  } },

  // v26: drop locks table — file-lock mechanism obsolete with git worktrees (T1046)
  { version: 26, up: (db) => {
    db.run('DROP INDEX IF EXISTS idx_locks_released_at')
    db.run('DROP TABLE IF EXISTS locks')
  } },

  // v27: add missing indexes on frequently-queried columns (T1113)
  { version: 27, up: (db) => {
    db.run('CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)')
    db.run('CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status)')
    db.run('CREATE INDEX IF NOT EXISTS idx_sessions_agent_status ON sessions(agent_id, status, started_at DESC)')
    db.run('CREATE INDEX IF NOT EXISTS idx_task_comments_agent_id ON task_comments(agent_id)')
  } },

  // v28: add agents.worktree_enabled + worktree_default config key (T1142)
  { version: 28, up: (db) => {
    runAddWorktreeToAgentsMigration(db)
    db.run("INSERT OR IGNORE INTO config (key, value) VALUES ('worktree_default', '1')")
  } },

  // v29: fix tasks.session_id FK broken reference (sessions_backup_i18n → sessions) (T1161)
  { version: 29, up: (db) => { runFixTasksSessionFkMigration(db) } },

  // v30: add agents.preferred_model for CLI model selection (T1354)
  { version: 30, up: (db) => { runAddPreferredModelToAgentsMigration(db) } },

  // v31: add sessions.cli_type for token telemetry on non-Claude CLIs (T1364)
  { version: 31, up: (db) => {
    const colResult = db.exec('PRAGMA table_info(sessions)')
    if (colResult.length === 0) return
    const cols = new Set(colResult[0].values.map((r: unknown[]) => r[1] as string))
    if (!cols.has('cli_type')) db.run('ALTER TABLE sessions ADD COLUMN cli_type TEXT')
  } },

  // v32: repair sessions columns missing on DBs bootstrapped before T1393 fixed the v20 guard (T1423)
  // DBs with user_version≥23 but created before v20 ran may lack cost_usd/duration_ms/num_turns.
  { version: 32, up: (db) => {
    const colResult = db.exec('PRAGMA table_info(sessions)')
    if (colResult.length === 0) return
    const cols = new Set(colResult[0].values.map((r: unknown[]) => r[1] as string))
    if (!cols.has('cost_usd'))    db.run('ALTER TABLE sessions ADD COLUMN cost_usd REAL')
    if (!cols.has('duration_ms')) db.run('ALTER TABLE sessions ADD COLUMN duration_ms INTEGER')
    if (!cols.has('num_turns'))   db.run('ALTER TABLE sessions ADD COLUMN num_turns INTEGER')
  } },
]

/** Current schema version — always equals the last migration's version number. */
export const CURRENT_SCHEMA_VERSION = migrations[migrations.length - 1].version

/**
 * Apply all pending migrations to a MigrationDb (better-sqlite3 adapter).
 *
 * Reads PRAGMA user_version to determine the current schema level.
 * Runs each pending migration (version > current) in a SAVEPOINT for atomicity.
 *
 * Bootstrap behaviour for legacy DBs (user_version=0 but config table present):
 * sets cursor to LEGACY_BOOTSTRAP_VERSION (23) so only migrations v24+ are
 * executed — does NOT return early, always falls through to the migration loop.
 *
 * @param db - MigrationDb adapter wrapping a better-sqlite3 Database.
 * @returns Number of migrations applied.
 * @throws If any migration's `up()` function throws; the SAVEPOINT is rolled back
 *         and the error is re-thrown, leaving the database unchanged for that version.
 */
export function migrateDb(db: MigrationDb): number {
  const uvResult = db.exec('PRAGMA user_version')
  const rawCurrent = uvResult.length > 0 && uvResult[0].values.length > 0
    ? (uvResult[0].values[0][0] as number)
    : 0

  // Bootstrap: legacy DBs (created before the numbered migration system) have
  // user_version=0 but a config table with schema_version. All migrations through
  // v23 are assumed applied by the old system — set cursor to 23 so only v24+
  // will run. Do NOT return early; fall through to the migration loop.
  //
  // Guard: only skip v1-v23 if agents already has the columns added by v18/v19.
  // External DBs (e.g. created by project init scripts) may have a config table
  // but lack permission_mode / max_sessions — fall through so all idempotent
  // migrations run and the missing columns are added.
  const LEGACY_BOOTSTRAP_VERSION = 23
  let current = rawCurrent
  if (rawCurrent === 0) {
    const configResult = db.exec("SELECT value FROM config WHERE key = 'schema_version'")
    if (configResult.length > 0 && configResult[0].values.length > 0) {
      const colResult = db.exec('PRAGMA table_info(agents)')
      const agentCols = new Set(
        colResult.length > 0 ? colResult[0].values.map((r: unknown[]) => r[1] as string) : []
      )
      // Also verify sessions.cost_usd (added by v20) to avoid skipping it on DBs
      // that had permission_mode/max_sessions but were created before v20.
      const sessResult = db.exec('PRAGMA table_info(sessions)')
      const sessCols = new Set(
        sessResult.length > 0 ? sessResult[0].values.map((r: unknown[]) => r[1] as string) : []
      )
      if (agentCols.has('permission_mode') && agentCols.has('max_sessions') && sessCols.has('cost_usd')) {
        db.run(`PRAGMA user_version = ${LEGACY_BOOTSTRAP_VERSION}`)
        current = LEGACY_BOOTSTRAP_VERSION
      }
      // else: current stays 0, all migrations v1+ will run (all idempotent)
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
