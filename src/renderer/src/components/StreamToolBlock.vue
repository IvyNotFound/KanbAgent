<script setup lang="ts">
/**
 * StreamToolBlock — renders a single tool_use or tool_result block from a stream event.
 *
 * For tool_use blocks, provides per-tool structured display:
 *   - Edit: inline diff view (old/new lines, capped at 50 lines each)
 *   - Bash: command block
 *   - Read: file path + optional offset/limit metadata
 *   - Write: file path + content preview (first 50 lines)
 *   - Grep/Glob: pattern + path
 *   - Agent: subagent_type + description
 *   - Unknown tools: raw JSON fallback
 *
 * For tool_result blocks, renders the pre-processed HTML (ANSI-stripped, markdown-rendered)
 * and applies error styling when `is_error` is set.
 *
 * Collapse state is managed externally by the parent (StreamView) via the `collapsed` prop
 * and the `toggleCollapsed` emit.
 */
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
  accentOnColor: string
}>()

const emit = defineEmits<{
  toggleCollapsed: [key: string, defaultCollapsed: boolean]
}>()

/**
 * Builds the collapse-state map key for a given event + block position.
 * @param eventId - Unique event identifier from the stream.
 * @param blockIdx - Index of the content block within the event.
 * @returns Dot-separated string key used in the `collapsed` map.
 */
function collapseKey(eventId: number, blockIdx: number): string {
  return `${eventId}-${blockIdx}`
}

/**
 * Returns whether a block is currently collapsed.
 * Falls back to `defaultCollapsed` when no explicit state is stored yet.
 * @param eventId - Unique event identifier.
 * @param blockIdx - Block index within the event.
 * @param defaultCollapsed - Initial collapse state when not yet tracked.
 * @returns True if the block should be rendered collapsed.
 */
function isCollapsed(eventId: number, blockIdx: number, defaultCollapsed = false): boolean {
  const key = collapseKey(eventId, blockIdx)
  return props.collapsed[key] ?? defaultCollapsed
}

/**
 * Serializes a tool input object to an indented JSON string for display.
 * Used as fallback for tool types without a dedicated structured view.
 * @param input - Raw tool input object from the stream event.
 * @returns Formatted JSON string, or empty string if input is falsy.
 */
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

/**
 * Builds a flat list of diff lines from an Edit tool input for display.
 * Old lines are prefixed with `-` (remove), new lines with `+` (add).
 * Each group is preceded by a separator row labeled `old` or `new`.
 * Truncates each group to 50 lines and appends a count row when over the limit.
 * @param input - Tool input containing `old_string` and/or `new_string`.
 * @returns Ordered array of DiffLine entries ready for template rendering.
 */
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

function writeLines(input: Record<string, unknown> | undefined): DiffLine[] {
  if (!input?.content) return []
  const lines = String(input.content).split('\n')
  const limit = Math.min(lines.length, 50)
  const result: DiffLine[] = lines.slice(0, limit).map((text, i) => ({
    idx: i,
    type: 'add' as const,
    prefix: '+',
    text,
  }))
  if (lines.length > limit) {
    result.push({ idx: limit, type: 'add', prefix: '…', text: `(${lines.length - limit} more lines)` })
  }
  return result
}

// T1532: extract plain-text preview from rendered HTML (strip tags + decode entities)
function resultPreview(html: string | undefined): string {
  if (!html) return ''
  const text = html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > 80 ? text.slice(0, 80) + '…' : text
}
</script>

<template>
  <!-- tool_use block — inline action bar couleur agent, déplié par défaut (T680, T1530) -->
  <div
    v-if="block.type === 'tool_use'"
    class="tool-block tool-block--use mb-2"
    :style="{ borderLeftColor: accentFg, backgroundColor: accentBg }"
    data-testid="block-tool-use"
  >
    <v-btn
      variant="text"
      block
      class="tool-header py-2 px-3 text-caption"
      :style="{ color: accentFg }"
      @click="emit('toggleCollapsed', collapseKey(eventId, blockIdx), false)"
    >
      <v-icon
        :icon="isCollapsed(eventId, blockIdx, false) ? 'mdi-chevron-right' : 'mdi-chevron-down'"
        size="small"
      />
      <span class="tool-name">{{ block.name }}</span>
      <span class="tool-label">{{ t('stream.tool') }}</span>
    </v-btn>
    <div
      v-show="!isCollapsed(eventId, blockIdx, false)"
      class="tool-body pt-3 px-4 pb-2 text-caption"
      :style="{ color: accentOnColor }"
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

      <!-- Write: file_path header + all-green diff (T1529) -->
      <template v-else-if="block.name === 'Write'">
        <div
          v-if="block.input?.file_path"
          class="tool-filepath"
        >
          {{ block.input.file_path }}
        </div>
        <div class="diff-view">
          <div
            v-for="line in writeLines(block.input)"
            :key="line.idx"
            class="diff-add"
          >
            <span class="diff-prefix">{{ line.prefix }}</span>{{ line.text }}
          </div>
        </div>
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
      <!-- T1532: line count badge pushed to right, styled as pill -->
      <span
        v-if="isCollapsed(eventId, blockIdx, !block.is_error && !!block._isLong)"
        class="line-count ml-auto"
      >{{ block._lineCount ?? 0 }} {{ t('stream.lines') }}</span>
    </v-btn>
    <!-- T1532: text preview shown only when long non-error result is collapsed -->
    <div
      v-if="!block.is_error && !!block._isLong && isCollapsed(eventId, blockIdx, true)"
      class="tool-result-preview px-4 pb-2"
    >
      {{ resultPreview(block._html) }}
    </div>
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
/* T1530: redesign — left-accent bar (code-block pattern) instead of card */
.tool-block {
  border-left: 3px solid var(--edge-default);
  border-radius: 0 4px 4px 0;
  overflow: hidden;
}

/* tool_use: border-left color + bg injected via inline style (agent accent) */
.tool-block--use {
  border-left-width: 3px;
}

.tool-block--result {
  background-color: var(--surface-primary);
}

.tool-block--error {
  border-left-color: rgba(var(--v-theme-error), 0.8);
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

/* T1532: line count as pill badge, pushed to right via ml-auto on the span */
.line-count {
  font-size: 0.78em;
  padding: 1px 8px;
  border-radius: var(--shape-sm);
  background: rgba(var(--v-theme-on-surface), 0.08);
  color: var(--content-muted);
  white-space: nowrap;
}

/* T1532: text preview of first ~80 chars below the header when collapsed */
.tool-result-preview {
  font-family: monospace;
  font-size: 0.78em;
  color: var(--content-muted);
  opacity: 0.5;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: default;
  user-select: none;
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
  border-radius: var(--shape-xs);
  white-space: pre-wrap;
  margin: 0;
  word-break: break-all;
}

/* Diff view for Edit tool */
.diff-view {
  font-family: monospace;
  font-size: 0.9em;
  border-radius: var(--shape-xs);
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
