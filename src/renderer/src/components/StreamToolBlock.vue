<script setup lang="ts">
/**
 * StreamToolBlock — renders a single tool_use or tool_result block from a stream event.
 *
 * For tool_use blocks, delegates per-tool structured display to ToolInputView:
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
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { StreamContentBlock } from '@renderer/types/stream'
import ToolInputView from './ToolInputView.vue'

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
  /** Accent color for text/icons on neutral dark surface (agentAccent — lighten2 dark/darken1 light). T1738 */
  accentText: string
}>()

const emit = defineEmits<{
  toggleCollapsed: [key: string, defaultCollapsed: boolean]
  /** T1772: emitted when user clicks an AskUserQuestion option chip */
  selectOption: [label: string]
}>()

/** T1772: extract first question from AskUserQuestion input.questions[] */
const firstQuestion = computed(() => {
  if (props.block.type !== 'tool_use' || props.block.name !== 'AskUserQuestion') return null
  const questions = props.block.input?.questions
  if (!Array.isArray(questions) || questions.length === 0) return null
  return questions[0] as {
    question?: string
    multiSelect?: boolean
    options?: Array<{ label: string; description?: string }>
  }
})

/** T1772: local selection state for option chips */
const selectedOptions = ref<string[]>([])

/** T1772: handle option chip click — single/multi select logic + emit */
function handleOptionClick(label: string): void {
  const multiSelect = firstQuestion.value?.multiSelect ?? false
  if (multiSelect) {
    const idx = selectedOptions.value.indexOf(label)
    if (idx >= 0) {
      selectedOptions.value.splice(idx, 1)
    } else {
      selectedOptions.value.push(label)
    }
    if (selectedOptions.value.length > 0) {
      emit('selectOption', selectedOptions.value.join(', '))
    }
  } else {
    if (selectedOptions.value[0] === label) {
      selectedOptions.value = []
    } else {
      selectedOptions.value = [label]
      emit('selectOption', label)
    }
  }
}

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
  <!-- AskUserQuestion — dedicated question card, always visible, no agent color (T1707) -->
  <div
    v-if="block.type === 'tool_use' && block.name === 'AskUserQuestion'"
    class="ask-question-block mb-2"
    data-testid="block-ask-question"
  >
    <div class="ask-question-header px-3 py-2 d-flex align-center ga-2">
      <v-icon icon="mdi-help-circle-outline" size="small" class="ask-question-icon" />
      <span class="ask-question-label text-caption">{{ t('stream.askQuestion') }}</span>
    </div>
    <div class="ask-question-body px-4 py-3 text-body-2">
      {{ firstQuestion?.question || block._question || block.input?.question }}
    </div>
    <!-- T1772: clickable option chips — only when input.questions[0].options present -->
    <div
      v-if="firstQuestion?.options?.length"
      class="ask-question-options px-4 pb-3 d-flex flex-wrap ga-2"
      data-testid="ask-question-options"
    >
      <v-chip
        v-for="option in firstQuestion.options"
        :key="option.label"
        variant="tonal"
        :color="selectedOptions.includes(option.label) ? 'info' : 'surface-variant'"
        class="text-caption ask-question-chip"
        :title="option.description"
        @click="handleOptionClick(option.label)"
      >
        {{ option.label }}
      </v-chip>
    </div>
  </div>

  <!-- tool_use block — inline action bar couleur agent, déplié par défaut (T680, T1530) -->
  <div
    v-else-if="block.type === 'tool_use'"
    class="tool-block tool-block--use mb-2"
    :style="{ borderLeftColor: accentFg }"
    data-testid="block-tool-use"
  >
    <v-btn
      variant="text"
      block
      class="tool-header py-2 px-3 text-body-2"
      :style="{ backgroundColor: accentBg, borderLeftColor: accentText }"
      @click="emit('toggleCollapsed', collapseKey(eventId, blockIdx), false)"
    >
      <v-icon
        :icon="isCollapsed(eventId, blockIdx, false) ? 'mdi-chevron-right' : 'mdi-chevron-down'"
        size="small"
        :style="{ color: accentOnColor }"
      />
      <span class="tool-name" :style="{ color: accentOnColor }">{{ block.name }}</span>
      <span class="tool-label" :style="{ color: accentOnColor, opacity: 0.75 }">{{ t('stream.tool') }}</span>
    </v-btn>
    <div
      v-show="!isCollapsed(eventId, blockIdx, false)"
      class="tool-body pt-3 px-4 pb-2 text-body-2"
    >
      <ToolInputView :tool-name="block.name" :tool-input="block.input ?? {}" />
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
      class="tool-header tool-header--result py-2 px-3 text-body-2"
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
      class="stream-markdown tool-body pt-3 px-4 pb-2 text-body-2"
      v-html="block._html ?? ''"
    />
    <!-- eslint-enable vue/no-v-html -->
  </div>
</template>

<style scoped>
/* T1707: AskUserQuestion — neutral card, distinct from technical tool blocks */
.ask-question-block {
  border-left: 3px solid rgba(var(--v-theme-info), 0.6);
  border-radius: 0 4px 4px 0;
  background: var(--surface-secondary);
  overflow: hidden;
}
.ask-question-header {
  border-bottom: 1px solid var(--edge-subtle);
}
.ask-question-icon {
  color: rgba(var(--v-theme-info), 0.8) !important;
}
.ask-question-label {
  color: var(--content-muted);
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.ask-question-body {
  /* T1764: use Vuetify MD3 token directly — var(--content-primary) can fail in scoped styles */
  color: rgba(var(--v-theme-on-surface), 0.87);
  user-select: text;
  cursor: text;
  font-style: italic;
  line-height: 1.6;
}
/* T1772: option chips — pointer cursor, subtle hover brightness */
.ask-question-chip {
  cursor: pointer !important;
}
.ask-question-chip:hover {
  filter: brightness(1.12);
}

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

/* :deep() required — v-btn__content flex layout (gap, width, justify) has no Vuetify prop equivalent */
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
}

/* T1532: line count as pill badge, pushed to right via ml-auto on the span */
.line-count {
  font-size: 0.8em;
  padding: 1px 8px;
  border-radius: var(--shape-sm);
  background: rgba(var(--v-theme-on-surface), 0.08);
  color: var(--content-muted);
  white-space: nowrap;
}

/* T1532: text preview of first ~80 chars below the header when collapsed */
.tool-result-preview {
  font-family: monospace;
  font-size: 0.8em;
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

/* T1570: tool_use body uses a neutral theme-based background, not agent color */
.tool-block--use .tool-body {
  background: var(--surface-secondary);
}
</style>
