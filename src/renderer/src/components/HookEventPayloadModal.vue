<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import type { HookEvent } from '@renderer/stores/hookEvents'

const { t } = useI18n()

const props = defineProps<{
  event: HookEvent
}>()

const emit = defineEmits<{
  close: []
}>()

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
          <span class="text-subtitle-2 font-weight-medium" style="font-family: ui-monospace, monospace;">{{ event.event }}</span>
          <span class="text-caption text-disabled" style="font-family: ui-monospace, monospace;">{{ timestamp }}</span>
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
          <pre
            v-if="formattedPayload"
            class="payload-pre"
          >{{ formattedPayload }}</pre>
          <p v-else class="text-caption text-disabled font-italic">{{ t('hooks.noPayload') }}</p>
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

.payload-pre {
  font-size: 0.75rem;
  font-family: monospace;
  white-space: pre-wrap;
  user-select: text;
  cursor: text;
}
</style>
