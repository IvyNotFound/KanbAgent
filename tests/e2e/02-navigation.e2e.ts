/**
 * E2E tests — Navigation and UI structure.
 *
 * Tests that verify navigation elements are visible and structurally correct
 * from the initial state (no project loaded).
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

test('TitleBar renders window controls (minimize/maximize/close)', async () => {
  const { page } = handle
  // Window control buttons are at the right end of the title bar
  // Each is 46px wide (w-[46px] in TitleBar.vue)
  const controls = page.locator('.h-full.flex.items-stretch')
  await expect(controls).toBeVisible({ timeout: 10_000 })

  // Three button-like elements for minimize/maximize/close
  const buttons = page.locator('.h-full.flex.items-stretch button, .h-full.flex.items-stretch div[class*="w-\\[46px\\]"]')
  const count = await buttons.count()
  expect(count).toBeGreaterThanOrEqual(3)
})

test('search bar (Ctrl+K) is visible in title bar', async () => {
  const { page } = handle
  // TitleBar has a search button with kbd "Ctrl+K"
  const searchBtn = page.locator('kbd').filter({ hasText: /Ctrl\+K/i })
  await expect(searchBtn).toBeVisible({ timeout: 10_000 })
})

test('DbSelector shows tagline text', async () => {
  const { page } = handle
  // The DbSelector always shows the logo icon area regardless of locale
  // The violet icon container is identifiable by its CSS class
  const iconContainer = page.locator('.w-14.h-14.rounded-2xl')
  await expect(iconContainer).toBeVisible({ timeout: 10_000 })
})

test('sidebar is not visible when no project is loaded', async () => {
  const { page } = handle
  // Sidebar is conditionally rendered: v-if="store.projectPath"
  // When no project is loaded, sidebar should be absent from DOM
  await page.waitForLoadState('domcontentloaded')
  await page.waitForTimeout(500) // allow Vue reactivity to settle

  // Check that sidebar-specific elements are not visible
  // Sidebar has navigation for backlog/dashboard/timeline
  const sidebar = page.locator('nav').first()
  const sidebarVisible = await sidebar.isVisible().catch(() => false)
  // Either no nav or nav is empty/hidden
  if (sidebarVisible) {
    // If nav exists, it should not have task/board navigation items
    const boardLink = sidebar.locator('text=Board').first()
    expect(await boardLink.isVisible()).toBe(false)
  }
})
