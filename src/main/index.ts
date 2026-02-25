/**
 * Electron main process entry point for agent-viewer.
 *
 * Handles:
 * - Application lifecycle (ready, activate, quit)
 * - BrowserWindow creation with security settings
 * - IPC handler registration
 * - Terminal handler registration
 *
 * @module main
 */

import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { registerIpcHandlers } from './ipc'
import { registerTerminalHandlers } from './terminal'

/**
 * Returns the path to the application icon.
 *
 * Development: points to build/icon.png in project root
 * Production: points to resourcesPath in packaged app
 *
 * @returns {string | undefined} Icon file path, or undefined if not found
 */
function getIconPath(): string | undefined {
  // In packaged app, resources are in process.resourcesPath
  // In development, icons are in the project root build/ folder
  if (app.isPackaged) {
    return join(process.resourcesPath || '', '../build/icon.png')
  }
  return join(__dirname, '../../build/icon.png')
}

/**
 * Creates the main application window.
 *
 * Configures:
 * - Size: 1400x900 (min 900x600)
 * - Frameless window with custom title bar
 * - Dark background (#18181b)
 * - Security: contextIsolation enabled, nodeIntegration disabled
 *
 * Registers IPC and terminal handlers, then loads the renderer.
 *
 * @returns {void}
 */
function createWindow(): void {
  const iconPath = getIconPath()

  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    show: false,
    backgroundColor: '#18181b',
    icon: iconPath,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  win.once('ready-to-show', () => win.show())

  win.on('maximize', () => win.webContents.send('window-state-changed', true))
  win.on('unmaximize', () => win.webContents.send('window-state-changed', false))

  registerIpcHandlers()
  registerTerminalHandlers()

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(createWindow)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
