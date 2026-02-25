/**
 * Vue application entry point for agent-viewer renderer.
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
import './assets/main.css'

document.documentElement.classList.add('dark')

const app = createApp(App)
app.use(createPinia())
app.mount('#app')
