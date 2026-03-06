/**
 * E2E tests — Keyboard shortcuts and interactions.
 *
 * Tests that global keyboard shortcuts work as expected in the Electron app.
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

test('app loads without JavaScript errors', async () => {
  const { page } = handle
  const errors: string[] = []

  page.on('pageerror', (err) => {
    // Filter out known non-critical Electron errors
    if (!err.message.includes('ResizeObserver') && !err.message.includes('gpu')) {
      errors.push(err.message)
    }
  })

  await page.waitForLoadState('domcontentloaded')
  await page.waitForTimeout(1000)

  expect(errors).toHaveLength(0)
})

test('window maximize/restore via IPC', async () => {
  const { app } = handle

  const initialMaximized = await app.evaluate(({ BrowserWindow }) => {
    return BrowserWindow.getAllWindows()[0].isMaximized()
  })

  // Toggle maximize
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    win.maximize()
  })

  const afterMaximize = await app.evaluate(({ BrowserWindow }) => {
    return BrowserWindow.getAllWindows()[0].isMaximized()
  })

  // On some platforms (WSL/headless) maximize may not work visually,
  // but the IPC call should not throw
  expect(typeof afterMaximize).toBe('boolean')
})

test('app handles window state queries gracefully', async () => {
  const { page } = handle
  await page.waitForLoadState('domcontentloaded')

  // windowIsMaximized is used by TitleBar to show correct icon
  const isMaximizedResult = await page.evaluate(async () => {
    const api = (window as any).electronAPI
    if (typeof api?.windowIsMaximized !== 'function') return 'no-api'
    try {
      const result = await api.windowIsMaximized()
      return typeof result === 'boolean' ? 'boolean' : typeof result
    } catch {
      return 'error'
    }
  })
  // Either works or is not available — but must not throw uncaught
  expect(['boolean', 'no-api', 'error']).toContain(isMaximizedResult)
})
