<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const props = defineProps<{
  isStreaming: boolean
  ptyId: string | null
  agentStopped: boolean
  sessionId: string | null
  accentFg: string
  /** T1707: pending AskUserQuestion text — changes placeholder and shows banner */
  pendingQuestion?: string
}>()

const inputPlaceholder = computed(() =>
  props.pendingQuestion ? t('stream.replyPlaceholder') : t('stream.inputPlaceholder')
)

const emit = defineEmits<{
  send: [text: string]
  stop: []
}>()

const inputText = ref('')

defineExpose({ inputText })

function sendMessage(): void {
  const text = inputText.value.trim()
  if (!text || !props.sessionId) return
  emit('send', text)
  inputText.value = ''
}

function handleKeydown(e: KeyboardEvent): void {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    sendMessage()
  }
}

function stopAgent(): void {
  if (!props.ptyId || props.agentStopped) return
  emit('stop')
}
</script>

<template>
  <!-- MD3 divider replaces the border-top CSS (T1687) -->
  <v-divider />
  <!-- T1707: pending question banner — shown when agent awaits a reply -->
  <div
    v-if="pendingQuestion"
    class="pending-question-banner px-5 pt-3 pb-0 d-flex align-center ga-2"
    data-testid="pending-question-banner"
  >
    <v-icon icon="mdi-help-circle-outline" size="small" class="pending-question-icon" />
    <span class="pending-question-text text-caption text-truncate">{{ pendingQuestion }}</span>
  </div>
  <!-- ── Input zone (T681: items-end aligne boutons sur bas textarea) ─── -->
  <div class="input-bar d-flex align-end ga-2 px-5 py-4" :class="{ 'pt-2': pendingQuestion }">
    <v-textarea
      v-model="inputText"
      rows="3"
      auto-grow
      variant="outlined"
      rounded="lg"
      :placeholder="inputPlaceholder"
      hide-details
      color="primary"
      base-color="outline"
      class="flex-1-1 text-body-2"
      @keydown="handleKeydown"
    />
    <!-- Stop button (T683, T1536, T1569) — always visible, disabled when not actionable -->
    <v-btn
      icon
      rounded="lg"
      variant="tonal"
      color="error"
      size="x-large"
      class="action-btn flex-shrink-0"
      :disabled="!isStreaming || !ptyId || agentStopped"
      aria-label="Stop"
      data-testid="stop-button"
      @click="stopAgent"
    >
      <v-icon icon="mdi-stop-circle" size="28" />
    </v-btn>
    <!-- Send button — accent color via CSS v-bind (T1687: preserves MD3 state layers) -->
    <v-btn
      icon
      rounded="lg"
      variant="flat"
      size="x-large"
      :disabled="!inputText.trim() || !sessionId"
      class="action-btn send-btn flex-shrink-0"
      aria-label="Send"
      data-testid="send-button"
      @click="sendMessage"
    >
      <v-icon icon="mdi-send" size="28" />
    </v-btn>
  </div>
</template>

<style scoped>
/* T1707: pending question indicator above the input field */
.pending-question-banner {
  background: var(--surface-secondary);
  max-width: 100%;
}
.pending-question-icon {
  color: rgba(var(--v-theme-info), 0.8) !important;
  flex-shrink: 0;
}
.pending-question-text {
  color: var(--content-muted);
  font-style: italic;
  min-width: 0;
}

.input-bar {
  background: var(--surface-secondary);
  /* Override user-select:none inherited from .main-wrap (App.vue).
     On Windows/Electron, user-select:none on a parent blocks focus and
     keyboard capture in child input elements (T1488). */
  user-select: text;
  pointer-events: auto;
}
/* Explicitly re-enable text input on the native textarea element */
.input-bar :deep(textarea) {
  user-select: text;
  pointer-events: auto;
}
/* Prevent Vuetify's v-field overlay from intercepting pointer events */
.input-bar :deep(.v-field__overlay) {
  pointer-events: none;
}
/* Smooth appearance transition for icon buttons (T1536) */
/* flex-shrink:0 + min dimensions prevent buttons from being crushed by textarea flex-grow (T1704) */
.action-btn {
  transition: all 150ms ease;
  flex-shrink: 0;
  min-width: 52px;
  min-height: 52px;
}
/* Send button: accent color via CSS v-bind — preserves Vuetify state layers (T1687) */
.send-btn {
  --send-accent: v-bind(accentFg);
}
.send-btn:not(:disabled) {
  background-color: var(--send-accent) !important;
}
</style>
