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

interface DiffLine {
  idx: number
  type: 'remove' | 'add' | 'separator'
  prefix: string
  text: string
  label?: string
}

function diffLines(input: Record<string, unknown> | undefined): DiffLine[] {
  if (!input) return []
  const oldLines = String(input.old_string ?? '').split('\n')
  const newLines = String(input.new_string ?? '').split('\n')
  const result: DiffLine[] = []
  let idx = 0
  if (input.old_string) {
    result.push({ idx: idx++, type: 'separator', prefix: '', text: '', label: 'old' })
    const removeLimit = Math.min(oldLines.length, 50)
    for (let i = 0; i < removeLimit; i++) {
      result.push({ idx: idx++, type: 'remove', prefix: '-', text: oldLines[i] })
    }
    if (oldLines.length > 50) {
      result.push({ idx: idx++, type: 'remove', prefix: '…', text: `(${oldLines.length - 50} more lines)` })
    }
  }
  if (input.new_string) {
    result.push({ idx: idx++, type: 'separator', prefix: '', text: '', label: 'new' })
    const addLimit = Math.min(newLines.length, 50)
    for (let i = 0; i < addLimit; i++) {
      result.push({ idx: idx++, type: 'add', prefix: '+', text: newLines[i] })
    }
    if (newLines.length > 50) {
      result.push({ idx: idx, type: 'add', prefix: '…', text: `(${newLines.length - 50} more lines)` })
    }
  }
  return result
}

function writePreview(input: Record<string, unknown> | undefined): string {
  if (!input?.content) return ''
  const lines = String(input.content).split('\n')
  return lines.slice(0, 50).join('\n') + (lines.length > 50 ? `\n… (${lines.length - 50} more lines)` : '')
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
      <!-- Edit: diff view (T1514) -->
      <template v-if="block.name === 'Edit'">
        <div
          v-if="block.input?.file_path"
          class="tool-filepath"
        >
          {{ block.input.file_path }}
        </div>
        <div class="diff-view">
          <template
            v-for="line in diffLines(block.input)"
            :key="line.idx"
          >
            <div
              v-if="line.type === 'separator'"
              :class="line.label === 'old' ? 'diff-section-label diff-section-label--remove' : 'diff-section-label diff-section-label--add'"
            >
              {{ line.label }}
            </div>
            <div
              v-else
              :class="line.type === 'remove' ? 'diff-remove' : 'diff-add'"
            >
              <span class="diff-prefix">{{ line.prefix }}</span>{{ line.text }}
            </div>
          </template>
        </div>
      </template>

      <!-- Bash: command block (T1514) -->
      <template v-else-if="block.name === 'Bash'">
        <pre class="tool-command">{{ block.input?.command ?? '' }}</pre>
      </template>

      <!-- Read: file_path + optional offset/limit (T1514) -->
      <template v-else-if="block.name === 'Read'">
        <div
          v-if="block.input?.file_path"
          class="tool-filepath"
        >
          {{ block.input.file_path }}
        </div>
        <div
          v-if="block.input?.offset != null || block.input?.limit != null"
          class="tool-meta"
        >
          <span v-if="block.input?.offset != null"><span class="tool-key">offset:</span> {{ block.input.offset }}</span>
          <span
            v-if="block.input?.limit != null"
            class="tool-meta-sep"
          ><span class="tool-key">limit:</span> {{ block.input.limit }}</span>
        </div>
      </template>

      <!-- Write: file_path header + content preview truncated to 50 lines (T1514) -->
      <template v-else-if="block.name === 'Write'">
        <div
          v-if="block.input?.file_path"
          class="tool-filepath"
        >
          {{ block.input.file_path }}
        </div>
        <pre
          v-if="block.input?.content"
          class="tool-command"
        >{{ writePreview(block.input) }}</pre>
      </template>

      <!-- Grep: pattern highlight + path (T1514) -->
      <template v-else-if="block.name === 'Grep'">
        <div
          v-if="block.input?.pattern"
          class="tool-pattern"
        >
          {{ block.input.pattern }}
        </div>
        <div
          v-if="block.input?.path"
          class="tool-filepath"
        >
          <span class="tool-key">path:</span> {{ block.input.path }}
        </div>
      </template>

      <!-- Glob: pattern + path (T1514) -->
      <template v-else-if="block.name === 'Glob'">
        <div
          v-if="block.input?.pattern"
          class="tool-pattern"
        >
          {{ block.input.pattern }}
        </div>
        <div
          v-if="block.input?.path"
          class="tool-filepath"
        >
          <span class="tool-key">path:</span> {{ block.input.path }}
        </div>
      </template>

      <!-- Agent: description + subagent_type (T1514) -->
      <template v-else-if="block.name === 'Agent'">
        <div
          v-if="block.input?.subagent_type"
          class="tool-pattern"
        >
          {{ block.input.subagent_type }}
        </div>
        <div
          v-if="block.input?.description"
          class="tool-meta"
        >
          {{ block.input.description }}
        </div>
      </template>

      <!-- Fallback: raw JSON for unknown tools -->
      <template v-else>
        <pre>{{ toolInputPreview(block.input) }}</pre>
      </template>
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

/* Per-tool structured display (T1514, T1520) */
.tool-filepath {
  margin-bottom: 6px;
  font-size: 0.85em;
  font-family: monospace;
  color: var(--content-default);
}

.tool-key {
  opacity: 0.5;
  font-size: 0.85em;
  user-select: none;
  margin-right: 2px;
}

.tool-pattern {
  font-family: monospace;
  font-weight: 600;
  margin-bottom: 4px;
  color: var(--content-default);
}

.tool-meta {
  opacity: 0.8;
  margin-top: 4px;
}

.tool-meta-sep {
  margin-left: 8px;
}

.tool-command {
  background: rgba(var(--v-theme-on-surface), 0.06);
  padding: 8px 12px;
  border-radius: 6px;
  white-space: pre-wrap;
  margin: 0;
  word-break: break-all;
  color: var(--content-default);
}

/* Diff view for Edit tool */
.diff-view {
  font-family: monospace;
  font-size: 0.9em;
  border-radius: 6px;
  overflow: hidden;
}

.diff-remove {
  background: rgba(239, 68, 68, 0.15);
  color: rgb(248, 113, 113);
  padding: 1px 4px;
  white-space: pre-wrap;
  word-break: break-all;
}

.diff-add {
  background: rgba(34, 197, 94, 0.15);
  color: rgb(74, 222, 128);
  padding: 1px 4px;
  white-space: pre-wrap;
  word-break: break-all;
}

.diff-prefix {
  user-select: none;
  opacity: 0.7;
  margin-right: 4px;
  font-weight: bold;
}

.diff-section-label {
  font-size: 0.75em;
  font-weight: 600;
  text-transform: uppercase;
  opacity: 0.5;
  padding: 2px 4px;
  margin-top: 4px;
  user-select: none;
}
.diff-section-label--remove { color: rgb(248, 113, 113); }
.diff-section-label--add    { color: rgb(74, 222, 128); }
</style>
