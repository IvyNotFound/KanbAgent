<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const api = window.electronAPI
const isMaximized = ref(false)

defineEmits<{ (e: 'open-search'): void }>()

let cleanup: (() => void) | null = null

onMounted(async () => {
  isMaximized.value = await api.windowIsMaximized()
  cleanup = api.onWindowStateChange((maximized: boolean) => {
    isMaximized.value = maximized
  })
})

onUnmounted(() => {
  cleanup?.()
})
</script>

<template>
  <!-- elevation="0" flat desktop look; height="48" = MD3 compact app bar.
       All controls in default slot (not named slots) so shallowMount renders them correctly.
       -webkit-app-region: drag is applied to the inner div (not v-app-bar) to avoid
       the Electron 41 Windows issue where a position:fixed element with right:0 and
       drag causes the OS to treat the full right window border as a drag zone, blocking
       native resize. The static inner div correctly scopes the drag region to the
       visible 48px title bar area only. -->
  <v-app-bar
    elevation="0"
    :height="48"
    color="surface"
    class="titlebar"
  >
    <div class="titlebar-content" style="-webkit-app-region: drag">
      <!-- Left: App identity -->
      <div class="titlebar-left">
        <div class="titlebar-dot"></div>
        <span class="titlebar-name text-label-medium">KanbAgent</span>
      </div>

      <!-- Center: Search bar (always visible, VS Code style) -->
      <div class="titlebar-center">
        <button
          style="-webkit-app-region: no-drag"
          class="search-btn"
          :title="t('titleBar.searchTitle')"
          @click="$emit('open-search')"
        >
          <v-icon size="18">mdi-magnify</v-icon>
          <span class="search-text text-caption">{{ t('titleBar.searchPlaceholder') }}</span>
          <kbd class="search-kbd">Ctrl+K</kbd>
        </button>
      </div>

      <!-- Right: Window controls — Windows 11 style -->
      <div class="titlebar-controls">
        <!-- Minimize -->
        <button
          style="-webkit-app-region: no-drag"
          class="win-btn"
          :title="t('titleBar.minimize')"
          @click="api.windowMinimize()"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
            <rect x="0" y="4.5" width="10" height="1"/>
          </svg>
        </button>

        <!-- Maximize / Restore -->
        <button
          style="-webkit-app-region: no-drag"
          class="win-btn"
          :title="isMaximized ? t('titleBar.restore') : t('titleBar.maximize')"
          @click="api.windowMaximize()"
        >
          <svg v-if="isMaximized" width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" stroke-width="1">
            <rect x="3.5" y="0.5" width="7" height="7" rx="0.5"/>
            <path d="M0.5 3.5v7h7v-3"/>
          </svg>
          <svg v-else width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1">
            <rect x="0.5" y="0.5" width="9" height="9" rx="0.5"/>
          </svg>
        </button>

        <!-- Close -->
        <button
          style="-webkit-app-region: no-drag"
          class="win-btn win-btn--close"
          :title="t('common.close')"
          @click="api.windowClose()"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" stroke-width="1.1" stroke-linecap="round">
            <line x1="0.5" y1="0.5" x2="9.5" y2="9.5"/>
            <line x1="9.5" y1="0.5" x2="0.5" y2="9.5"/>
          </svg>
        </button>
      </div>
    </div>
  </v-app-bar>
</template>

<style scoped>
/* Scoped CSS justified: Electron -webkit-app-region requires precise layout control.
   Override v-toolbar__content padding to use full width with the 3-column grid. */
.titlebar :deep(.v-toolbar__content) {
  padding: 0;
  width: 100%;
}
.titlebar-content {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  align-items: center;
  height: 48px;
  width: 100%;
}
.titlebar-left {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-left: 16px;
}
.titlebar-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: rgb(var(--v-theme-primary));
  flex-shrink: 0;
}
.titlebar-name {
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.5);
  letter-spacing: 0.02em;
}
.titlebar-center {
  display: flex;
  justify-content: center;
}
.search-btn {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 16px 0 12px;
  height: 36px;
  border-radius: 18px;
  background: rgba(var(--v-theme-on-surface), 0.08);
  border: none;
  color: rgba(var(--v-theme-on-surface), 0.6);
  transition: all var(--md-duration-short3) var(--md-easing-standard);
  min-width: 200px;
  max-width: 320px;
  width: 280px;
  cursor: pointer;
}
.search-btn:hover {
  background: rgba(var(--v-theme-on-surface), 0.12);
  color: rgba(var(--v-theme-on-surface), 0.87);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
}
.search-text {
  flex: 1;
  text-align: left;
}
.search-kbd {
  font-size: 10px;
  color: rgba(var(--v-theme-on-surface), 0.35);
  font-family: monospace;
  line-height: 1;
}
.titlebar-controls {
  display: flex;
  align-items: stretch;
  height: 48px;
  justify-content: flex-end;
}
.win-btn {
  width: 46px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(var(--v-theme-on-surface), 0.5);
  transition: background var(--md-duration-short3) var(--md-easing-standard), color var(--md-duration-short3) var(--md-easing-standard);
  cursor: pointer;
  background: none;
  border: none;
}
.win-btn:hover {
  color: rgba(var(--v-theme-on-surface), 0.9);
  background: rgba(var(--v-theme-on-surface), 0.1);
}
.win-btn--close:hover {
  color: #fff;
  background: rgb(var(--v-theme-error));
}
</style>
