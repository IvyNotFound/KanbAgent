import type { Database } from 'sql.js'
import { runDropCommentaireColumnMigration, runRemoveThinkingModeBudgetTokensMigration, runAddTokensToSessionsMigration, runAddConvIdToSessionsMigration, runAddPriorityMigration } from './migrations/v1-columns'
import { runTaskStatutI18nMigration, runTaskStatusMigration, runSessionStatutI18nMigration } from './migrations/v2-statuts'
import { runMakeAgentAssigneNotNullMigration, runMakeCommentAgentNotNullMigration, runAddAgentGroupsMigration } from './migrations/v3-relations'

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
