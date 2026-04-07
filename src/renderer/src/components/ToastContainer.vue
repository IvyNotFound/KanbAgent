<script setup lang="ts">
import { useToast, type ToastType } from '@renderer/composables/useToast'

const { toasts, dismiss } = useToast()

const colorMap: Record<ToastType, string> = {
  error: 'error',
  warn: 'warning',
  info: 'surface-variant',
}
</script>

<template>
  <template v-for="toast in toasts" :key="toast.id">
    <v-snackbar
      :model-value="true"
      :color="colorMap[toast.type]"
      :timeout="-1"
      location="bottom end"
    >
      {{ toast.message }}
      <v-btn
        icon
        variant="plain"
        density="compact"
        @click="dismiss(toast.id)"
      >
        <v-icon>mdi-close</v-icon>
      </v-btn>
    </v-snackbar>
  </template>
</template>
