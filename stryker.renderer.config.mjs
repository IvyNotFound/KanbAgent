/** @type {import('@stryker-mutator/core').PartialStrykerOptions} */
import base from './stryker.config.mjs'

export default {
  ...base,
  mutate: ['src/renderer/src/**/*.ts', '!src/**/*.spec.ts', '!src/**/*.test.ts', '!src/**/*.d.ts', '!src/renderer/src/main.ts'],
  htmlReporter: { fileName: 'reports/mutation/renderer/index.html' },
  jsonReporter: { fileName: 'reports/mutation/renderer/mutation.json' },
}
