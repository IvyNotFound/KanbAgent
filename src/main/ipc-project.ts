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
import { access, mkdir, readdir, readFile, writeFile } from 'fs/promises'
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
import { createProjectDb, AGENT_SCRIPTS } from './ipc-project-create'

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
// Re-export for backward compatibility (moved to ipc-project-create.ts)
export { AGENT_SCRIPTS } from './ipc-project-create'

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
    return createProjectDb(projectPath, agentLang)
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
