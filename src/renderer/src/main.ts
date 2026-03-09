/**
 * Vue application entry point for KanbAgent renderer.
 *
 * Initializes:
 * - Vue 3 application instance
 * - Pinia state management
 * - Dark mode (default)
 *
 * @module renderer/main
 */

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import i18n from './plugins/i18n'
import './assets/main.css'

// Apply theme early from localStorage to prevent flash of wrong theme
if ((localStorage.getItem('theme') || 'dark') === 'dark') {
  document.documentElement.classList.add('dark')
} else {
  document.documentElement.classList.remove('dark')
}

// Dev mode indicator: slightly purple background to distinguish dev from prod
if (import.meta.env.DEV) {
  document.documentElement.classList.add('dev-mode')
}

const app = createApp(App)
app.use(createPinia())
app.use(i18n)
app.mount('#app')
