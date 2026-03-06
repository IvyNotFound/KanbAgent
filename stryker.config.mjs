/** @type {import('@stryker-mutator/core').PartialStrykerOptions} */
export default {
  testRunner: 'vitest',
  reporters: ['html', 'clear-text', 'progress'],
  coverageAnalysis: 'perTest',

  // Mutate only source files, not tests
  mutate: [
    'src/renderer/src/**/*.ts',
    'src/renderer/src/**/*.vue',
    'src/main/**/*.ts',
    '!src/**/*.spec.ts',
    '!src/**/*.test.ts',
    '!src/**/*.d.ts',
  ],

  // Vitest runner config — reuse existing vitest.config.ts
  vitest: {
    configFile: 'vitest.config.ts',
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

  // Concurrency — limit to avoid OOM on large codebase
  concurrency: 4,
}
