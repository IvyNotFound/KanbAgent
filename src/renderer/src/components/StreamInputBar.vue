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
  <div class="border-t border-edge-subtle px-4 py-3 flex items-end gap-2">
    <textarea
      v-model="inputText"
      rows="2"
      placeholder="Envoyer un message…"
      class="flex-1 resize-none bg-surface-secondary border border-edge-default rounded-lg px-3 py-2 text-sm text-content-primary placeholder-content-subtle focus:outline-none focus:ring-1 transition-colors"
      @keydown="handleKeydown"
    />
    <!-- Stop button (T683) — visible only while agent is streaming and not yet stopped -->
    <button
      v-if="isStreaming && ptyId && !agentStopped"
      class="px-4 py-2 bg-red-700 hover:bg-red-600 text-white rounded-lg text-sm font-medium transition-colors self-end"
      data-testid="stop-button"
      @click="stopAgent"
    >
      Stop
    </button>
    <!-- Send button — couleur agent quand actif, zinc-700 quand disabled (T680) -->
    <button
      :disabled="!inputText.trim() || !sessionId"
      class="px-4 py-2 disabled:bg-surface-tertiary disabled:text-content-subtle text-white rounded-lg text-sm font-medium transition-colors self-end"
      :style="inputText.trim() && sessionId ? { backgroundColor: accentFg } : {}"
      data-testid="send-button"
      @click="sendMessage"
    >
      Envoyer
    </button>
  </div>
</template>
