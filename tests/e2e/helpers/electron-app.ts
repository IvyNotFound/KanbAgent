/**
 * Shared helpers for Playwright Electron E2E tests.
 *
 * Resolves the correct Electron binary for each platform:
 *   - Windows: electron.exe
 *   - Linux/macOS: electron (installed via npm on those platforms)
 *
 * Usage:
 *   import { launchApp, closeApp } from './helpers/electron-app'
 */
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { join } from 'path'
import { tmpdir } from 'os'
import { mkdtempSync } from 'fs'

/** Absolute path to the electron-vite built main entry. */
export const MAIN_ENTRY = join(process.cwd(), 'out', 'main', 'index.js')

/** Resolve Electron binary path for the current platform. */
function resolveElectronBin(): string {
  const base = join(process.cwd(), 'node_modules', 'electron', 'dist')
  if (process.platform === 'win32') return join(base, 'electron.exe')
  if (process.platform === 'darwin') return join(base, 'Electron.app', 'Contents', 'MacOS', 'Electron')
  return join(base, 'electron') // Linux
}

export const ELECTRON_BIN = resolveElectronBin()

export interface AppHandle {
  app: ElectronApplication
  page: Page
  testDbDir: string
}

/**
 * Launch the Electron app in test mode with an isolated temporary DB directory.
 *
 * The main process reads TEST_DB_PATH env var so tests can provide an isolated DB.
 * On first launch (no project configured), the app shows the DbSelector screen.
 */
export async function launchApp(): Promise<AppHandle> {
  const testDbDir = mkdtempSync(join(tmpdir(), 'kanbagent-e2e-'))

  const app = await electron.launch({
    executablePath: ELECTRON_BIN,
    args: [...(process.env.CI ? ['--no-sandbox'] : []), MAIN_ENTRY],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      TEST_DB_PATH: join(testDbDir, 'test.db'),
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
      // Headless flags for CI environments
      ...(process.env.CI ? {
        DISPLAY: process.env.DISPLAY ?? ':99',
      } : {}),
    },
  })

  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')

  return { app, page, testDbDir }
}

/**
 * Close the Electron app gracefully.
 */
export async function closeApp(handle: AppHandle): Promise<void> {
  await handle.app.close()
}
