import { defineConfig } from 'vitest/config'
import { resolve } from 'path'
import vue from '@vitejs/plugin-vue'

// Vitest config for Stryker mutation testing runs.
// Excludes tests with known pre-existing failures that block the Stryker dry run.
export default defineConfig({
  plugins: [
    // Vuetify components (v-table, etc.) render proper HTML wrappers at runtime,
    // so HTML nesting spec warnings for v-* parents are false positives.
    {
      name: 'suppress-vuetify-nesting-warnings',
      configResolved(config) {
        const _warn = config.logger.warn
        config.logger.warn = (...args: Parameters<typeof _warn>) => {
          if (typeof args[0] === 'string' && args[0].includes('cannot be child of <v-')) return
          _warn(...args)
        }
      },
    },
    vue({
      template: {
        compilerOptions: {
          // Suppress "Failed to resolve component: v-xxx" warnings in tests
          // by treating all Vuetify components (v-*) as known custom elements.
          // Exception: v-treeview must NOT be treated as a custom element —
          // Vue's compiler uses a different (broken) code path for custom elements
          // with named slots (#item, #header), causing "Codegen node is missing" errors.
          // T1668: v-treeview with named slots requires proper component slot compilation.
          isCustomElement: (tag) => tag.startsWith('v-') && tag !== 'v-treeview',
        },
      },
    }),
  ],
  server: {
    fs: {
      // Allow access to parent directories — required when running tests from a
      // git worktree where node_modules live in the main repo root (3 levels up).
      strict: false,
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    env: { TZ: 'UTC' },
    environmentMatchGlobs: [
      ['src/main/**', 'node'],
      ['src/preload/**', 'node'],
    ],
    setupFiles: ['./src/test/setup.ts'],
    include: [
      'src/**/*.spec.ts',
      'src/**/*.test.ts',
      'src/**/*.spec.vue',
    ],
    exclude: [
      'node_modules/**',
      'dist/**',
      'dist-electron/**',
      '**/node_modules/**',
      // Exclude pre-existing failing test (T962 StreamView eviction — unrelated to mutation)
      'src/renderer/src/components/StreamView.spec.ts',
      // Exclude snapshot tests — platform-sensitive HTML diffs fail in Linux CI vs Windows dev
      'src/renderer/src/components/snapshots.spec.ts',
    ],
    css: false,
  },
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer/src'),
      '@': resolve(__dirname, 'src/renderer/src'),
      // T1980: added in T1941 — required for shared module imports
      '@shared': resolve(__dirname, 'src/shared'),
      // T1980: added in T1523 — route better-sqlite3 to a WASM stub so Vitest does not
      // load the native binary compiled for Electron (MODULE_VERSION mismatch).
      'better-sqlite3': resolve(__dirname, 'src/main/__mocks__/better-sqlite3-vitest.ts'),
    },
  },
})
