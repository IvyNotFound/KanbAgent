<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const props = withDefaults(defineProps<{
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}>(), {
  danger: false,
})

const emit = defineEmits<{
  confirm: []
  cancel: []
}>()

const { t } = useI18n()
</script>

<template>
  <v-dialog model-value max-width="384" @update:model-value="emit('cancel')">
    <!-- data-testid wrapper catches @click.self for test compat (Vuetify handles overlay in prod) -->
    <div data-testid="confirm-modal-wrapper" @click.self="emit('cancel')">
      <v-card variant="elevated">
        <!-- Header -->
        <v-card-title class="text-subtitle-1 font-weight-medium pt-4 pb-0 px-5">{{ props.title }}</v-card-title>

        <!-- Body -->
        <v-card-text>
          <p class="text-body-2 text-medium-emphasis">{{ props.message }}</p>
        </v-card-text>

        <!-- Footer -->
        <v-card-actions>
          <v-spacer />
          <v-btn
            variant="text"
            @click="emit('cancel')"
          >
            {{ props.cancelLabel ?? t('common.cancel') }}
          </v-btn>
          <v-btn
            :color="props.danger ? 'error' : 'primary'"
            variant="flat"
            @click="emit('confirm')"
          >
            {{ props.confirmLabel ?? t('common.confirm') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </div>
  </v-dialog>
</template>

<style scoped>
</style>
