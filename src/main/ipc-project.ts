/**
 * IPC Handlers — Project management
 *
 * Covers: select-project-dir, create-project-db, find-project-db,
 *         select-new-project-dir, init-new-project, project:regenerateRulesFiles,
 *         project:exportZip
 *
 * @module ipc-project
 */

import { ipcMain, dialog, app, shell } from 'electron'
import { access, copyFile, mkdir, readdir, readFile, writeFile } from 'fs/promises'
import { join, basename, resolve } from 'path'
import { getProjectRules, WORKFLOW_MD_TEMPLATE, CLI_RULES_FILE_MAP } from './project-templates'
import { GENERIC_AGENTS_BY_LANG } from './default-agents'
import type { AgentLanguage } from './default-agents'
import Database from 'better-sqlite3'
import {
  registerDbPath,
  registerProjectPath,
  getAllowedProjectPaths,
  assertProjectPathAllowed,
  isProjectPathAllowed,
} from './db'
import { buildSingleFileZip } from './ipc-project-zip'
import { startDbDaemon } from './db-daemon'
import { CURRENT_SCHEMA_VERSION } from './migration'

// ── Trusted project paths persistence ────────────────────────────────────────
// Paths registered via native dialog are persisted to userData so they can be
// restored on cold start. find-project-db no longer self-registers (T782).

function getTrustedPathsFile(): string {
  return join(app.getPath('userData'), 'trusted-project-paths.json')
}

async function persistTrustedPaths(): Promise<void> {
  try {
    await writeFile(getTrustedPathsFile(), JSON.stringify(getAllowedProjectPaths()), 'utf-8')
  } catch { /* non-fatal */ }
}

/** Restore dialog-approved project paths from the persisted JSON file on startup. */
export async function restoreTrustedPaths(): Promise<void> {
  try {
    const raw = await readFile(getTrustedPathsFile(), 'utf-8')
    const paths: string[] = JSON.parse(raw)
    for (const p of paths) registerProjectPath(p)
  } catch { /* first run or corrupt file — ignore */ }
}
export const AGENT_SCRIPTS = [
  'dbq.js',
  'dbw.js',
  'dbstart.js',
  'dblock.js',
  'capture-tokens-hook.js',
]

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Locate a SQLite database inside a project directory.
 *
 * Search order (cold-start safe — T615):
 *  1. `<projectPath>/.claude/*.db`  — standard KanbAgent layout
 *  2. `<projectPath>/*.db`          — fallback for flat layouts
 *
 * @param projectPath - Absolute path to the project root
 * @returns Absolute path to the first `.db` file found, or `null`
 */
async function findProjectDb(projectPath: string): Promise<string | null> {
  const claudeDir = join(projectPath, '.claude')
  try {
    await access(claudeDir)
    const files = (await readdir(claudeDir)).filter(f => f.endsWith('.db'))
    if (files.length > 0) {
      const found = join(claudeDir, files[0])
      console.log('[findProjectDb] found:', found)
      return found
    }
  } catch { /* ignore */ }
  try {
    const files = (await readdir(projectPath)).filter(f => f.endsWith('.db'))
    if (files.length > 0) return join(projectPath, files[0])
  } catch { /* ignore */ }
  return null
}

// ── Handler registration ──────────────────────────────────────────────────────

/** Register project management IPC handlers. */
export function registerProjectHandlers(): void {
  /** @returns {{ projectPath: string, dbPath: string|null, error: null, hasCLAUDEmd: boolean } | null} */
  ipcMain.handle('select-project-dir', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Sélectionner le répertoire du projet',
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const projectPath = result.filePaths[0]
    const dbPath = await findProjectDb(projectPath)
    registerDbPath(dbPath)
    registerProjectPath(projectPath)
    void persistTrustedPaths()
    if (dbPath) void startDbDaemon(dbPath).catch(() => {})
    let hasCLAUDEmd = false
    try { await access(join(projectPath, 'CLAUDE.md')); hasCLAUDEmd = true } catch { /* not found */ }
    if (!dbPath) return { projectPath, dbPath: null, error: null, hasCLAUDEmd }
    return { projectPath, dbPath, error: null, hasCLAUDEmd }
  })

  /**
   * Create a new project.db with full schema and default agents.
   * @param projectPath - Absolute path to the project root
   * @param lang - Agent prompt language (AgentLanguage). Defaults to 'en' when omitted or unrecognised.
   * @returns {{ success: boolean, dbPath: string, error?: string }}
   */
  ipcMain.handle('create-project-db', async (_event, projectPath: string, lang?: string) => {
    assertProjectPathAllowed(projectPath)
    const validLangs = Object.keys(GENERIC_AGENTS_BY_LANG) as AgentLanguage[]
    const agentLang: AgentLanguage = validLangs.includes(lang as AgentLanguage)
      ? (lang as AgentLanguage)
      : 'en'
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
            CHECK(status IN ('todo','in_progress','done','archived')),
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
  })

  /** @returns {string|null} Selected directory path, or null if canceled */
  ipcMain.handle('select-new-project-dir', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Sélectionner le répertoire du nouveau projet',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const selectedPath = result.filePaths[0]
    registerProjectPath(selectedPath)
    void persistTrustedPaths()
    return selectedPath
  })

  /**
   * Initialize a new project: create .claude/ dir, deploy bundled templates,
   * generate CLI-agnostic rules for each selected CLI, and persist multi-CLI config.
   *
   * @param projectPath - Registered project path
   * @param lang - Agent prompt language (defaults to 'en')
   * @param projectClis - CLIs chosen for the project (e.g. ['claude', 'gemini', 'codex'])
   * @param primaryCli - Primary CLI identifier (e.g. 'claude')
   * @returns {{ success: boolean, filesCreated?: string[], error?: string }}
   */
  ipcMain.handle('init-new-project', async (
    _event,
    projectPath: string,
    lang?: string,
    projectClis?: string[],
    primaryCli?: string,
  ) => {
    try {
      assertProjectPathAllowed(projectPath)
      const claudeDir = join(projectPath, '.claude')
      await mkdir(claudeDir, { recursive: true })

      const validLangs = Object.keys(GENERIC_AGENTS_BY_LANG) as AgentLanguage[]
      const rulesLang: AgentLanguage = validLangs.includes(lang as AgentLanguage)
        ? (lang as AgentLanguage)
        : 'en'
      const rules = getProjectRules(rulesLang)
      const filesCreated: string[] = []

      // Determine CLI list — always include 'claude' as fallback
      const clis = Array.isArray(projectClis) && projectClis.length > 0
        ? projectClis
        : ['claude']
      const primary = primaryCli ?? clis[0]

      // Generate rules file for each selected CLI
      for (const cli of clis) {
        const relPath = CLI_RULES_FILE_MAP[cli]
        if (!relPath) continue
        const absPath = join(projectPath, relPath)
        await mkdir(join(absPath, '..'), { recursive: true })
        await writeFile(absPath, rules, 'utf-8')
        filesCreated.push(relPath)
      }

      // Always generate WORKFLOW.md
      await writeFile(join(claudeDir, 'WORKFLOW.md'), WORKFLOW_MD_TEMPLATE, 'utf-8')
      filesCreated.push('.claude/WORKFLOW.md')

      // Persist multi-CLI config in project.db (if DB exists)
      const dbPath = await findProjectDb(projectPath)
      if (dbPath) {
        try {
          const db = new Database(dbPath)
          db.pragma('busy_timeout = 5000')
          const upsert = db.prepare(
            'INSERT OR REPLACE INTO config (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)'
          )
          upsert.run('project_clis', JSON.stringify(clis))
          upsert.run('primary_cli', primary)
          db.close()
        } catch { /* config write is best-effort — DB may not exist yet */ }
      }

      return { success: true, filesCreated }
    } catch (err) {
      console.error('[IPC init-new-project]', err)
      return { success: false, error: String(err) }
    }
  })

  /**
   * Locate project.db inside .claude/ subdirectory.
   * Only registers the path if it is already in the in-memory allowlist (set by a prior dialog
   * selection) or in the persisted trusted-project-paths.json (recovery after corrupt/missing file).
   * This prevents a compromised renderer from elevating arbitrary paths — T1173.
   * @param projectPath - Project root path
   * @returns {string|null} Found DB path, or null
   */
  ipcMain.handle('find-project-db', async (_event, projectPath: string) => {
    if (!projectPath) throw new Error('PROJECT_PATH_REQUIRED')
    const dbPath = await findProjectDb(projectPath)
    // Security: only register paths already trusted — do NOT self-register arbitrary renderer input.
    let trusted = isProjectPathAllowed(projectPath)
    if (!trusted) {
      // Fallback: check the persisted file (handles restoreTrustedPaths failure on corrupt JSON).
      try {
        const raw = await readFile(getTrustedPathsFile(), 'utf-8')
        const paths: string[] = JSON.parse(raw)
        const resolvedPath = resolve(projectPath)
        trusted = paths.some(p => resolve(p) === resolvedPath)
      } catch { /* file absent or corrupt — treat as untrusted */ }
    }
    if (trusted) {
      registerDbPath(dbPath)
      registerProjectPath(projectPath)
    }
    return dbPath
  })

  /**
   * Regenerate CLI-agnostic project rules for each selected CLI (ADR-012 Part A § Regeneration).
   * Called on-demand from SettingsModal when the user wants to refresh rule files
   * (e.g. after installing a new CLI post-init).
   *
   * @param projectPath - Registered project path
   * @param projectClis - CLIs chosen for the project (e.g. ['claude', 'gemini', 'codex'])
   * @param lang - Agent prompt language (defaults to 'en')
   * @returns {{ success: boolean, filesCreated?: string[], error?: string }}
   */
  ipcMain.handle('project:regenerateRulesFiles', async (
    _event,
    projectPath: string,
    projectClis: string[],
    lang?: string,
  ) => {
    try {
      assertProjectPathAllowed(projectPath)
      const validLangs = Object.keys(GENERIC_AGENTS_BY_LANG) as AgentLanguage[]
      const rulesLang: AgentLanguage = validLangs.includes(lang as AgentLanguage)
        ? (lang as AgentLanguage)
        : 'en'
      const rules = getProjectRules(rulesLang)
      const filesCreated: string[] = []

      // Determine CLI list — always include 'claude' as fallback
      const clis = Array.isArray(projectClis) && projectClis.length > 0
        ? projectClis
        : ['claude']

      // Generate rules file for each selected CLI
      for (const cli of clis) {
        const relPath = CLI_RULES_FILE_MAP[cli]
        if (!relPath) continue
        const absPath = join(projectPath, relPath)
        await mkdir(join(absPath, '..'), { recursive: true })
        await writeFile(absPath, rules, 'utf-8')
        filesCreated.push(relPath)
      }

      return { success: true, filesCreated }
    } catch (err) {
      console.error('[IPC project:regenerateRulesFiles]', err)
      return { success: false, error: String(err) }
    }
  })

  /**
   * Export project.db as a ZIP archive into the system Downloads folder.
   * Uses a pure-Node ZIP implementation (zlib deflate + manual ZIP format)
   * to avoid external dependencies. DB is read via fs.readFile to bypass
   * any in-process SQLite lock.
   *
   * @param dbPath - Registered DB path to export
   * @returns {{ success: boolean, path?: string, error?: string }}
   */
  ipcMain.handle('project:exportZip', async (_event, dbPath: string) => {
    const { assertDbPathAllowed } = await import('./db')
    assertDbPathAllowed(dbPath)
    try {
      const fileData = await readFile(dbPath)
      const filename = basename(dbPath)
      const zipBuffer = buildSingleFileZip(filename, fileData)
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      const zipName = `kanbagent-export-${ts}.zip`
      const downloadsDir = app.getPath('downloads')
      const zipPath = join(downloadsDir, zipName)
      await writeFile(zipPath, zipBuffer)
      shell.showItemInFolder(zipPath)
      return { success: true, path: zipPath }
    } catch (err) {
      console.error('[IPC project:exportZip]', err)
      return { success: false, error: String(err) }
    }
  })
}
