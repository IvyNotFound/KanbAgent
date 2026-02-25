<script setup lang="ts">
import { useToast, type Toast } from '@renderer/composables/useToast'

const { toasts, dismiss } = useToast()

const ICON: Record<Toast['type'], string> = {
  error: '✕',
  warn: '⚠',
  info: 'ℹ',
}

const COLOR: Record<Toast['type'], string> = {
  error: 'bg-red-900/90 border-red-700/60 text-red-200',
  warn:  'bg-amber-900/90 border-amber-700/60 text-amber-200',
  info:  'bg-zinc-800/90 border-zinc-700 text-zinc-200',
}
</script>

<template>
  <div class="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm pointer-events-none">
    <div
      v-for="toast in toasts"
      :key="toast.id"
      :class="['flex items-start gap-2.5 px-3 py-2.5 rounded-lg border text-sm backdrop-blur-sm shadow-xl pointer-events-auto', COLOR[toast.type]]"
    >
      <span class="shrink-0 text-xs font-mono mt-0.5">{{ ICON[toast.type] }}</span>
      <span class="flex-1 leading-relaxed break-words min-w-0">{{ toast.message }}</span>
      <button
        class="shrink-0 text-xs opacity-50 hover:opacity-100 transition-opacity mt-0.5"
        @click="dismiss(toast.id)"
      >✕</button>
    </div>
  </div>
</template>
