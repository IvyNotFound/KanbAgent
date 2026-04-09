/**
 * E2E tests — Electron IPC and preload bridge.
 *
 * Verifies that the electronAPI preload bridge is correctly exposed to the
 * renderer and that core IPC channels are registered.
 *
 * Prerequisites: npm run build:vite  (generates out/)
 * Run: npx playwright test --config playwright.config.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- page.evaluate runs in browser context, TS types don't apply */
import { test, expect } from '@playwright/test'
import { launchApp, closeApp, type AppHandle } from './helpers/electron-app'

let handle: AppHandle

test.beforeEach(async () => {
  handle = await launchApp()
})

test.afterEach(async () => {
  await closeApp(handle)
})

test('window.electronAPI is exposed in renderer', async () => {
  const { page } = handle
  await page.waitForLoadState('domcontentloaded')

  const hasElectronAPI = await page.evaluate(() => {
    return typeof (window as any).electronAPI === 'object' && (window as any).electronAPI !== null
  })
  expect(hasElectronAPI).toBe(true)
})

test('electronAPI exposes selectProjectDir function', async () => {
  const { page } = handle
  await page.waitForLoadState('domcontentloaded')

  const hasSelectProjectDir = await page.evaluate(() => {
    return typeof (window as any).electronAPI?.selectProjectDir === 'function'
  })
  expect(hasSelectProjectDir).toBe(true)
})

test('electronAPI exposes queryDb function', async () => {
  const { page } = handle
  await page.waitForLoadState('domcontentloaded')

  const hasQueryDb = await page.evaluate(() => {
    return typeof (window as any).electronAPI?.queryDb === 'function'
  })
  expect(hasQueryDb).toBe(true)
})

test('electronAPI exposes window control functions', async () => {
  const { page } = handle
  await page.waitForLoadState('domcontentloaded')

  const windowControls = await page.evaluate(() => {
    const api = (window as any).electronAPI
    return {
      minimize: typeof api?.windowMinimize === 'function',
      maximize: typeof api?.windowMaximize === 'function',
      close: typeof api?.windowClose === 'function',
    }
  })
  expect(windowControls.minimize).toBe(true)
  expect(windowControls.maximize).toBe(true)
  expect(windowControls.close).toBe(true)
})

test('electronAPI exposes agent stream handlers', async () => {
  const { page } = handle
  await page.waitForLoadState('domcontentloaded')

  const agentStream = await page.evaluate(() => {
    const api = (window as any).electronAPI
    return {
      agentCreate: typeof api?.agentCreate === 'function',
      agentSend: typeof api?.agentSend === 'function',
      agentKill: typeof api?.agentKill === 'function',
      onAgentStream: typeof api?.onAgentStream === 'function',
    }
  })
  expect(agentStream.agentCreate).toBe(true)
  expect(agentStream.agentSend).toBe(true)
  expect(agentStream.agentKill).toBe(true)
  expect(agentStream.onAgentStream).toBe(true)
})
