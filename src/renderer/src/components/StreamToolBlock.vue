<script setup lang="ts">
import type { StreamContentBlock } from '@renderer/types/stream'

const props = defineProps<{
  block: StreamContentBlock
  eventId: number
  blockIdx: number
  collapsed: Record<string, boolean>
  accentFg: string
  accentBg: string
  accentBorder: string
}>()

const emit = defineEmits<{
  toggleCollapsed: [key: string, defaultCollapsed: boolean]
}>()

function collapseKey(eventId: number, blockIdx: number): string {
  return `${eventId}-${blockIdx}`
}

function isCollapsed(eventId: number, blockIdx: number, defaultCollapsed = false): boolean {
  const key = collapseKey(eventId, blockIdx)
  return props.collapsed[key] ?? defaultCollapsed
}

function toolInputPreview(input: Record<string, unknown> | undefined): string {
  if (!input) return ''
  try {
    return JSON.stringify(input, null, 2)
  } catch {
    return String(input)
  }
}

</script>

<template>
  <!-- tool_use block — carte collapsible couleur agent (T680) -->
  <div
    v-if="block.type === 'tool_use'"
    class="border rounded-lg overflow-hidden"
    :style="{ borderColor: accentBorder }"
    data-testid="block-tool-use"
  >
    <button
      class="w-full flex items-center gap-2 px-3 py-2 transition-colors text-xs"
      :style="{ backgroundColor: accentBg, color: accentFg }"
      @click="emit('toggleCollapsed', collapseKey(eventId, blockIdx), true)"
    >
      <span class="transition-transform duration-200" :class="isCollapsed(eventId, blockIdx, true) ? '' : 'rotate-90'">▶</span>
      <span class="font-semibold">{{ block.name }}</span>
      <span class="ml-auto opacity-60">outil</span>
    </button>
    <div
      v-show="!isCollapsed(eventId, blockIdx, true)"
      class="px-4 py-3 bg-surface-primary text-xs text-content-tertiary overflow-x-auto select-text cursor-text"
    >
      <pre class="whitespace-pre-wrap">{{ toolInputPreview(block.input) }}</pre>
    </div>
  </div>

  <!-- tool_result block — sortie collapsible + markdown + strip ANSI (T727/T729) -->
  <div
    v-else-if="block.type === 'tool_result'"
    class="border rounded-lg overflow-hidden"
    :class="block.is_error ? 'border-red-800 bg-red-950' : 'border-edge-default bg-surface-primary'"
    data-testid="block-tool-result"
  >
    <button
      class="w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-colors"
      :class="block.is_error ? 'text-red-400 hover:bg-red-900' : 'text-content-muted hover:bg-surface-secondary'"
      @click="emit('toggleCollapsed', collapseKey(eventId, blockIdx), !block.is_error && !!block._isLong)"
    >
      <span
        class="transition-transform duration-200"
        :class="isCollapsed(eventId, blockIdx, !block.is_error && !!block._isLong) ? '' : 'rotate-90'"
      >▶</span>
      <span>{{ block.is_error ? '✗ Erreur' : '✓ Résultat' }}</span>
      <span
        v-if="isCollapsed(eventId, blockIdx, !block.is_error && !!block._isLong)"
        class="ml-1 opacity-60"
      >({{ block._lineCount ?? 0 }} lignes)</span>
    </button>
    <!-- eslint-disable vue/no-v-html -->
    <div
      v-show="!isCollapsed(eventId, blockIdx, !block.is_error && !!block._isLong)"
      class="stream-markdown px-4 py-2 text-xs text-content-tertiary overflow-x-auto select-text cursor-text"
      v-html="block._html ?? ''"
    />
    <!-- eslint-enable vue/no-v-html -->
  </div>
</template>
