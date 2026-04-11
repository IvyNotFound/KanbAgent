<script setup lang="ts">
import { useI18n } from 'vue-i18n'

defineProps<{
  activeThinkingText: string | null
  accentColor: string
}>()

const { t } = useI18n()
</script>

<template>
  <div
    class="streaming-indicator ga-2 text-caption"
    :style="{ color: accentColor }"
    data-testid="streaming-indicator"
  >
    <span class="bounce-dots">
      <span class="bounce-dot" :style="{ backgroundColor: accentColor }" />
      <span class="bounce-dot bounce-dot--d1" :style="{ backgroundColor: accentColor }" />
      <span class="bounce-dot bounce-dot--d2" :style="{ backgroundColor: accentColor }" />
    </span>
    <span v-if="activeThinkingText" class="thinking-text ga-1">
      <span class="thinking-label" data-testid="thinking-label">{{ t('stream.thinking') }}</span>
      <span class="thinking-preview" data-testid="thinking-preview">{{ activeThinkingText.slice(-120) }}</span>
    </span>
    <span v-else class="streaming-label">{{ t('stream.streaming') }}</span>
  </div>
</template>

<style scoped>
.streaming-indicator {
  display: flex;
  align-items: center;
  min-width: 0;
}
.bounce-dots {
  display: inline-flex;
  gap: 2px;
  flex-shrink: 0;
}
.bounce-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  animation: streamBounce 1s infinite;
}
.bounce-dot--d1 { animation-delay: 150ms; }
.bounce-dot--d2 { animation-delay: 300ms; }
@keyframes streamBounce {
  0%, 100% { transform: translateY(0); animation-timing-function: cubic-bezier(0.8, 0, 1, 1); }
  50% { transform: translateY(-4px); animation-timing-function: cubic-bezier(0, 0, 0.2, 1); }
}
.thinking-text {
  display: flex;
  align-items: center;
  min-width: 0;
}
.thinking-label { flex-shrink: 0; font-weight: 500; }
.thinking-preview {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-style: italic;
  opacity: 0.75;
  color: var(--content-muted);
}
.streaming-label { opacity: 0.75; }
</style>
