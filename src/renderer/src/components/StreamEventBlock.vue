<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import StreamToolBlock from './StreamToolBlock.vue'
import type { StreamEvent } from '@renderer/types/stream'

defineProps<{
  event: StreamEvent
  collapsed: Record<string, boolean>
  agentColors: {
    fg: string
    bg: string
    border: string
    onColor: string
    text: string
    bubbleTextColor: string
  }
  isInitVisible: boolean
  initContext: string | undefined
}>()

const emit = defineEmits<{
  'toggle-collapsed': [key: string, initial?: boolean]
  'select-option': [label: string]
  'preview-image': [src: string]
}>()

const { t } = useI18n()
</script>

<template>
  <!-- system:init — only first per session_id (T1458) -->
  <div
    v-if="event.type === 'system' && event.subtype === 'init' && isInitVisible"
    class="block-system-init"
    data-testid="block-system-init"
  >
    <div class="d-flex align-center ga-2">
      <v-divider />
      <span class="text-caption text-medium-emphasis text-no-wrap">
        {{ t('stream.sessionStarted') }}<span v-if="event.session_id"> · {{ event.session_id.slice(0, 8) }}…</span>
      </span>
      <v-divider />
      <v-btn
        v-if="initContext"
        variant="text"
        size="x-small"
        density="compact"
        class="init-ctx-btn"
        @click="emit('toggle-collapsed', `init-ctx-${event._id}`, true)"
      >
        {{ (collapsed[`init-ctx-${event._id}`] ?? true) ? '▶ ' + t('stream.ctx') : '▼ ' + t('stream.ctx') }}
      </v-btn>
    </div>
    <div
      v-if="initContext"
      v-show="!(collapsed[`init-ctx-${event._id}`] ?? true)"
      class="init-ctx-body mt-1 ml-4"
    >{{ initContext }}</div>
  </div>

  <!-- error:spawn / error:exit -->
  <div
    v-if="event.type === 'error:spawn' || event.type === 'error:exit'"
    class="block-error ga-2 py-3 px-4"
    data-testid="block-error"
  >
    <span class="error-icon">⚠</span>
    <div class="error-body">
      <span class="error-type">{{ event.type }}</span>
      <span class="error-text ml-2">{{ event.error }}</span>
      <pre v-if="event.stderr" class="error-stderr mt-2 text-caption">{{ event.stderr }}</pre>
    </div>
  </div>

  <!-- user bubble — right-aligned (T603) -->
  <div
    v-if="event.type === 'user' && event.message"
    class="block-user"
    data-testid="block-user"
  >
    <div
      class="user-bubble stream-markdown-user py-3 px-4 text-body-2"
      :style="{ background: agentColors.fg, color: agentColors.bubbleTextColor }"
    >
      <template v-for="(block, bIdx) in event.message.content" :key="bIdx">
        <!-- eslint-disable-next-line vue/no-v-html -- sanitized via DOMPurify -->
        <div v-if="block.type === 'text'" v-html="block._html ?? ''" />
        <img
          v-else-if="block.type === 'image_ref' && block.objectUrl"
          :src="block.objectUrl"
          class="user-bubble-img"
          data-testid="user-thumbnail"
          alt=""
          @click="emit('preview-image', block.objectUrl!)"
        />
      </template>
    </div>
  </div>

  <!-- assistant blocks -->
  <template v-if="event.type === 'assistant' && event.message">
    <div class="block-assistant">
      <template v-for="(block, bIdx) in event.message.content" :key="`${event._id}-${bIdx}`">
        <!-- text block — Markdown + DOMPurify (T678) -->
        <!-- eslint-disable vue/no-v-html -- sanitized via DOMPurify -->
        <div
          v-if="block.type === 'text'"
          class="stream-markdown block-text py-3 px-4"
          data-testid="block-text"
          v-html="block._html ?? ''"
        />
        <!-- eslint-enable vue/no-v-html -->

        <!-- tool_use / tool_result — delegated to StreamToolBlock (T816) -->
        <StreamToolBlock
          v-else-if="block.type === 'tool_use' || block.type === 'tool_result'"
          :block="block"
          :event-id="event._id!"
          :block-idx="bIdx"
          :collapsed="collapsed"
          :accent-fg="agentColors.fg"
          :accent-bg="agentColors.bg"
          :accent-border="agentColors.border"
          :accent-on-color="agentColors.onColor"
          :accent-text="agentColors.text"
          @toggle-collapsed="(k, v) => emit('toggle-collapsed', k, v)"
          @select-option="(l) => emit('select-option', l)"
        />
      </template>
    </div>
  </template>

  <!-- result footer — cost / duration / turns -->
  <div
    v-if="event.type === 'result'"
    class="block-result d-flex flex-wrap ga-2 py-2"
    data-testid="block-result"
  >
    <v-chip v-if="event.num_turns !== undefined" size="x-small" variant="tonal">
      {{ t('stream.turns', event.num_turns, { named: { n: event.num_turns } }) }}
    </v-chip>
    <v-chip v-if="event.cost_usd !== undefined" size="x-small" variant="tonal">
      ${{ event.cost_usd.toFixed(4) }}
    </v-chip>
    <v-chip v-if="event.duration_ms !== undefined" size="x-small" variant="tonal">
      {{ (event.duration_ms / 1000).toFixed(1) }}s
    </v-chip>
    <span v-if="event.session_id" class="result-session-id ml-auto text-caption">{{ event.session_id.slice(0, 8) }}…</span>
  </div>

  <!-- text block — plain text output from non-Claude CLIs (T1197) -->
  <div v-if="event.type === 'text'" class="block-assistant">
    <!-- eslint-disable vue/no-v-html -- sanitized via DOMPurify -->
    <div
      class="stream-markdown block-text py-3 px-4"
      data-testid="block-text-raw"
      v-html="event._html ?? event.text ?? ''"
    />
    <!-- eslint-enable vue/no-v-html -->
  </div>

  <!-- error block — error events from non-Claude CLIs (T1197) -->
  <div
    v-if="event.type === 'error'"
    class="block-error ga-2 py-3 px-4"
    data-testid="block-error-raw"
  >
    <span class="error-icon">⚠</span>
    <span class="error-body-inline">{{ event.text }}</span>
  </div>
</template>

<style scoped>
/* system:init */
.block-system-init {
  color: var(--content-subtle);
  font-style: italic;
}
.init-ctx-btn {
  font-style: normal !important;
  color: var(--content-faint) !important;
  font-size: inherit !important;
}
.init-ctx-body {
  font-style: normal;
  color: var(--content-faint);
  white-space: pre-wrap;
  font-family: ui-monospace, monospace;
  font-size: 12px;
}

/* error blocks */
.block-error {
  display: flex;
  align-items: flex-start;
  background: rgba(var(--v-theme-error), 0.12);
  border: 1px solid rgba(var(--v-theme-error), 0.4);
  border-radius: var(--shape-sm);
  color: rgb(var(--v-theme-error));
  font-size: 12px;
  font-family: ui-monospace, monospace;
}
.error-icon {
  flex-shrink: 0;
  color: rgb(var(--v-theme-error));
}
.error-body {
  user-select: text;
  cursor: text;
}
.error-type {
  font-weight: 600;
  color: rgb(var(--v-theme-error));
}
.error-text {
  white-space: pre-wrap;
}
.error-stderr {
  color: rgba(var(--v-theme-error), 0.8);
  white-space: pre-wrap;
}
.error-body-inline {
  white-space: pre-wrap;
  user-select: text;
  cursor: text;
}

/* user bubble */
.block-user {
  display: flex;
  justify-content: flex-end;
}
.user-bubble {
  border-radius: 20px 20px 4px 20px;
  max-width: 70%;
  overflow-wrap: break-word;
  font-size: 0.875rem;
  line-height: 1.625;
  user-select: text;
  cursor: text;
}
/* T1736: inline image in user bubble */
.user-bubble-img {
  max-height: 200px;
  max-width: 100%;
  border-radius: 8px;
  display: block;
  margin-top: 4px;
  cursor: pointer;
}

/* assistant wrapper — left-aligned flex column */
.block-assistant {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

/* assistant text block — chat bubble, left side */
.block-text {
  border-radius: 4px 20px 20px 20px;
  background: var(--surface-secondary);
  border: none;
  max-width: 85%;
  font-size: 0.875rem;
  line-height: 1.625;
  user-select: text;
  cursor: text;
}

/* result footer */
.block-result {
  border-top: 1px solid var(--edge-subtle);
}
.result-session-id {
  font-family: ui-monospace, monospace;
  color: var(--content-faint);
}
</style>
