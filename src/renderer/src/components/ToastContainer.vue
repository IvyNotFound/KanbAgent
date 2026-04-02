<script setup lang="ts">
import { useToast, type Toast } from '@renderer/composables/useToast'

const { toasts, dismiss } = useToast()

const ICON: Record<Toast['type'], string> = {
  error: '✕',
  warn: '⚠',
  info: 'ℹ',
}

const COLOR: Record<Toast['type'], string> = {
  error: 'toast-error',
  warn:  'toast-warn',
  info:  'toast-info',
}
</script>

<template>
  <!-- MD3: fixed bottom-right, stacked toasts with elevation shadow -->
  <div class="toast-container">
    <div
      v-for="toast in toasts"
      :key="toast.id"
      :class="['toast-item', 'elevation-4', COLOR[toast.type]]"
    >
      <span class="toast-icon">{{ ICON[toast.type] }}</span>
      <span class="toast-message">{{ toast.message }}</span>
      <button
        class="toast-dismiss"
        @click="dismiss(toast.id)"
      >✕</button>
    </div>
  </div>
</template>

<style scoped>
.toast-container {
  position: fixed;
  bottom: 16px;
  right: 16px;
  z-index: 50;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 24rem;
  pointer-events: none;
}

.toast-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 12px;
  border-width: 1px;
  border-style: solid;
  font-size: 0.875rem;
  pointer-events: auto;
}

.toast-error {
  background-color: rgb(127 29 29 / 0.9);
  border-color: rgb(185 28 28 / 0.6);
  color: rgb(254 202 202);
}
.toast-warn {
  background-color: rgb(120 53 15 / 0.9);
  border-color: rgb(180 83 9 / 0.6);
  color: rgb(253 230 138);
}
.toast-info {
  background-color: rgba(var(--v-theme-surface-variant), 0.9);
  border-color: rgba(var(--v-border-color), var(--v-border-opacity));
  color: rgba(var(--v-theme-on-surface), 0.7);
}

.toast-icon {
  flex-shrink: 0;
  font-size: 0.75rem;
  font-family: monospace;
  margin-top: 2px;
}

.toast-message {
  flex: 1;
  line-height: 1.625;
  word-break: break-word;
  min-width: 0;
}

.toast-dismiss {
  flex-shrink: 0;
  font-size: 0.75rem;
  opacity: 0.5;
  margin-top: 2px;
  transition: opacity 0.15s;
}
.toast-dismiss:hover { opacity: 1; }
</style>
