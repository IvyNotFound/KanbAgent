/**
 * Electron main process entry point for agent-viewer.
 *
 * Handles:
 * - Application lifecycle (ready, activate, quit)
 * - BrowserWindow creation with security settings
 * - IPC handler registration
 *
 * @module main
 */

import { app, BrowserWindow, session, Menu, MenuItem, globalShortcut } from 'electron'
import { join } from 'path'
import type { Server } from 'http'
import { registerIpcHandlers } from './ipc'
import { registerAgentStreamHandlers } from './agent-stream'
import { startHookServer, setHookWindow } from './hookServer'

// ── GPU flags for improved rendering performance ─────────────────────────────────
// These MUST be set BEFORE app.whenReady() to take effect
// They improve GPU rasterization and reduce CPU usage for animations
app.commandLine.appendSwitch('enable-gpu-rasterization')
app.commandLine.appendSwitch('enable-zero-copy')
app.commandLine.appendSwitch('disable-software-rasterizer')
// Disable GPU shader disk cache to avoid Windows "access denied" errors on WSL
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache')
// Optional: uncomment if GPU is blocked by Chromium blocklist
// app.commandLine.appendSwitch('ignore-gpu-blocklist')
// app.commandLine.appendSwitch('enable-native-gpu-memory-buffers')

// ── Content Security Policy ───────────────────────────────────────────────────
// 'unsafe-inline' for style-src is required by Tailwind CSS (utility classes injected as inline styles).
// Removing it would break the entire UI. CSS nonce/hash is not feasible with Vite+Tailwind without
// a custom PostCSS plugin. Risk is low (no external content loaded, no user-generated HTML rendered).
// style-src-attr 'none' is added to restrict inline style= attributes as a partial mitigation.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "style-src-attr 'none'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "font-src 'self'"
].join('; ')

/**
 * Applies Content Security Policy to all requests.
 */
function setupCSP(): void {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [CSP]
      }
    })
  })
}

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
 * Registers IPC handlers, then loads the renderer.
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
      sandbox: true
    }
  })

  win.once('ready-to-show', () => win.show())

  // DevTools shortcut: always in dev, in packaged app only when DEBUG_DEVTOOLS=1 env var is set.
  // Useful for diagnosing issues in packaged builds without rebuilding (T704).
  if (!app.isPackaged || process.env['DEBUG_DEVTOOLS'] === '1') {
    globalShortcut.register('CommandOrControl+Shift+I', () => {
      const focused = BrowserWindow.getFocusedWindow()
      if (focused) focused.webContents.toggleDevTools()
    })
  }

  win.on('maximize', () => win.webContents.send('window-state-changed', true))
  win.on('unmaximize', () => win.webContents.send('window-state-changed', false))

  // Windows spell-check context menu: show correction suggestions on right-click
  win.webContents.on('context-menu', (_event, params) => {
    const menu = new Menu()

    for (const suggestion of params.dictionarySuggestions) {
      menu.append(new MenuItem({
        label: suggestion,
        click: () => win.webContents.replaceMisspelling(suggestion)
      }))
    }

    if (params.misspelledWord) {
      menu.append(new MenuItem({ type: 'separator' }))
      menu.append(new MenuItem({
        label: 'Ajouter au dictionnaire',
        click: () => win.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord)
      }))
    }

    if (menu.items.length > 0) {
      menu.popup()
    }
  })

  setHookWindow(win)

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

let hookServer: Server | null = null

app.whenReady().then(() => {
  setupCSP()
  registerIpcHandlers()
  registerAgentStreamHandlers()
  hookServer = startHookServer()
  createWindow()
})
app.on('window-all-closed', () => {
  hookServer?.close()
  if (process.platform !== 'darwin') app.quit()
})
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
