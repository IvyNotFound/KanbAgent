/**
 * Electron main process entry point for KanbAgent.
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
import { restoreTrustedPaths } from './ipc-project'
import { registerAgentStreamHandlers } from './agent-stream'
import { startHookServer, setHookWindow, injectHookSecret, injectHookUrls, detectWslGatewayIp, injectIntoWslDistros, injectGeminiHooks, injectCodexHooks, getHookSecret } from './hookServer'
import { setupAutoUpdater, registerUpdaterIpc } from './updater'
import { cleanupOrphanWorktreesAtStartup } from './worktree-cleanup'
import { stopAllDbDaemons } from './db-daemon'

// ── GPU flags for improved rendering performance ─────────────────────────────────
// These MUST be set BEFORE app.whenReady() to take effect
app.commandLine.appendSwitch('enable-gpu-rasterization')
// Disable GPU shader disk cache to avoid Windows "access denied" errors on WSL
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache')
// Zero-copy only on Linux/WSL — crashes on some Windows GPU configs (exit code 4294967295)
// disable-software-rasterizer removed: suppresses CPU fallback → Chromium crash on Windows
// when GPU is unsupported (VMs, RDP, Chromium blocklist)
if (process.platform !== 'win32') {
  app.commandLine.appendSwitch('enable-zero-copy')
}

// ── Content Security Policy ───────────────────────────────────────────────────
// In development (ELECTRON_RENDERER_URL set), Vite HMR injects styles via dynamically created
// <style> elements, which requires 'unsafe-inline' for style-src.
// In production, Vite extracts all CSS into bundled .css files loaded via <link rel="stylesheet">,
// so 'unsafe-inline' is not needed and is omitted to tighten the CSP.
// style-src-attr 'none' blocks inline style= attributes in all modes.
// Accepted residual risk (dev-only): XSS + style injection → CSS exfiltration; mitigated by
// DOMPurify and script-src 'self' which already block the primary XSS vector.
const isDev = !!process.env['ELECTRON_RENDERER_URL']
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  isDev ? "style-src 'self' 'unsafe-inline'" : "style-src 'self'",
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
function createWindow(): BrowserWindow {
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

  // DevTools shortcut: always in dev, in packaged app only when KANBAGENT_DEVTOOLS=1 env var is set.
  // Also accepts AGENT_VIEWER_DEVTOOLS=1 for backward compatibility with existing user scripts (T1209).
  // Useful for diagnosing issues in packaged builds without rebuilding (T704).
  // Note: Using KANBAGENT_DEVTOOLS (app-specific) instead of DEBUG_DEVTOOLS to avoid collision with
  // generic DEBUG_* variables that may be set by Node.js tools or other frameworks (T1180).
  if (!app.isPackaged || process.env['KANBAGENT_DEVTOOLS'] === '1' || process.env['AGENT_VIEWER_DEVTOOLS'] === '1') {
    if (app.isPackaged) {
      console.warn('[KanbAgent] KANBAGENT_DEVTOOLS=1 (or AGENT_VIEWER_DEVTOOLS) is set — DevTools shortcut enabled in packaged build.')
    }
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

  return win
}

let hookServer: Server | null = null

app.whenReady().then(async () => {
  setupCSP()
  registerIpcHandlers()
  registerUpdaterIpc()
  await restoreTrustedPaths()
  void cleanupOrphanWorktreesAtStartup().catch((err) =>
    console.warn('[startup] cleanupOrphanWorktreesAtStartup error:', err)
  )
  registerAgentStreamHandlers()
  hookServer = startHookServer(app.getPath('userData'))
  const wslIp = detectWslGatewayIp()
  // Inject into Windows global settings and project settings
  const winGlobalSettings = join(app.getPath('home'), '.claude', 'settings.json')
  const projectSettings = join(process.cwd(), '.claude', 'settings.json')
  for (const p of [winGlobalSettings, projectSettings]) {
    injectHookSecret(p).catch(() => {})
    if (wslIp) injectHookUrls(p, wslIp).catch(() => {})
  }
  // Inject into active WSL distros via UNC paths
  if (process.platform === 'win32') injectIntoWslDistros(wslIp).catch(() => {})
  // Inject Gemini CLI lifecycle hooks
  const listenIp = wslIp ?? '127.0.0.1'
  const stubsDir = join(app.getPath('userData'), 'hooks')
  const geminiSettings = join(app.getPath('home'), '.gemini', 'settings.json')
  injectGeminiHooks(geminiSettings, listenIp, getHookSecret(), stubsDir).catch(() => {})
  // Inject Codex CLI lifecycle hooks (WSL/Linux only — no-op on Windows native)
  const codexHooks = join(app.getPath('home'), '.codex', 'hooks.json')
  injectCodexHooks(codexHooks, listenIp, getHookSecret(), stubsDir).catch(() => {})
  const win = createWindow()
  setupAutoUpdater(win)
})
app.on('window-all-closed', () => {
  hookServer?.close()
  stopAllDbDaemons()
  if (process.platform !== 'darwin') app.quit()
})
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    const win = createWindow()
    setupAutoUpdater(win)
  }
})
