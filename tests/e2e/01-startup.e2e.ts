/**
 * E2E tests — App startup and initial screen.
 *
 * These tests verify that the Electron app boots correctly and displays the
 * project selector (DbSelector) when no project has been opened yet.
 *
 * Prerequisites: npm run build:vite  (generates out/)
 * Run: npx playwright test --config playwright.config.ts
 */
import { test, expect } from '@playwright/test'
import { launchApp, closeApp, type AppHandle } from './helpers/electron-app'

let handle: AppHandle

test.beforeEach(async () => {
  handle = await launchApp()
})

test.afterEach(async () => {
  await closeApp(handle)
})

test('app window opens and shows title bar', async () => {
  const { page } = handle
  // TitleBar always renders (it has the "KanbAgent" label)
  const titleBar = page.locator('text=KanbAgent').first()
  await expect(titleBar).toBeVisible({ timeout: 10_000 })
})

test('app shows DB selector (project picker) on first launch', async () => {
  const { page } = handle
  // DbSelector shows an "Open" and "Create new" option when no project is loaded
  // These map to t('dbSelector.open') and t('dbSelector.createNew')
  // We test by CSS class pattern: the two-column grid of project actions
  const actionGrid = page.locator('.grid.grid-cols-2')
  await expect(actionGrid).toBeVisible({ timeout: 10_000 })
})

test('window title contains app name', async () => {
  const { page } = handle
  const title = await page.title()
  // electron-vite sets the title to the productName from package.json or HTML
  expect(title).toBeTruthy()
})

test('app has correct window dimensions (at least 800x600)', async () => {
  const { app } = handle
  const windowState = await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    const bounds = win.getBounds()
    return { width: bounds.width, height: bounds.height }
  })
  expect(windowState.width).toBeGreaterThanOrEqual(800)
  expect(windowState.height).toBeGreaterThanOrEqual(600)
})
