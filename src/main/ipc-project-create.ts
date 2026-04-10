/**
 * IPC Handler — create-project-db logic.
 *
 * Creates a new project.db with full schema, default agents, and copies
 * agent scripts to the project directory.
 *
 * Extracted from ipc-project.ts (T1902) to keep file size under 400 lines.
 *
 * @module ipc-project-create
 */

import { app } from 'electron'
import { copyFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { GENERIC_AGENTS_BY_LANG } from './default-agents'
import type { AgentLanguage } from './default-agents'
import Database from 'better-sqlite3'
import { registerDbPath } from './db'
import { startDbDaemon } from './db-daemon'
import { CURRENT_SCHEMA_VERSION } from './migration'

/** Agent scripts to copy into project's scripts/ directory. */
export const AGENT_SCRIPTS = [
  'dbq.js',
  'dbw.js',
  'dbstart.js',
  'dblock.js',
  'capture-tokens-hook.js',
]

/**
 * Create a new project.db with full schema and default agents.
 *
 * @param projectPath - Absolute path to the project root (already validated)
 * @param agentLang - Validated agent prompt language
 * @returns Result object with success status, dbPath, and optional scripts info
 */
export async function createProjectDb(
  projectPath: string,
  agentLang: AgentLanguage
): Promise<{ success: boolean; dbPath: string; scriptsCopied?: number; scriptsError?: string; error?: string }> {
  try {
    const claudeDir = join(projectPath, '.claude')
    await mkdir(claudeDir, { recursive: true })
    const dbPath = join(claudeDir, 'project.db')
    const db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
    db.pragma('busy_timeout = 5000')
    db.pragma('foreign_keys = ON')
    db.exec(`
      CREATE TABLE IF NOT EXISTS agents (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL, scope TEXT, system_prompt TEXT,
        system_prompt_suffix TEXT,
        thinking_mode TEXT CHECK(thinking_mode IN ('auto', 'disabled')),
        allowed_tools TEXT,
        auto_launch INTEGER NOT NULL DEFAULT 1,
        permission_mode TEXT CHECK(permission_mode IN ('default', 'auto')) DEFAULT 'default',
        max_sessions INTEGER NOT NULL DEFAULT 3,
        worktree_enabled INTEGER,
        preferred_model TEXT,
        preferred_cli TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id INTEGER NOT NULL REFERENCES agents(id),
        started_at DATETIME DEFAULT CURRENT_TIMESTAMP, ended_at DATETIME,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        status TEXT NOT NULL DEFAULT 'started' CHECK(status IN ('started','completed','blocked')),
        summary TEXT,
        claude_conv_id TEXT,
        tokens_in INTEGER DEFAULT 0,
        tokens_out INTEGER DEFAULT 0,
        tokens_cache_read INTEGER DEFAULT 0,
        tokens_cache_write INTEGER DEFAULT 0,
        cost_usd REAL,
        duration_ms INTEGER,
        num_turns INTEGER,
        cli_type TEXT
      );
      CREATE TABLE IF NOT EXISTS agent_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL REFERENCES sessions(id),
        agent_id INTEGER NOT NULL REFERENCES agents(id),
        level TEXT NOT NULL DEFAULT 'info' CHECK(level IN ('info','warn','error','debug')),
        action TEXT NOT NULL, detail TEXT, files TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'todo'
          CHECK(status IN ('todo','in_progress','done','archived','rejected')),
        agent_creator_id INTEGER REFERENCES agents(id),
        agent_assigned_id INTEGER REFERENCES agents(id),
        agent_validator_id INTEGER REFERENCES agents(id),
        parent_task_id INTEGER REFERENCES tasks(id),
        session_id INTEGER REFERENCES sessions(id),
        scope TEXT, effort INTEGER CHECK(effort IN (1,2,3)),
        priority TEXT NOT NULL DEFAULT 'normal'
          CHECK(priority IN ('low','normal','high','critical')),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        started_at DATETIME, completed_at DATETIME, validated_at DATETIME
      );
      CREATE TABLE IF NOT EXISTS task_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_task INTEGER NOT NULL REFERENCES tasks(id),
        to_task INTEGER NOT NULL REFERENCES tasks(id),
        type TEXT NOT NULL CHECK(type IN ('blocks','depends_on','related_to','duplicates')),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS task_comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id INTEGER NOT NULL REFERENCES tasks(id),
        agent_id INTEGER REFERENCES agents(id),
        content TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS task_agents (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id     INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        agent_id    INTEGER NOT NULL REFERENCES agents(id),
        role        TEXT CHECK(role IN ('primary', 'support', 'reviewer')),
        assigned_at TEXT DEFAULT (datetime('now')),
        UNIQUE(task_id, agent_id)
      );
      CREATE TABLE IF NOT EXISTS agent_groups (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        parent_id  INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS agent_group_members (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        group_id   INTEGER NOT NULL REFERENCES agent_groups(id),
        agent_id   INTEGER NOT NULL REFERENCES agents(id),
        sort_order INTEGER NOT NULL DEFAULT 0,
        UNIQUE(agent_id)
      );
      CREATE TABLE IF NOT EXISTS config (
        key TEXT NOT NULL PRIMARY KEY, value TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS scopes (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE,
        folder TEXT, techno TEXT, description TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      INSERT OR IGNORE INTO config (key, value) VALUES
        ('claude_md_commit',''),
        ('schema_version','${CURRENT_SCHEMA_VERSION}'),
        ('worktree_default','1');
      INSERT OR IGNORE INTO scopes (name, folder, techno, description) VALUES
        ('global','','—','Transversal — aucun périmètre spécifique');
      CREATE VIRTUAL TABLE IF NOT EXISTS tasks_fts USING fts4(title, description);
      CREATE TRIGGER IF NOT EXISTS tasks_fts_ai AFTER INSERT ON tasks BEGIN
        INSERT INTO tasks_fts(rowid, title, description) VALUES (new.id, new.title, new.description);
      END;
      CREATE TRIGGER IF NOT EXISTS tasks_fts_au AFTER UPDATE ON tasks BEGIN
        DELETE FROM tasks_fts WHERE rowid = old.id;
        INSERT INTO tasks_fts(rowid, title, description) VALUES (new.id, new.title, new.description);
      END;
      CREATE TRIGGER IF NOT EXISTS tasks_fts_ad AFTER DELETE ON tasks BEGIN
        DELETE FROM tasks_fts WHERE rowid = old.id;
      END;
      CREATE INDEX IF NOT EXISTS idx_sessions_agent_id ON sessions(agent_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON sessions(started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_agent_logs_agent_id ON agent_logs(agent_id);
      CREATE INDEX IF NOT EXISTS idx_agent_logs_created_at ON agent_logs(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_tasks_updated_at ON tasks(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_tasks_agent_assigned ON tasks(agent_assigned_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_agent_started ON sessions(agent_id, started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_task_comments_task_id ON task_comments(task_id);
      CREATE INDEX IF NOT EXISTS idx_task_links_from_task ON task_links(from_task);
      CREATE INDEX IF NOT EXISTS idx_task_links_to_task ON task_links(to_task);
      CREATE INDEX IF NOT EXISTS idx_sessions_conv_id ON sessions(claude_conv_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_agent_status ON tasks(agent_assigned_id, status);
      CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
      CREATE INDEX IF NOT EXISTS idx_task_agents_task_id ON task_agents(task_id);
      CREATE INDEX IF NOT EXISTS idx_task_agents_agent_id ON task_agents(agent_id);
      CREATE INDEX IF NOT EXISTS idx_agm_group ON agent_group_members(group_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_sessions_agent_status ON sessions(agent_id, status, started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_task_comments_agent_id ON task_comments(agent_id);
    `)
    const insertAgent = db.prepare(
      `INSERT OR IGNORE INTO agents (name, type, scope, system_prompt, system_prompt_suffix)
       VALUES (?, ?, ?, ?, ?)`
    )
    for (const agent of GENERIC_AGENTS_BY_LANG[agentLang]) {
      insertAgent.run(agent.name, agent.type, agent.scope ?? null, agent.system_prompt ?? null, agent.system_prompt_suffix ?? null)
    }
    db.pragma(`user_version = ${CURRENT_SCHEMA_VERSION}`)
    db.close()
    registerDbPath(dbPath)
    void startDbDaemon(dbPath).catch(() => {})
    console.log('[create-project-db] created:', dbPath)

    // Copy agent scripts to <projectPath>/scripts/
    const scriptsSource = app.isPackaged
      ? join(process.resourcesPath, 'scripts')
      : join(app.getAppPath(), 'scripts')
    const scriptsTarget = join(projectPath, 'scripts')
    let scriptsCopied = 0
    let scriptsError: string | undefined
    try {
      await mkdir(scriptsTarget, { recursive: true })
      for (const script of AGENT_SCRIPTS) {
        await copyFile(join(scriptsSource, script), join(scriptsTarget, script))
        scriptsCopied++
      }
      console.log(`[create-project-db] copied ${scriptsCopied} scripts to ${scriptsTarget}`)
    } catch (copyErr) {
      scriptsError = String(copyErr)
      console.error('[create-project-db] scripts copy failed:', scriptsError)
    }

    return { success: true, dbPath, scriptsCopied, ...(scriptsError ? { scriptsError } : {}) }
  } catch (err) {
    console.error('[IPC create-project-db]', err)
    return { success: false, error: String(err), dbPath: '' }
  }
}
