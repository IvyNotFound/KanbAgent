<script setup lang="ts">
/**
 * ToolInputView — renders structured tool input per tool type.
 * Used by StreamToolBlock (stream view) and HookEventPayloadModal (hook events).
 * Handles Edit, Bash, Read, Write, Grep, Glob, Agent, and fallback (raw JSON).
 * MCP tools (tool_name contains ':') fall through to the JSON fallback.
 */

import { computed } from 'vue'
import { useSettingsStore } from '@renderer/stores/settings'

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

interface DiffLine {
  idx: number
  type: 'remove' | 'add' | 'context' | 'hunk'
  prefix: string
  text: string
  parts?: Array<{ text: string; highlight: boolean }>
}

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

// LCS-based line diff — returns an array of {type, text} entries
function computeLineDiff(
  oldLines: string[],
  newLines: string[],
): Array<{ type: 'context' | 'remove' | 'add'; text: string }> {
  const m = oldLines.length
  const n = newLines.length
  // Guard: avoid O(m*n) for very large diffs
  if (m * n > 100_000) {
    return [
      ...oldLines.map((t) => ({ type: 'remove' as const, text: t })),
      ...newLines.map((t) => ({ type: 'add' as const, text: t })),
    ]
  }
  const dp = Array.from({ length: m + 1 }, () => new Int32Array(n + 1))
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        oldLines[i - 1] === newLines[j - 1]
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1])
    }
  }
  const result: Array<{ type: 'context' | 'remove' | 'add'; text: string }> = []
  let i = m,
    j = n
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      result.unshift({ type: 'context', text: oldLines[i - 1] })
      i--
      j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.unshift({ type: 'add', text: newLines[j - 1] })
      j--
    } else {
      result.unshift({ type: 'remove', text: oldLines[i - 1] })
      i--
    }
  }
  return result
}

// Retain only CONTEXT_SIZE lines around each change; insert hunk separators
function withContext(
  diff: Array<{ type: 'context' | 'remove' | 'add'; text: string }>,
  ctx = 3,
): DiffLine[] {
  const visible = new Set<number>()
  diff.forEach((l, i) => {
    if (l.type !== 'context') {
      for (let k = Math.max(0, i - ctx); k <= Math.min(diff.length - 1, i + ctx); k++) {
        visible.add(k)
      }
    }
  })
  if (visible.size === 0) return []
  const indices = Array.from(visible).sort((a, b) => a - b)
  const result: DiffLine[] = []
  let prev = -1
  let idx = 0
  for (const i of indices) {
    if (prev >= 0 && i > prev + 1) {
      result.push({ idx: idx++, type: 'hunk', prefix: '', text: '...' })
    }
    const l = diff[i]
    result.push({
      idx: idx++,
      type: l.type,
      prefix: l.type === 'remove' ? '-' : l.type === 'add' ? '+' : ' ',
      text: l.text,
    })
    prev = i
  }
  return result
}

// Character-level LCS diff — returns segments with/without highlight
function computeCharDiff(a: string, b: string): { parts: Array<{ text: string; highlight: boolean }> } | null {
  // Guard: skip if too long or too dissimilar
  if (a.length * b.length > 10_000) return null
  const ratio = (2 * lcsLength(a, b)) / (a.length + b.length)
  if (ratio < 0.3) return null

  const m = a.length
  const n = b.length
  const dp = Array.from({ length: m + 1 }, () => new Int32Array(n + 1))
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1])
    }
  }
  // Reconstruct alignment for `b` (add line) — highlight chars not in LCS
  const bParts: Array<{ text: string; highlight: boolean }> = []
  let i = m,
    j = n
  const ops: boolean[] = new Array(n).fill(true) // true = highlighted
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      ops[j - 1] = false
      i--
      j--
    } else if (dp[i][j - 1] >= dp[i - 1][j]) {
      j--
    } else {
      i--
    }
  }
  // Merge consecutive same-highlight chars into segments
  let k = 0
  while (k < n) {
    const hl = ops[k]
    let seg = b[k]
    k++
    while (k < n && ops[k] === hl) {
      seg += b[k]
      k++
    }
    bParts.push({ text: seg, highlight: hl })
  }
  return { parts: bParts }
}

function lcsLength(a: string, b: string): number {
  const m = a.length
  const n = b.length
  const dp = new Int32Array(n + 1)
  for (let i = 1; i <= m; i++) {
    let prev = 0
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j]
      dp[j] = a[i - 1] === b[j - 1] ? prev + 1 : Math.max(dp[j], dp[j - 1])
      prev = tmp
    }
  }
  return dp[n]
}

// Apply char-level diff to consecutive remove+add pairs
function applyCharHighlights(lines: DiffLine[]): void {
  for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i].type === 'remove' && lines[i + 1].type === 'add') {
      const res = computeCharDiff(lines[i].text, lines[i + 1].text)
      if (res) {
        lines[i + 1].parts = res.parts
      }
    }
  }
}

const MAX_DIFF_LINES = 80

function diffLines(input: Record<string, unknown>): DiffLine[] {
  const oldStr = String(input.old_string ?? '')
  const newStr = String(input.new_string ?? '')

  // Fallback: if only one side present, use simple add/remove
  if (!input.old_string && !input.new_string) return []
  if (!input.old_string) {
    const lines = newStr.split('\n')
    const limit = Math.min(lines.length, MAX_DIFF_LINES)
    const result: DiffLine[] = lines.slice(0, limit).map((text, i) => ({
      idx: i,
      type: 'add' as const,
      prefix: '+',
      text,
    }))
    if (lines.length > limit) {
      result.push({ idx: limit, type: 'hunk', prefix: '', text: `(${lines.length - limit} more lines)` })
    }
    return result
  }
  if (!input.new_string) {
    const lines = oldStr.split('\n')
    const limit = Math.min(lines.length, MAX_DIFF_LINES)
    const result: DiffLine[] = lines.slice(0, limit).map((text, i) => ({
      idx: i,
      type: 'remove' as const,
      prefix: '-',
      text,
    }))
    if (lines.length > limit) {
      result.push({ idx: limit, type: 'hunk', prefix: '', text: `(${lines.length - limit} more lines)` })
    }
    return result
  }

  const rawDiff = computeLineDiff(oldStr.split('\n'), newStr.split('\n'))
  let lines = withContext(rawDiff)

  // Truncate to MAX_DIFF_LINES
  if (lines.length > MAX_DIFF_LINES) {
    const remaining = lines.length - MAX_DIFF_LINES
    lines = lines.slice(0, MAX_DIFF_LINES)
    lines.push({ idx: MAX_DIFF_LINES, type: 'hunk', prefix: '', text: `(${remaining} more lines)` })
  }

  applyCharHighlights(lines)
  return lines
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

/* Intra-line char highlight for substitution pairs */
.diff-remove .diff-char-hl { background: var(--diff-remove-char-hl, rgba(239, 68, 68, 0.45)); border-radius: 2px; }
.diff-add    .diff-char-hl { background: var(--diff-add-char-hl,    rgba(34, 197, 94, 0.45));  border-radius: 2px; }
</style>
