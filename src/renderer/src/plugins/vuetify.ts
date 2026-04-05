import 'vuetify/styles'
import '@mdi/font/css/materialdesignicons.css'
import { watch } from 'vue'
import { createVuetify } from 'vuetify'
import { md3 } from 'vuetify/blueprints'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import { vuetifyThemeName } from './vuetifyTheme'

const vuetifyPlugin = createVuetify({
  blueprint: md3,
  components,
  directives,
  defaults: {
    // rounded: xl same as md3 blueprint → removed; variant + density differ → kept
    VBtn: { variant: 'flat', density: 'default' },
    // variant: outlined same as md3 blueprint → removed; density/color/hideDetails differ → kept
    VTextField: { density: 'compact', color: 'primary', hideDetails: 'auto' },
    VSelect: { density: 'compact', color: 'primary', hideDetails: 'auto' },
    VTextarea: { density: 'compact', color: 'primary', hideDetails: 'auto' },
    // not in md3 blueprint → kept as-is
    VSwitch: { color: 'primary', density: 'compact' },
    // color differs from md3 (secondary) → kept; density not in blueprint → kept
    VCheckbox: { color: 'primary', density: 'compact' },
    // rounded: lg same as md3 blueprint → removed; variant differs → kept
    VCard: { variant: 'elevated' },
    // size + variant not in md3 blueprint → kept (blueprint adds rounded: sm)
    VChip: { size: 'small', variant: 'tonal' },
    // density not in md3 blueprint → kept (blueprint adds prependGap: 16)
    VList: { density: 'compact' },
    // not in md3 blueprint → kept as-is
    VDialog: { scrim: 'rgba(0, 0, 0, 0.32)', scrollable: true },
    VSnackbar: { timeout: 5000, location: 'bottom end' },
    VTab: { density: 'compact' },
    VMenu: { offset: 4 },
  },
  theme: {
    defaultTheme: vuetifyThemeName.value,
    themes: {
      dark: {
        dark: true,
        colors: {
          // MD3 tonal palette — seed #8b5cf6, generated via @material/material-color-utilities
          primary: '#d0bcff',              // primary dark — tone 80
          'on-primary': '#3c0091',         // onPrimary dark — tone 20
          'primary-container': '#5516be',  // primaryContainer dark — tone 30
          'on-primary-container': '#e9ddff', // onPrimaryContainer dark — tone 90
          secondary: '#fda4af',            // brand-rose, MD3 tone 80
          warning: '#f59e0b',              // brand-amber
          error: '#ef4444',               // brand-red
          info: '#3b82f6',                // blue-500
          surface: '#141316',             // neutral tone 6
          background: '#141316',          // neutral tone 6
          'on-surface': '#e6e1e6',        // neutral tone 90
          // Container colors — rose + error kept from brand palette
          'secondary-container': '#4c0519',    // secondaryContainer dark (rose tonal)
          'on-secondary-container': '#fecdd3', // onSecondaryContainer dark (rose-200)
          'error-container': '#4c1d1d',        // errorContainer dark (red tonal)
          'on-error-container': '#fca5a5',     // onErrorContainer dark (red-300)
          // Surface tokens (MD3 neutral palette — seed #8b5cf6)
          'surface-base': '#141316',       // neutral T6
          'surface-primary': '#1c1b1e',    // neutral T10
          'surface-secondary': '#2b292d',  // neutral T17
          'surface-tertiary': '#363438',   // neutral T22
          'surface-dialog': '#1c1b1e',     // neutral T10 — dialog elevation (darkened to restore contrast with internal sections T17/T22)
          'surface-variant': '73,69,78',       // MD3 surfaceVariant dark — NV tone 30
          'on-surface-variant': '202,196,207', // MD3 onSurfaceVariant dark — NV tone 80
          // Content tokens (MD3 neutral palette)
          'content-primary': '#e6e1e6',    // neutral T90
          'content-secondary': '#ddd8dd',  // neutral T87
          'content-tertiary': '#cac5ca',   // neutral T80
          'content-muted': '#938f94',      // neutral T60
          'content-subtle': '#79767a',     // neutral T50
          'content-faint': '#605d62',      // neutral T40
          'content-dim': '#48464a',        // neutral T30
          // Edge tokens
          'edge-default': '#363438',       // neutral T22
          'edge-subtle': '#2b292d',        // neutral T17
          // Scrollbar tokens
          'scrollbar-track': '#2b292d',
          'scrollbar-thumb': '#605d62',
          'scrollbar-thumb-hover': '#79767a',
          // Markdown tokens
          'md-code-bg': '#2b292d',
          'md-code-text': '#cac5ca',
          'md-pre-bg': '#1c1b1e',
          'md-pre-border': '#363438',
          'md-pre-text': '#938f94',
          'md-bq-border': '#605d62',
          'md-bq-text': '#938f94',
          'md-hr': '#363438',
        },
      },
      light: {
        dark: false,
        colors: {
          // MD3 tonal palette — seed #8b5cf6, generated via @material/material-color-utilities
          primary: '#6d3bd7',              // primary light — tone 40
          'on-primary': '#ffffff',         // onPrimary light — tone 100
          'primary-container': '#e9ddff',  // primaryContainer light — tone 90
          'on-primary-container': '#23005c', // onPrimaryContainer light — tone 10
          secondary: '#e11d48',            // brand-rose, MD3 tone 40
          warning: '#f59e0b',              // brand-amber
          error: '#ef4444',               // brand-red
          info: '#3b82f6',                // blue-500
          surface: '#fdf8fd',             // neutral tone 98
          background: '#f2ecf1',          // neutral tone 94
          'on-surface': '#1c1b1e',        // neutral tone 10
          // Container colors — rose + error kept from brand palette
          'secondary-container': '#ffe4e8',    // secondaryContainer light (rose-100)
          'on-secondary-container': '#881337', // onSecondaryContainer light (rose-900)
          'error-container': '#fee2e2',        // errorContainer light (red-100)
          'on-error-container': '#991b1b',     // onErrorContainer light (red-800)
          // Surface tokens (MD3 neutral palette — seed #8b5cf6)
          'surface-base': '#f2ecf1',       // neutral T94
          'surface-primary': '#fdf8fd',    // neutral T98
          'surface-secondary': '#ece7eb',  // neutral T92
          'surface-tertiary': '#ece7eb',   // neutral T92
          'surface-dialog': '#fdf8fd',     // neutral T98 — dialogs float near white
          'surface-variant': '231,224,235',    // MD3 surfaceVariant light — NV tone 90
          'on-surface-variant': '97,93,102',   // MD3 onSurfaceVariant light — NV tone 40
          // Content tokens (MD3 neutral palette)
          'content-primary': '#1c1b1e',    // neutral T10
          'content-secondary': '#323033',  // neutral T20
          'content-tertiary': '#48464a',   // neutral T30
          'content-muted': '#605d62',      // neutral T40
          'content-subtle': '#79767a',     // neutral T50
          'content-faint': '#938f94',      // neutral T60
          'content-dim': '#cac5ca',        // neutral T80
          // Edge tokens
          'edge-default': '#cac5ca',       // neutral T80
          'edge-subtle': '#e6e1e6',        // neutral T90
          // Scrollbar tokens
          'scrollbar-track': '#e6e1e6',
          'scrollbar-thumb': '#938f94',
          'scrollbar-thumb-hover': '#79767a',
          // Markdown tokens
          'md-code-bg': '#f2ecf1',
          'md-code-text': '#48464a',
          'md-pre-bg': '#fdf8fd',
          'md-pre-border': '#cac5ca',
          'md-pre-text': '#605d62',
          'md-bq-border': '#938f94',
          'md-bq-text': '#605d62',
          'md-hr': '#cac5ca',
        },
      },
    },
  },
})

// Forward reactive theme changes from settings store → Vuetify theme API.
watch(vuetifyThemeName, (name) => {
  vuetifyPlugin.theme.global.name.value = name
})

export default vuetifyPlugin
