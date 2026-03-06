/** @type {import('@stryker-mutator/core').PartialStrykerOptions} */
export default {
  testRunner: 'vitest',
  reporters: ['html', 'clear-text', 'progress'],
  coverageAnalysis: 'perTest',

  // Mutate only .ts source files — Vue SFCs with <script setup> are incompatible
  // with Stryker's instrumentation (defineProps() scope violation in compiler-sfc)
  mutate: [
    'src/renderer/src/**/*.ts',
    'src/main/**/*.ts',
    '!src/**/*.spec.ts',
    '!src/**/*.test.ts',
    '!src/**/*.d.ts',
  ],

  // Exclude large/generated dirs from sandbox copy
  ignorePatterns: [
    'dist',
    'out',
    'release',
    'coverage',
    'reports',
    'playwright-report',
    'test-results',
    '.stryker-tmp',
    'resources/bin',
    'build',
  ],

  // Vitest runner config — use stryker-specific config to exclude pre-existing failing tests
  vitest: {
    configFile: 'vitest.stryker.config.ts',
  },

  // HTML report output
  htmlReporter: {
    fileName: 'reports/mutation/index.html',
  },

  // Ignore coverage thresholds — Stryker is a diagnostic tool
  thresholds: {
    high: 60,
    low: 40,
    break: null,
  },

  // Timeout per test (ms) — Electron env can be slow
  timeoutMS: 60000,

  // Dry run timeout — 90 tests × env setup is slow in jsdom+node mixed env
  dryRunTimeoutMinutes: 15,

  // Concurrency — limit to avoid OOM on large codebase
  concurrency: 4,
}
