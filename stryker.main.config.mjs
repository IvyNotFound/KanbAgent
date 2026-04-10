/** @type {import('@stryker-mutator/core').PartialStrykerOptions} */
import base from './stryker.config.mjs'

export default {
  ...base,
  concurrency: 2, // ubuntu-latest runners have 2 vCPU — avoid oversubscription
  mutate: ['src/main/**/*.ts', '!src/**/*.spec.ts', '!src/**/*.test.ts', '!src/**/*.d.ts'],
  htmlReporter: { fileName: 'reports/mutation/main/index.html' },
  jsonReporter: { fileName: 'reports/mutation/main/mutation.json' },
}
