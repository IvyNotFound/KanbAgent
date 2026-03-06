import { defineConfig } from '@playwright/test'
import { join } from 'path'

/**
 * Playwright E2E configuration for agent-viewer (Electron).
 *
 * Prerequisites:
 *   - Run `npm run build:vite` to generate out/main/index.js and out/renderer/
 *   - Playwright and @playwright/test must be installed (npm install -D @playwright/test playwright)
 *
 * Environment requirements:
 *   - Windows: runs natively with electron.exe
 *   - Linux CI: use `xvfb-run npx playwright test` (ubuntu-latest has Xvfb)
 *   - WSL: run from Windows side, or use CI
 *
 * Isolated DB:
 *   - Each test suite creates a temp dir for its SQLite file (TEST_DB_PATH env var)
 *
 * Run:        npx playwright test --config playwright.config.ts
 * Run (Linux): xvfb-run npx playwright test --config playwright.config.ts
 * Update snaps: npx playwright test --update-snapshots
 */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.e2e.ts',
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Electron tests must run serially (single window per test file)
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
    : [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  outputDir: 'test-results',
  projects: [
    {
      name: 'electron',
      testMatch: '**/*.e2e.ts',
    },
  ],
})
