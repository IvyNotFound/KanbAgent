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
import vuetify from './plugins/vuetify'
import './assets/main.css'

// Dev mode indicator: slightly purple background to distinguish dev from prod
if (import.meta.env.DEV) {
  document.documentElement.setAttribute('data-dev-mode', '')
}

const app = createApp(App)
app.use(createPinia())
app.use(i18n)
app.use(vuetify)
app.mount('#app')
