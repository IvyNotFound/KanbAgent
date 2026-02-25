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
  <div
    class="grid grid-cols-3 items-center h-9 bg-zinc-950 shrink-0"
    style="-webkit-app-region: drag"
  >
    <!-- Left: App identity -->
    <div class="flex items-center gap-2 px-4">
      <div class="w-2 h-2 rounded-full bg-violet-500 shrink-0"></div>
      <span class="text-xs font-semibold text-zinc-500 tracking-widest uppercase">agent-viewer</span>
    </div>

    <!-- Center: Search bar (always visible, VS Code style) -->
    <div class="flex justify-center" style="-webkit-app-region: no-drag">
      <button
        class="flex items-center gap-2 px-3 h-6 rounded-md bg-zinc-800/80 border border-zinc-700/50 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600/80 hover:bg-zinc-800 transition-all duration-150 w-52 group"
        :title="t('titleBar.searchTitle')"
        @click="$emit('open-search')"
      >
        <svg viewBox="0 0 16 16" fill="currentColor" class="w-3 h-3 shrink-0">
          <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.099zm-5.242 1.656a5.5 5.5 0 1 1 0-11 5.5 5.5 0 0 1 0 11z"/>
        </svg>
        <span class="flex-1 text-left text-xs">{{ t('titleBar.searchPlaceholder') }}</span>
        <kbd class="text-[10px] text-zinc-700 group-hover:text-zinc-500 font-mono leading-none">Ctrl+K</kbd>
      </button>
    </div>

    <!-- Right: Window controls — Windows 11 style -->
    <div class="flex items-stretch h-full justify-end" style="-webkit-app-region: no-drag">

      <!-- Minimize -->
      <button
        class="w-[46px] flex items-center justify-center text-zinc-500 hover:text-zinc-100 hover:bg-zinc-700/60 transition-colors"
        :title="t('titleBar.minimize')"
        @click="api.windowMinimize()"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
          <rect x="0" y="4.5" width="10" height="1"/>
        </svg>
      </button>

      <!-- Maximize / Restore -->
      <button
        class="w-[46px] flex items-center justify-center text-zinc-500 hover:text-zinc-100 hover:bg-zinc-700/60 transition-colors"
        :title="isMaximized ? t('titleBar.restore') : t('titleBar.maximize')"
        @click="api.windowMaximize()"
      >
        <!-- Restore: two overlapping squares -->
        <svg v-if="isMaximized" width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" stroke-width="1">
          <rect x="3.5" y="0.5" width="7" height="7" rx="0.5"/>
          <path d="M0.5 3.5v7h7v-3"/>
        </svg>
        <!-- Maximize: single square -->
        <svg v-else width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1">
          <rect x="0.5" y="0.5" width="9" height="9" rx="0.5"/>
        </svg>
      </button>

      <!-- Close -->
      <button
        class="w-[46px] flex items-center justify-center text-zinc-500 hover:text-white hover:bg-red-600 transition-colors"
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
</template>
