<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
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

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('cancel')
}

onMounted(() => document.addEventListener('keydown', onKeydown))
onUnmounted(() => document.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      @click.self="emit('cancel')"
    >
      <div class="w-96 bg-surface-primary border border-edge-default rounded-xl shadow-2xl flex flex-col overflow-hidden">
        <!-- Header -->
        <div class="px-5 py-4 border-b border-edge-subtle">
          <h2 class="text-sm font-semibold text-content-primary">{{ props.title }}</h2>
        </div>

        <!-- Body -->
        <div class="px-5 py-4">
          <p class="text-sm text-content-secondary">{{ props.message }}</p>
        </div>

        <!-- Footer -->
        <div class="flex items-center justify-end gap-2 px-5 py-4 border-t border-edge-subtle bg-surface-base/50">
          <button
            class="px-4 py-2 text-sm text-content-muted hover:text-content-secondary hover:bg-surface-secondary rounded-lg transition-colors"
            @click="emit('cancel')"
          >
            {{ props.cancelLabel ?? t('common.cancel') }}
          </button>
          <button
            class="px-4 py-2 text-sm font-medium text-white rounded-lg transition-all"
            :class="props.danger ? 'bg-red-600 hover:bg-red-500' : 'bg-violet-600 hover:bg-violet-500'"
            @click="emit('confirm')"
          >
            {{ props.confirmLabel ?? t('common.confirm') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
