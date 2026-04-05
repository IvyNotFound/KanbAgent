<script setup lang="ts">
import { ref } from 'vue'

const props = defineProps<{
  isStreaming: boolean
  ptyId: string | null
  agentStopped: boolean
  sessionId: string | null
  accentFg: string
}>()

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
  <!-- ── Input zone (T681: items-end aligne boutons sur bas textarea) ─── -->
  <div class="input-bar d-flex align-end ga-2 px-4 py-3">
    <v-textarea
      v-model="inputText"
      rows="2"
      auto-grow
      variant="outlined"
      rounded="lg"
      placeholder="Envoyer un message…"
      hide-details
      class="flex-1-1 text-body-2"
      @keydown="handleKeydown"
    />
    <!-- Stop button (T683) — visible only while agent is streaming and not yet stopped -->
    <v-btn
      v-if="isStreaming && ptyId && !agentStopped"
      color="error"
      variant="tonal"
      data-testid="stop-button"
      @click="stopAgent"
    >Stop</v-btn>
    <!-- Send button — couleur agent quand actif (T680) -->
    <v-btn
      icon
      rounded
      variant="flat"
      :disabled="!inputText.trim() || !sessionId"
      data-testid="send-button"
      :style="inputText.trim() && sessionId ? { backgroundColor: accentFg } : {}"
      @click="sendMessage"
    ><v-icon icon="mdi-send" /></v-btn>
  </div>
</template>

<style scoped>
.input-bar {
  border-top: 1px solid var(--edge-subtle);
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
</style>
