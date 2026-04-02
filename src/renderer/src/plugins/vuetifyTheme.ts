/**
 * Thin reactive bridge between the settings store and the Vuetify theme plugin.
 * Importing this file has no CSS side effects — safe to use in tests.
 *
 * settings.ts writes vuetifyThemeName.value to switch themes.
 * vuetify.ts watches vuetifyThemeName and forwards changes to Vuetify's theme API.
 */

import { ref } from 'vue'

const stored = (localStorage.getItem('theme') as 'dark' | 'light') || 'dark'

/** Reactive theme name. Write to this to change the active Vuetify theme. */
export const vuetifyThemeName = ref<'dark' | 'light'>(stored)
