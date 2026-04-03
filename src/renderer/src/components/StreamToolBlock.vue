<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { StreamContentBlock } from '@renderer/types/stream'

const { t } = useI18n()

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
    class="tool-block mb-2"
    data-testid="block-tool-use"
  >
    <v-btn
      variant="text"
      block
      class="tool-header py-2 px-3 text-caption"
      :style="{ color: accentFg }"
      @click="emit('toggleCollapsed', collapseKey(eventId, blockIdx), true)"
    >
      <v-icon
        :icon="isCollapsed(eventId, blockIdx, true) ? 'mdi-chevron-right' : 'mdi-chevron-down'"
        size="small"
      />
      <span class="tool-name">{{ block.name }}</span>
      <span class="tool-label">{{ t('stream.tool') }}</span>
    </v-btn>
    <div
      v-show="!isCollapsed(eventId, blockIdx, true)"
      class="tool-body pt-3 px-4 pb-2 text-caption"
    >
      <pre>{{ toolInputPreview(block.input) }}</pre>
    </div>
  </div>

  <!-- tool_result block — sortie collapsible + markdown + strip ANSI (T727/T729) -->
  <div
    v-else-if="block.type === 'tool_result'"
    class="tool-block mb-2"
    :class="block.is_error ? 'tool-block--error' : 'tool-block--result'"
    data-testid="block-tool-result"
  >
    <v-btn
      variant="text"
      block
      class="tool-header tool-header--result py-2 px-3 text-caption"
      :class="block.is_error ? 'tool-header--error' : ''"
      @click="emit('toggleCollapsed', collapseKey(eventId, blockIdx), !block.is_error && !!block._isLong)"
    >
      <v-icon
        :icon="isCollapsed(eventId, blockIdx, !block.is_error && !!block._isLong) ? 'mdi-chevron-right' : 'mdi-chevron-down'"
        size="small"
      />
      <span>{{ block.is_error ? t('stream.error') : t('stream.result') }}</span>
      <span
        v-if="isCollapsed(eventId, blockIdx, !block.is_error && !!block._isLong)"
        class="line-count ml-1"
      >({{ block._lineCount ?? 0 }} {{ t('stream.lines') }})</span>
    </v-btn>
    <!-- eslint-disable vue/no-v-html -->
    <div
      v-show="!isCollapsed(eventId, blockIdx, !block.is_error && !!block._isLong)"
      class="stream-markdown tool-body pt-3 px-4 pb-2 text-caption"
      v-html="block._html ?? ''"
    />
    <!-- eslint-enable vue/no-v-html -->
  </div>
</template>

<style scoped>
.tool-block {
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 12px;
  overflow: hidden;
}

.tool-block--result {
  border-color: var(--edge-default);
  background-color: var(--surface-primary);
}

.tool-block--error {
  border-color: rgba(var(--v-theme-error), 0.4);
  background-color: rgba(var(--v-theme-error), 0.08);
}

.tool-header :deep(.v-btn__content) {
  gap: 8px;
  width: 100%;
  justify-content: flex-start;
}

.tool-header {
  text-align: left !important;
  justify-content: flex-start !important;
  height: auto !important;
  border-radius: 0 !important;
}
.tool-header:hover {
  filter: brightness(1.1);
}

.tool-header--result {
  color: var(--content-muted) !important;
}
.tool-header--result:hover {
  filter: none;
}

.tool-header--error {
  color: rgb(var(--v-theme-error)) !important;
}
.tool-header--error:hover {
  background-color: rgba(var(--v-theme-error), 0.15);
  filter: none;
}

.tool-name {
  font-weight: 600;
}

.tool-label {
  margin-left: auto;
  opacity: 0.6;
}

.line-count {
  opacity: 0.6;
}

.tool-body {
  color: var(--content-muted);
  overflow-x: auto;
  user-select: text;
  cursor: text;
}

.tool-body pre {
  white-space: pre-wrap;
  margin: 0;
}
</style>
