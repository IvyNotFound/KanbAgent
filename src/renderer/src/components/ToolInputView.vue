<script setup lang="ts">
/**
 * ToolInputView — renders structured tool input per tool type.
 * Used by StreamToolBlock (stream view) and HookEventPayloadModal (hook events).
 * Handles Edit, Bash, Read, Write, Grep, Glob, Agent, and fallback (raw JSON).
 * MCP tools (tool_name contains ':') fall through to the JSON fallback.
 */

interface DiffLine {
  idx: number
  type: 'remove' | 'add' | 'separator'
  prefix: string
  text: string
  label?: string
}

const props = defineProps<{
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

function diffLines(input: Record<string, unknown>): DiffLine[] {
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

function writeLines(input: Record<string, unknown>): DiffLine[] {
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
</script>

<template>
  <!-- Edit: diff view (T1514) -->
  <template v-if="toolName === 'Edit'">
    <div v-if="toolInput.file_path" class="tool-filepath">{{ toolInput.file_path }}</div>
    <div class="diff-view">
      <template v-for="line in diffLines(toolInput)" :key="line.idx">
        <div
          v-if="line.type === 'separator'"
          :class="line.label === 'old' ? 'diff-section-label diff-section-label--remove' : 'diff-section-label diff-section-label--add'"
        >
          {{ line.label }}
        </div>
        <div v-else :class="line.type === 'remove' ? 'diff-remove' : 'diff-add'">
          <span class="diff-prefix">{{ line.prefix }}</span>{{ line.text }}
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
    <div class="diff-view">
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

/* Diff view for Edit tool */
.diff-view {
  font-family: monospace;
  font-size: 0.9em;
  border-radius: var(--shape-xs);
  overflow: hidden;
}

.diff-remove {
  background: rgba(239, 68, 68, 0.18);
  color: rgb(248, 113, 113);
  padding: 1px 4px;
  white-space: pre-wrap;
  word-break: break-all;
}

.diff-add {
  background: rgba(34, 197, 94, 0.18);
  color: rgb(74, 222, 128);
  padding: 1px 4px;
  white-space: pre-wrap;
  word-break: break-all;
}

/* T1570: adapt diff text colors for light theme */
:global(.v-theme--light) .diff-remove { color: rgb(185, 28, 28); }
:global(.v-theme--light) .diff-add    { color: rgb(21, 128, 61); }

.diff-prefix {
  user-select: none;
  opacity: 0.7;
  margin-right: 4px;
  font-weight: bold;
}

.diff-section-label {
  font-size: 0.8em;
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
