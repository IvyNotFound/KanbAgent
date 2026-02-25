<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'

const api = window.electronAPI
const isMaximized = ref(false)

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
    class="flex items-center justify-between h-9 bg-zinc-950 shrink-0"
    style="-webkit-app-region: drag"
  >
    <!-- App identity -->
    <div class="flex items-center gap-2 px-4">
      <div class="w-2 h-2 rounded-full bg-violet-500"></div>
      <span class="text-xs font-semibold text-zinc-400 tracking-widest uppercase">agent-viewer</span>
    </div>

    <!-- Window controls — Windows 11 style -->
    <div class="flex items-stretch h-full" style="-webkit-app-region: no-drag">

      <!-- Minimize -->
      <button
        class="w-[46px] flex items-center justify-center text-zinc-500 hover:text-zinc-100 hover:bg-zinc-700/60 transition-colors"
        title="Minimiser"
        @click="api.windowMinimize()"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
          <rect x="0" y="4.5" width="10" height="1"/>
        </svg>
      </button>

      <!-- Maximize / Restore -->
      <button
        class="w-[46px] flex items-center justify-center text-zinc-500 hover:text-zinc-100 hover:bg-zinc-700/60 transition-colors"
        :title="isMaximized ? 'Restaurer' : 'Agrandir'"
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
        title="Fermer"
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
