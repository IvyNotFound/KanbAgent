<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import type { HookEvent } from '@renderer/stores/hookEvents'
import { toolColor, toolName } from '@renderer/composables/useHookEventDisplay'
import ToolInputView from './ToolInputView.vue'

const { t } = useI18n()

const props = defineProps<{
  event: HookEvent
}>()

const emit = defineEmits<{
  close: []
}>()

const TOOL_EVENTS = ['PreToolUse', 'PostToolUse', 'PostToolUseFailure']

const isToolEvent = computed(() => TOOL_EVENTS.includes(props.event.event))

const extractedToolName = computed(() => toolName(props.event.payload))

const extractedToolInput = computed((): Record<string, unknown> => {
  const p = props.event.payload as Record<string, unknown>
  return (p?.tool_input ?? {}) as Record<string, unknown>
})

/** tool_output for PostToolUse — capped at 200 lines to keep the modal usable. */
const toolOutput = computed((): string | null => {
  if (props.event.event !== 'PostToolUse') return null
  const p = props.event.payload as Record<string, unknown>
  const out = p?.tool_output as string | undefined
  if (out == null) return null
  const lines = out.split('\n')
  const MAX = 200
  if (lines.length <= MAX) return out
  return lines.slice(0, MAX).join('\n') + `\n… (${lines.length - MAX} lines hidden)`
})

/** Error output for PostToolUseFailure — tool_output or error field, styled red. */
const toolError = computed((): string | null => {
  if (props.event.event !== 'PostToolUseFailure') return null
  const p = props.event.payload as Record<string, unknown>
  const out = p?.tool_output as string | undefined
  if (out != null) return out
  return (p?.error as string | null) ?? null
})

const formattedPayload = computed(() =>
  props.event.payload != null
    ? JSON.stringify(props.event.payload, null, 2)
    : null
)

const timestamp = computed(() =>
  new Date(props.event.ts).toLocaleTimeString(undefined, {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
)

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') emit('close')
}

onMounted(() => document.addEventListener('keydown', onKeydown))
onUnmounted(() => document.removeEventListener('keydown', onKeydown))
</script>

<template>
  <v-dialog model-value max-width="672" scrollable @update:model-value="emit('close')">
    <!-- Wrapper with @click.self for test compat (Vuetify handles overlay click in prod) -->
    <div data-testid="payload-modal-backdrop" @click.self="emit('close')">
      <v-card class="payload-card">
        <!-- Header -->
        <v-card-title class="d-flex align-center gap-3 pa-4 pb-3">
          <span class="text-subtitle-2 font-weight-medium modal-event-name">{{ event.event }}</span>
          <!-- Tool name colored for tool events — consistent with HookEventBar/HookEventsView -->
          <span
            v-if="isToolEvent"
            class="text-subtitle-2 font-weight-semibold modal-tool-name"
            :style="{ color: toolColor(extractedToolName) }"
          >{{ extractedToolName }}</span>
          <span class="text-caption text-disabled modal-timestamp">{{ timestamp }}</span>
          <v-spacer />
          <v-btn
            icon="mdi-close"
            variant="text"
            size="small"
            density="compact"
            @click="emit('close')"
          />
        </v-card-title>
        <v-divider />

        <!-- Payload -->
        <v-card-text class="pa-4 payload-body">
          <!-- Structured view for tool events with non-null payload -->
          <template v-if="isToolEvent && event.payload != null">
            <div class="section-label">input</div>
            <div class="tool-view-body">
              <ToolInputView :tool-name="extractedToolName" :tool-input="extractedToolInput" />
            </div>

            <!-- Output for PostToolUse -->
            <template v-if="toolOutput != null">
              <div class="section-label mt-3">output</div>
              <pre class="tool-output-pre">{{ toolOutput }}</pre>
            </template>

            <!-- Error output for PostToolUseFailure -->
            <template v-if="toolError != null">
              <div class="section-label section-label--error mt-3">error</div>
              <pre class="tool-output-pre tool-output-error">{{ toolError }}</pre>
            </template>
          </template>

          <!-- Fallback: raw JSON for non-tool events -->
          <template v-else>
            <pre v-if="formattedPayload" class="payload-pre">{{ formattedPayload }}</pre>
            <p v-else class="text-caption text-disabled font-italic">{{ t('hooks.noPayload') }}</p>
          </template>
        </v-card-text>
      </v-card>
    </div>
  </v-dialog>
</template>

<style scoped>
.payload-card {
  max-height: 80vh;
}

.payload-body {
  overflow: auto;
}

.modal-event-name { /* event type label — inherits Roboto from Vuetify */ }
.modal-tool-name  { font-size: 0.875rem; }
.modal-timestamp  { font-variant-numeric: tabular-nums; }

.payload-pre {
  font-size: 0.75rem;
  font-family: ui-monospace, monospace;
  white-space: pre-wrap;
  user-select: text;
  cursor: text;
}

/* Section labels separating input/output areas */
.section-label {
  font-size: 0.65rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--content-faint, rgba(var(--v-theme-on-surface), 0.38));
  margin-bottom: 6px;
  user-select: none;
}

.section-label--error {
  color: rgb(var(--v-theme-error));
}

/* ToolInputView wrapper — matches the font context of StreamToolBlock .tool-body */
.tool-view-body {
  font-size: 0.75rem;
  font-family: ui-monospace, monospace;
  color: var(--content-muted, rgba(var(--v-theme-on-surface), 0.6));
  user-select: text;
  cursor: text;
}

.tool-output-pre {
  font-size: 0.75rem;
  font-family: ui-monospace, monospace;
  white-space: pre-wrap;
  user-select: text;
  cursor: text;
  margin: 0;
  padding: 8px 10px;
  border-radius: 4px;
  background: rgba(var(--v-theme-on-surface), 0.04);
}

/* PostToolUseFailure error output — mirrors tool-block--error in StreamToolBlock */
.tool-output-error {
  border-left: 3px solid rgba(var(--v-theme-error), 0.8);
  background: rgba(var(--v-theme-error), 0.08);
  color: rgb(var(--v-theme-error));
}
</style>
