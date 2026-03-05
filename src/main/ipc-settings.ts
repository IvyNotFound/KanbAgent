/**
 * IPC handlers — Settings & config operations
 *
 * Handles config values and update checks (public repo, no auth required).
 *
 * @module ipc-settings
 */

import { ipcMain } from 'electron'
import { assertDbPathAllowed, queryLive, writeDb } from './db'

// ── Handler registration ─────────────────────────────────────────────────────

/** Register all settings IPC handlers. */
export function registerSettingsHandlers(): void {
  /**
   * Read a config value by key.
   * Path is validated via assertDbPathAllowed before any DB access (T529).
   * @param dbPath - DB path (must be a registered project.db path)
   * @param key - Config key
   * @returns {{ success: boolean, value: string|null, error?: string }}
   * @throws If dbPath is not an allowed project database path
   */
  ipcMain.handle('get-config-value', async (_event, dbPath: string, key: string) => {
    try {
      assertDbPathAllowed(dbPath)
      const rows = await queryLive(dbPath, 'SELECT value FROM config WHERE key = ?', [key])
      return { success: true, value: rows.length > 0 ? (rows[0] as { value: string }).value : null }
    } catch (err) {
      console.error('[IPC get-config-value]', err)
      return { success: false, value: null, error: String(err) }
    }
  })

  /**
   * Write a config value.
   * @param dbPath - Registered DB path
   * @param key - Config key
   * @param value - Value to store
   * @returns {{ success: boolean, error?: string }}
   */
  ipcMain.handle('set-config-value', async (_event, dbPath: string, key: string, value: string) => {
    try {
      assertDbPathAllowed(dbPath)
      await writeDb(dbPath, (db) => {
        db.run(
          'INSERT OR REPLACE INTO config (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
          [key, value]
        )
      })
      return { success: true }
    } catch (err) {
      console.error('[IPC set-config-value]', err)
      return { success: false, error: String(err) }
    }
  })

  /**
   * Check GitHub releases for a newer version (public repo — no auth required).
   * @param dbPath - DB path (registered project DB path)
   * @param repoUrl - GitHub repository URL
   * @param currentVersion - Current app version (e.g. "0.5.1")
   * @returns {{ hasUpdate: boolean, latestVersion: string, error?: string }}
   */
  ipcMain.handle('check-for-updates', async (_event, _dbPath: string, repoUrl: string, currentVersion: string) => {
    try {
      const match = repoUrl.match(/github\.com[/:]([^/]+)\/([^/.]+)/)
      if (!match) return { hasUpdate: false, latestVersion: '', error: 'URL invalide' }
      const owner = match[1]
      const repo = match[2].replace(/\.git$/, '')
      // Validate owner/repo format to prevent unexpected chars being forwarded to GitHub API
      if (!/^[a-zA-Z0-9_.-]{1,100}$/.test(owner) || !/^[a-zA-Z0-9_.-]{1,100}$/.test(repo)) {
        return { hasUpdate: false, latestVersion: '', error: 'owner/repo invalide' }
      }

      const headers: Record<string, string> = { Accept: 'application/vnd.github.v3+json' }

      // T304: 10s timeout prevents UI freeze when GitHub is unreachable
      const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/latest`, { headers, signal: AbortSignal.timeout(10_000) })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = await response.json() as { tag_name?: string }
      const latestVersion = data.tag_name?.replace(/^v/, '') || ''
      const hasUpdate = !!latestVersion && latestVersion > currentVersion
      return { hasUpdate, latestVersion }
    } catch (err) {
      console.error('[IPC check-for-updates]', err)
      return { hasUpdate: false, latestVersion: '', error: String(err) }
    }
  })
}
