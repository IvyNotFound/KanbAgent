/**
 * IPC Handlers — Project management
 *
 * Covers: select-project-dir, create-project-db, find-project-db,
 *         select-new-project-dir, init-new-project, project:exportZip
 *
 * @module ipc-project
 */

import { ipcMain, dialog, app, shell } from 'electron'
import { access, copyFile, mkdir, readdir, readFile, writeFile } from 'fs/promises'
import { join, basename } from 'path'
import { GENERIC_AGENTS_BY_LANG } from './default-agents'
import type { AgentLanguage } from './default-agents'
import {
  registerDbPath,
  registerProjectPath,
  getAllowedProjectPaths,
  assertProjectPathAllowed,
  getSqlJs,
} from './db'
import { buildSingleFileZip } from './ipc-project-zip'

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
 *  1. `<projectPath>/.claude/*.db`  — standard agent-viewer layout
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
    let hasCLAUDEmd = false
    try { await access(join(projectPath, 'CLAUDE.md')); hasCLAUDEmd = true } catch { /* not found */ }
    if (!dbPath) return { projectPath, dbPath: null, error: null, hasCLAUDEmd }
    return { projectPath, dbPath, error: null, hasCLAUDEmd }
  })

  /**
   * Create a new project.db with full schema and default agents.
   * @param projectPath - Absolute path to the project root
   * @param lang - Agent prompt language ('fr' | 'en'). Defaults to 'fr' when omitted or unrecognised.
   * @returns {{ success: boolean, dbPath: string, error?: string }}
   */
  ipcMain.handle('create-project-db', async (_event, projectPath: string, lang?: string) => {
    assertProjectPathAllowed(projectPath)
    const agentLang: AgentLanguage = lang === 'en' ? 'en' : 'fr'
    try {
      const claudeDir = join(projectPath, '.claude')
      await mkdir(claudeDir, { recursive: true })
      const dbPath = join(claudeDir, 'project.db')
      const sqlJs = await getSqlJs()
      const db = new sqlJs.Database()
      db.run(`
        CREATE TABLE IF NOT EXISTS agents (
          id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE,
          type TEXT NOT NULL, scope TEXT, system_prompt TEXT,
          system_prompt_suffix TEXT,
          thinking_mode TEXT CHECK(thinking_mode IN ('auto', 'disabled')),
          allowed_tools TEXT,
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
          tokens_cache_write INTEGER DEFAULT 0
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
        INSERT OR IGNORE INTO config (key, value) VALUES ('claude_md_commit',''),('schema_version','3');
        INSERT OR IGNORE INTO scopes (name, folder, techno, description) VALUES
          ('global','','—','Transversal — aucun périmètre spécifique');
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
      `)
      for (const agent of GENERIC_AGENTS_BY_LANG[agentLang]) {
        db.run(
          `INSERT OR IGNORE INTO agents (name, type, scope, system_prompt, system_prompt_suffix)
           VALUES (?, ?, ?, ?, ?)`,
          [agent.name, agent.type, agent.scope ?? null, agent.system_prompt ?? null, agent.system_prompt_suffix ?? null]
        )
      }
      const exported = db.export()
      db.close()
      await writeFile(dbPath, Buffer.from(exported))
      registerDbPath(dbPath)
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
   * Initialize a new project: create .claude/ dir and download CLAUDE.md from GitHub.
   * @param projectPath - Registered project path
   * @returns {{ success: boolean, error?: string }}
   */
  ipcMain.handle('init-new-project', async (_event, projectPath: string) => {
    try {
      assertProjectPathAllowed(projectPath)
      const claudeDir = join(projectPath, '.claude')
      await mkdir(claudeDir, { recursive: true })

      const response = await fetch('https://raw.githubusercontent.com/IvyNotFound/claude.md/main/CLAUDE.md')
      if (!response.ok) throw new Error(`HTTP ${response.status} lors du téléchargement de CLAUDE.md`)
      const content = await response.text()

      await writeFile(join(projectPath, 'CLAUDE.md'), content, 'utf-8')
      return { success: true }
    } catch (err) {
      console.error('[IPC init-new-project]', err)
      return { success: false, error: String(err) }
    }
  })

  /**
   * Locate project.db inside .claude/ subdirectory.
   * Registers projectPath in the session allowlist so fsListDir works immediately after.
   * On cold start, trusted-project-paths.json may be absent — this registration is essential (T896).
   * @param projectPath - Project root path
   * @returns {string|null} Found DB path, or null
   */
  ipcMain.handle('find-project-db', async (_event, projectPath: string) => {
    if (!projectPath) throw new Error('PROJECT_PATH_REQUIRED')
    const dbPath = await findProjectDb(projectPath)
    registerDbPath(dbPath)
    registerProjectPath(projectPath)
    return dbPath
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
      const zipName = `agent-viewer-export-${ts}.zip`
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
