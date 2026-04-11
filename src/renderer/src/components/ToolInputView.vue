<script setup lang="ts">
/**
 * ToolInputView — renders structured tool input per tool type.
 * Used by StreamToolBlock (stream view) and HookEventPayloadModal (hook events).
 * Handles Edit, Bash, Read, Write, Grep, Glob, Agent, and fallback (raw JSON).
 * MCP tools (tool_name contains ':') fall through to the JSON fallback.
 */

import { computed } from 'vue'
import { useSettingsStore } from '@renderer/stores/settings'
import { computeDiffLines, computeWriteLines } from '@renderer/composables/useDiffLines'
import type { DiffLine } from '@renderer/composables/useDiffLines'

const settings = useSettingsStore()

// Inject diff colors as inline CSS vars on .diff-view to bypass cascade issues
// (T1749: CSS vars on [data-v-theme] fail to cascade into scoped styles when
// ToolInputView is rendered inside a teleported Vuetify dialog)
const diffVars = computed(() => {
  const isLight = settings.theme === 'light'
  return {
    '--diff-add-color':      isLight ? 'rgb(21, 128, 61)'         : 'rgb(74, 222, 128)',
    '--diff-remove-color':   isLight ? 'rgb(185, 28, 28)'         : 'rgb(248, 113, 113)',
    '--diff-add-bg':         isLight ? 'rgba(21, 128, 61, 0.12)'  : 'rgba(34, 197, 94, 0.18)',
    '--diff-remove-bg':      isLight ? 'rgba(185, 28, 28, 0.10)'  : 'rgba(239, 68, 68, 0.18)',
    '--diff-add-char-hl':    isLight ? 'rgba(21, 128, 61, 0.25)'  : 'rgba(34, 197, 94, 0.45)',
    '--diff-remove-char-hl': isLight ? 'rgba(185, 28, 28, 0.25)'  : 'rgba(239, 68, 68, 0.45)',
  }
})

defineProps<{
  toolName: string
  toolInput: Record<string, unknown>
}>()

function toolInputPreview(input: Record<string, unknown>): string {
  try {
    return JSON.stringify(input, null, 2)
  } catch {
    return String(input)
  }
}

const TODO_MAX_ITEMS = 30

function todoStatusIcon(status: string): string {
  switch (status) {
    case 'completed': return 'mdi-check-circle'
    case 'in_progress': return 'mdi-progress-clock'
    default: return 'mdi-circle-outline'
  }
}

function todoStatusColor(status: string): string {
  const isLight = settings.theme === 'light'
  switch (status) {
    case 'completed': return isLight ? 'rgb(21, 128, 61)' : 'rgb(74, 222, 128)'
    case 'in_progress': return '#fb923c'
    default: return isLight ? 'rgb(120, 113, 108)' : 'rgb(161, 161, 170)'
  }
}

// Re-export from composable for template access
function diffLines(input: Record<string, unknown>): DiffLine[] {
  return computeDiffLines(input)
}

function writeLines(input: Record<string, unknown>): DiffLine[] {
  return computeWriteLines(input)
}
</script>

<template>
  <!-- Edit: unified diff view (T1650) -->
  <template v-if="toolName === 'Edit'">
    <div v-if="toolInput.file_path" class="tool-filepath">{{ toolInput.file_path }}</div>
    <div class="diff-view" :style="diffVars">
      <template v-for="line in diffLines(toolInput)" :key="line.idx">
        <div v-if="line.type === 'hunk'" class="diff-hunk">{{ line.text }}</div>
        <div v-else-if="line.type === 'context'" class="diff-context">
          <span class="diff-prefix">{{ line.prefix }}</span>{{ line.text }}
        </div>
        <div v-else :class="line.type === 'remove' ? 'diff-remove' : 'diff-add'">
          <span class="diff-prefix">{{ line.prefix }}</span>
          <template v-if="line.parts">
            <span
              v-for="(part, pi) in line.parts"
              :key="pi"
              :class="{ 'diff-char-hl': part.highlight }"
              >{{ part.text }}</span
            >
          </template>
          <template v-else>{{ line.text }}</template>
        </div>
      </template>
    </div>
  </template>

  <!-- Bash: command block (T1514) -->
  <template v-else-if="toolName === 'Bash'">
    <pre class="tool-command">{{ toolInput.command ?? '' }}</pre>
  </template>

  <!-- Read: file_path + optional offset/limit (T1514) -->
  <template v-else-if="toolName === 'Read'">
    <div v-if="toolInput.file_path" class="tool-filepath">{{ toolInput.file_path }}</div>
    <div v-if="toolInput.offset != null || toolInput.limit != null" class="tool-meta">
      <span v-if="toolInput.offset != null"><span class="tool-key">offset:</span> {{ toolInput.offset }}</span>
      <span v-if="toolInput.limit != null" class="tool-meta-sep"><span class="tool-key">limit:</span> {{ toolInput.limit }}</span>
    </div>
  </template>

  <!-- Write: file_path header + all-green diff (T1529) -->
  <template v-else-if="toolName === 'Write'">
    <div v-if="toolInput.file_path" class="tool-filepath">{{ toolInput.file_path }}</div>
    <div class="diff-view" :style="diffVars">
      <div v-for="line in writeLines(toolInput)" :key="line.idx" class="diff-add">
        <span class="diff-prefix">{{ line.prefix }}</span>{{ line.text }}
      </div>
    </div>
  </template>

  <!-- Grep: pattern highlight + path (T1514) -->
  <template v-else-if="toolName === 'Grep'">
    <div v-if="toolInput.pattern" class="tool-pattern">{{ toolInput.pattern }}</div>
    <div v-if="toolInput.path" class="tool-filepath">
      <span class="tool-key">path:</span> {{ toolInput.path }}
    </div>
  </template>

  <!-- Glob: pattern + path (T1514) -->
  <template v-else-if="toolName === 'Glob'">
    <div v-if="toolInput.pattern" class="tool-pattern">{{ toolInput.pattern }}</div>
    <div v-if="toolInput.path" class="tool-filepath">
      <span class="tool-key">path:</span> {{ toolInput.path }}
    </div>
  </template>

  <!-- Agent: description + subagent_type (T1514) -->
  <template v-else-if="toolName === 'Agent'">
    <div v-if="toolInput.subagent_type" class="tool-pattern">{{ toolInput.subagent_type }}</div>
    <div v-if="toolInput.description" class="tool-meta">{{ toolInput.description }}</div>
  </template>

  <!-- TodoWrite: visual checklist (T1823) -->
  <template v-else-if="toolName === 'TodoWrite'">
    <div v-if="Array.isArray(toolInput.todos)" class="todo-list">
      <div
        v-for="(todo, idx) in (toolInput.todos as Array<Record<string, unknown>>).slice(0, TODO_MAX_ITEMS)"
        :key="idx"
        class="todo-item"
      >
        <v-icon
          size="16"
          :color="todoStatusColor(String(todo.status ?? 'pending'))"
          class="todo-icon"
        >
          {{ todoStatusIcon(String(todo.status ?? 'pending')) }}
        </v-icon>
        <span
          class="todo-content"
          :class="{ 'todo-done': todo.status === 'completed' }"
        >{{ todo.content }}</span>
      </div>
      <div v-if="(toolInput.todos as unknown[]).length > TODO_MAX_ITEMS" class="tool-meta">
        ({{ (toolInput.todos as unknown[]).length - TODO_MAX_ITEMS }} more items)
      </div>
    </div>
  </template>

  <!-- ToolSearch: query + max_results (T1883) -->
  <template v-else-if="toolName === 'ToolSearch'">
    <div class="tool-pattern">
      <v-icon size="14" class="toolsearch-icon">mdi-magnify</v-icon>
      {{ toolInput.query }}
    </div>
    <div v-if="toolInput.max_results" class="tool-meta">
      <span class="tool-key">max_results:</span> {{ toolInput.max_results }}
    </div>
  </template>

  <!-- Fallback: raw JSON for unknown/MCP tools -->
  <template v-else>
    <pre>{{ toolInputPreview(toolInput) }}</pre>
  </template>
</template>

<style scoped>
pre {
  white-space: pre-wrap;
  margin: 0;
}

.tool-filepath {
  margin-bottom: 6px;
  font-size: 0.9em;
  font-family: monospace;
  color: var(--content-secondary);
}

.tool-key {
  opacity: 0.5;
  font-size: 0.9em;
  user-select: none;
  margin-right: 2px;
}

.tool-pattern {
  font-family: monospace;
  font-weight: 600;
  margin-bottom: 4px;
  color: var(--content-secondary);
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
  color: var(--content-primary);
}

.diff-view {
  font-family: monospace;
  font-size: 0.9em;
  border-radius: var(--shape-xs);
  overflow: hidden;
}

.diff-remove {
  background: var(--diff-remove-bg, rgba(239, 68, 68, 0.18));
  color: var(--diff-remove-color, rgb(248, 113, 113));
  padding: 1px 4px;
  white-space: pre-wrap;
  word-break: break-all;
}

.diff-add {
  background: var(--diff-add-bg, rgba(34, 197, 94, 0.18));
  color: var(--diff-add-color, rgb(74, 222, 128));
  padding: 1px 4px;
  white-space: pre-wrap;
  word-break: break-all;
}

.diff-context {
  padding: 1px 4px;
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--content-secondary);
  opacity: 0.7;
}

.diff-hunk {
  padding: 1px 4px;
  font-style: italic;
  opacity: 0.45;
  user-select: none;
  color: var(--content-secondary);
}

.diff-prefix {
  user-select: none;
  opacity: 0.7;
  margin-right: 4px;
  font-weight: bold;
}

.todo-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.todo-item {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 2px 4px;
  font-family: monospace;
  font-size: 0.9em;
  line-height: 1.4;
}

.todo-icon {
  flex-shrink: 0;
  margin-top: 2px;
}

.todo-content {
  color: var(--content-primary);
}

.todo-done {
  text-decoration: line-through;
  opacity: 0.55;
}

.toolsearch-icon {
  opacity: 0.6;
  color: var(--content-secondary);
  margin-right: 4px;
}

.diff-remove .diff-char-hl { background: var(--diff-remove-char-hl, rgba(239, 68, 68, 0.45)); border-radius: 2px; }
.diff-add    .diff-char-hl { background: var(--diff-add-char-hl,    rgba(34, 197, 94, 0.45));  border-radius: 2px; }
</style>
