import { defineConfig } from 'vitest/config'
import { resolve } from 'path'
import vue from '@vitejs/plugin-vue'

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
  test: {
    // Global test configuration
    globals: true,
    environment: 'jsdom',
    env: { TZ: 'UTC' },
    // Run main process and preload tests in Node environment (no DOM)
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
    ],
    // Disable CSS processing for tests
    css: false,
    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: [
        'src/renderer/src/**/*.{ts,vue}',
        'src/main/**/*.{ts}',
      ],
      exclude: [
        'node_modules/**',
        'dist/**',
        '**/*.d.ts',
      ],
      // Progressive coverage gate — thresholds set at ~5% below current coverage (2026-03-09).
      // Raise gradually as test coverage improves. Current baseline: lines=73.9, fn=60.7, branch=62.7, stmt=76.7
      thresholds: {
        lines: 68,
        functions: 55,
        branches: 57,
        statements: 71,
      },
    },
  },
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer/src'),
      '@': resolve(__dirname, 'src/renderer/src'),
      // T1523: route better-sqlite3 to a WASM stub so Vitest (Node v25.6.1,
      // MODULE_VERSION 141) does not load the native binary compiled for Electron
      // (MODULE_VERSION 145). Electron itself still uses the native binary at runtime.
      'better-sqlite3': resolve(__dirname, 'src/main/__mocks__/better-sqlite3-vitest.ts'),
    },
  },
})
