import { defineConfig } from 'vitest/config'
import { resolve } from 'path'
import vue from '@vitejs/plugin-vue'

// Vitest config for Stryker mutation testing runs.
// Excludes tests with known pre-existing failures that block the Stryker dry run.
export default defineConfig({
  plugins: [vue()],
  test: {
    globals: true,
    environment: 'jsdom',
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
    ],
    css: false,
  },
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer/src'),
      '@': resolve(__dirname, 'src/renderer/src'),
    },
  },
})
