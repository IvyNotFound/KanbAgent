import 'vuetify/styles'
import '@mdi/font/css/materialdesignicons.css'
import { watch } from 'vue'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import { vuetifyThemeName } from './vuetifyTheme'

const vuetifyPlugin = createVuetify({
  components,
  directives,
  defaults: {
    VBtn: { variant: 'flat', density: 'default', rounded: 'xl' },
    VTextField: { variant: 'outlined', density: 'compact', color: 'primary', hideDetails: 'auto' },
    VSelect: { variant: 'outlined', density: 'compact', color: 'primary', hideDetails: 'auto' },
    VTextarea: { variant: 'outlined', density: 'compact', color: 'primary', hideDetails: 'auto' },
    VSwitch: { color: 'primary', density: 'compact' },
    VCheckbox: { color: 'primary', density: 'compact' },
    VCard: { rounded: 'lg', variant: 'elevated' },
    VChip: { size: 'small', variant: 'tonal' },
    VList: { density: 'compact' },
    VDialog: { scrim: 'rgba(0, 0, 0, 0.54)', scrollable: true },
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
          primary: '#8b5cf6',      // brand-violet
          secondary: '#10b981',    // brand-emerald
          warning: '#f59e0b',      // brand-amber
          error: '#ef4444',        // brand-red
          info: '#3b82f6',         // blue-500
          surface: '#09090b',      // zinc-950
          background: '#18181b',   // zinc-900
          'on-surface': '#f4f4f5', // zinc-100
          // Surface tokens
          'surface-base': '#09090b',       // zinc-950
          'surface-primary': '#18181b',    // zinc-900
          'surface-secondary': '#27272a',  // zinc-800
          'surface-tertiary': '#3f3f46',   // zinc-700
          'surface-dialog': '#27272a',     // zinc-800 — MD3 elevation tint for dialogs
          // Content tokens
          'content-primary': '#f4f4f5',    // zinc-100
          'content-secondary': '#e4e4e7',  // zinc-200
          'content-tertiary': '#d4d4d8',   // zinc-300
          'content-muted': '#a1a1aa',      // zinc-400
          'content-subtle': '#71717a',     // zinc-500
          'content-faint': '#52525b',      // zinc-600
          'content-dim': '#3f3f46',        // zinc-700
          // Edge tokens
          'edge-default': '#3f3f46',       // zinc-700
          'edge-subtle': '#27272a',        // zinc-800
          // Scrollbar tokens
          'scrollbar-track': '#27272a',
          'scrollbar-thumb': '#52525b',
          'scrollbar-thumb-hover': '#71717a',
          // Markdown tokens
          'md-code-bg': '#27272a',
          'md-code-text': '#d4d4d8',
          'md-pre-bg': '#18181b',
          'md-pre-border': '#3f3f46',
          'md-pre-text': '#a1a1aa',
          'md-bq-border': '#52525b',
          'md-bq-text': '#a1a1aa',
          'md-hr': '#3f3f46',
        },
      },
      light: {
        dark: false,
        colors: {
          primary: '#8b5cf6',
          secondary: '#10b981',
          warning: '#f59e0b',
          error: '#ef4444',
          info: '#3b82f6',         // blue-500
          surface: '#ffffff',
          background: '#f4f4f5',
          'on-surface': '#18181b',
          // Surface tokens
          'surface-base': '#f4f4f5',       // zinc-100
          'surface-primary': '#ffffff',    // white
          'surface-secondary': '#e4e4e7',  // zinc-200 — distinct from surface-base for visible chat bubbles
          'surface-tertiary': '#e4e4e7',   // zinc-200
          'surface-dialog': '#ffffff',     // white — dialogs float on white in light mode
          // Content tokens
          'content-primary': '#18181b',    // zinc-900
          'content-secondary': '#27272a',  // zinc-800
          'content-tertiary': '#3f3f46',   // zinc-700
          'content-muted': '#52525b',      // zinc-600
          'content-subtle': '#71717a',     // zinc-500
          'content-faint': '#a1a1aa',      // zinc-400
          'content-dim': '#d4d4d8',        // zinc-300
          // Edge tokens
          'edge-default': '#d4d4d8',       // zinc-300
          'edge-subtle': '#e4e4e7',        // zinc-200
          // Scrollbar tokens
          'scrollbar-track': '#e4e4e7',
          'scrollbar-thumb': '#a1a1aa',
          'scrollbar-thumb-hover': '#71717a',
          // Markdown tokens
          'md-code-bg': '#f4f4f5',
          'md-code-text': '#3f3f46',
          'md-pre-bg': '#fafafa',
          'md-pre-border': '#d4d4d8',
          'md-pre-text': '#52525b',
          'md-bq-border': '#a1a1aa',
          'md-bq-text': '#52525b',
          'md-hr': '#d4d4d8',
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
