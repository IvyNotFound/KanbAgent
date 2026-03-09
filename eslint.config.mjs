import js from '@eslint/js'
import ts from 'typescript-eslint'
import vue from 'eslint-plugin-vue'

export default [
  // Global ignores
  {
    ignores: [
      'dist/',
      'out/',
      'node_modules/',
      'coverage/',
      'playwright-report/',
      'test-results/',
      'scripts/',
      '**/*.spec.ts'
    ]
  },

  // Base JS recommended
  js.configs.recommended,

  // TypeScript recommended (type-aware disabled for speed)
  ...ts.configs.recommended,

  // Vue flat/recommended (includes vue parser for .vue files)
  ...vue.configs['flat/recommended'],

  // Vue files: use typescript parser inside <script> blocks
  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: {
        parser: ts.parser
      }
    }
  },

  // Project-wide rule overrides — warn-only for migration
  {
    files: ['src/**/*.{ts,vue}'],
    rules: {
      // TypeScript already handles undefined variables — disable JS-level check
      'no-undef': 'off',
      // Legitimate control char regex (ANSI escape stripping, null-byte cleanup)
      'no-control-regex': 'off',

      // Warn-only to allow progressive migration
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_'
      }],

      // Vue rules relaxed for existing code
      'vue/multi-word-component-names': 'off',
      'vue/max-attributes-per-line': 'off',
      'vue/singleline-html-element-content-newline': 'off',
      'vue/html-self-closing': 'off',
      'vue/html-closing-bracket-newline': 'off',
      'vue/first-attribute-linebreak': 'off',
      'vue/html-indent': 'off',
      'vue/attribute-hyphenation': 'off',
      'vue/v-on-event-hyphenation': 'off',

      // Allow require() in Electron main process
      '@typescript-eslint/no-require-imports': 'off'
    }
  },

  // Renderer: no-explicit-any elevated to error (migration complete)
  {
    files: ['src/renderer/**/*.{ts,vue}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error'
    }
  },

  // main/ — no-explicit-any promoted to error (all any eliminated)
  {
    files: ['src/main/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
    }
  },
  // Shared files
  {
    files: ['src/shared/**/*.ts'],
    rules: {}
  }
]
