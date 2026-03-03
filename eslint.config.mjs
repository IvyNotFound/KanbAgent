import pluginTs from '@typescript-eslint/eslint-plugin'
import parserTs from '@typescript-eslint/parser'
import pluginVue from 'eslint-plugin-vue'
import vueParser from 'vue-eslint-parser'

export default [
  // ── Ignored paths ────────────────────────────────────────────────────────────
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'out/**',
      '*.tsbuildinfo',
      'scripts/**',
    ],
  },

  // ── TypeScript source files (main + preload) ──────────────────────────────
  {
    files: ['src/main/**/*.ts', 'src/preload/**/*.ts'],
    languageOptions: {
      parser: parserTs,
      parserOptions: {
        project: './tsconfig.node.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      '@typescript-eslint': pluginTs,
    },
    rules: {
      ...pluginTs.configs['recommended'].rules,
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },

  // ── Vue + TypeScript files (renderer) ────────────────────────────────────
  {
    files: ['src/renderer/**/*.vue', 'src/renderer/**/*.ts'],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: parserTs,
        project: './tsconfig.web.json',
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: ['.vue'],
      },
    },
    plugins: {
      '@typescript-eslint': pluginTs,
      'vue': pluginVue,
    },
    rules: {
      ...pluginTs.configs['recommended'].rules,
      ...pluginVue.configs['vue3-recommended'].rules,
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      // Vue-specific relaxations
      'vue/multi-word-component-names': 'off', // single-word names used intentionally
      'vue/require-default-prop': 'off',
      'vue/html-self-closing': 'off',
      'vue/max-attributes-per-line': 'off',
      'vue/singleline-html-element-content-newline': 'off',
      'vue/html-indent': 'off',
      'vue/first-attribute-linebreak': 'off',
    },
  },

  // ── Components using v-html — allowed (sanitized via DOMPurify) ─────────
  {
    files: [
      'src/renderer/src/components/TaskDetailModal.vue',
      'src/renderer/src/components/StreamView.vue',
    ],
    rules: {
      'vue/no-v-html': 'off',
    },
  },

  // ── Test files ────────────────────────────────────────────────────────────
  {
    files: ['src/**/*.spec.ts'],
    languageOptions: {
      parser: parserTs,
      parserOptions: {
        project: null, // no project needed for test files
      },
    },
    plugins: {
      '@typescript-eslint': pluginTs,
    },
    rules: {
      ...pluginTs.configs['recommended'].rules,
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
]
