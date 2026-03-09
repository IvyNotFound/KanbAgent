/**
 * Auto-updater module for agent-viewer.
 *
 * Handles update checks from GitHub Releases (public repo — no token required).
 *
 * @module updater
 */

import { app, ipcMain } from 'electron'
import type { BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'

let isConfigured = false
let mainWindow: BrowserWindow | null = null

/**
 * Initialize autoUpdater and wire up events.
 * Only runs in packaged app — no-op in dev to avoid spurious errors.
 */
export function setupAutoUpdater(win: BrowserWindow): void {
  mainWindow = win
  if (!app.isPackaged) return

  autoUpdater.setFeedURL({
    provider: 'github',
    owner: 'IvyNotFound',
    repo: 'KanbAgent',
  })

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  isConfigured = true

  autoUpdater.on('update-available', (info) => {
    win.webContents.send('update:available', info)
  })

  autoUpdater.on('update-not-available', () => {
    win.webContents.send('update:not-available')
  })

  autoUpdater.on('download-progress', (progress) => {
    win.webContents.send('update:progress', progress)
  })

  autoUpdater.on('update-downloaded', (info) => {
    win.webContents.send('update:downloaded', info)
  })

  autoUpdater.on('error', (err) => {
    win.webContents.send('update:error', err.message)
  })

  autoUpdater.checkForUpdates().catch(() => {
    // Ignore network errors at startup (offline, firewall, etc.)
  })
}

/**
 * Register IPC handlers for the updater.
 * Must be called before the window is created.
 */
export function registerUpdaterIpc(): void {
  ipcMain.handle('updater:check', () => {
    if (!app.isPackaged) return null
    if (!isConfigured) {
      mainWindow?.webContents.send('update:error', 'Auto-updater not configured.')
      return null
    }
    return autoUpdater.checkForUpdates()
  })

  ipcMain.handle('updater:download', () => {
    if (!app.isPackaged) return null
    return autoUpdater.downloadUpdate()
  })

  ipcMain.handle('updater:install', () => {
    autoUpdater.quitAndInstall(false, true)
  })
}
